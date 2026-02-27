const test = require('node:test');
const assert = require('node:assert/strict');

const orchestratorPath = require.resolve('../netlify/functions/orchestrator-v3');
const openaiModulePath = require.resolve('openai');

function clearModules() {
  delete require.cache[orchestratorPath];
  delete require.cache[openaiModulePath];
}

test.beforeEach(() => {
  clearModules();
});

test('health endpoint reports catalog and schema loaded', async () => {
  const { handler } = require('../netlify/functions/orchestrator-v3');
  const response = await handler({
    httpMethod: 'GET',
    path: '/.netlify/functions/orchestrator-v3/health'
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.status, 'ok');
  assert.equal(body.catalogLoaded, true);
  assert.equal(body.schemaLoaded, true);
});

test('returns safe fallback when model does not return tool calls', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  process.env.OPENAI_API_KEY = 'test-key';

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async () => ({
            id: 'resp_no_tool',
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'ciao' }] }]
          })
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/orchestrator-v3');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ message: 'ciao, puoi aiutarmi?' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.reply, 'Puoi indicarmi il nome esatto della pizza?');
    assert.deepEqual(body.cartUpdates, []);
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('invalid ingredient returns INVALID_TOOL_PAYLOAD and blocks pollo', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  process.env.OPENAI_API_KEY = 'test-key';

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async () => ({
            id: 'resp_invalid',
            output: [
              {
                type: 'tool_call',
                name: 'add_item',
                call_id: 'call_invalid',
                arguments: JSON.stringify({ itemId: 'margherita', extraIngredients: ['pollo'] })
              }
            ]
          })
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/orchestrator-v3');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ message: 'aggiungi margherita con pollo' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'INVALID_TOOL_PAYLOAD');
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('deterministic cart item ignores AI price and computes from catalog', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  process.env.OPENAI_API_KEY = 'test-key';
  const requests = [];

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async (request) => {
            requests.push(request);
            return {
              id: 'resp_add',
              output: [
                {
                  type: 'tool_call',
                  name: 'add_item',
                  call_id: 'call_add',
                  arguments: JSON.stringify({
                    itemId: 'margherita',
                    quantity: '2',
                    extraIngredients: ['mozzarella']
                  })
                }
              ]
            };
          }
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/orchestrator-v3');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ message: 'aggiungi 2 pizze a caso con ordine' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.cartUpdates[0].id, 'margherita');
    assert.equal(body.cartUpdates[0].qty, 2);
    assert.ok(body.cartUpdates[0].price >= 600);
    assert.ok(Object.prototype.hasOwnProperty.call(body.cartUpdates[0], 'price'));
    assert.ok(body.cartUpdates[0].ingredients.includes('mozzarella'));
    assert.equal(requests[0].tools[0].parameters.additionalProperties, false);
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('suggests similar pizzas when ingredients overlap >=70%', async () => {
  delete process.env.OPENAI_API_KEY;
  const { handler } = require('../netlify/functions/orchestrator-v3');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'mozzarella e prosciutto' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.cartUpdates, []);
  assert.ok(Array.isArray(body.suggestions));
  assert.ok(body.suggestions.includes('4 Stagioni'));
});

test('returns closest formaggi suggestion when match ratio threshold is met', async () => {
  delete process.env.OPENAI_API_KEY;
  const { handler } = require('../netlify/functions/orchestrator-v3');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'mozzarella e gorgonzola' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.cartUpdates, []);
  assert.ok(body.suggestions.includes('Quattro Formaggi'));
});

test('creates deterministic custom pizza when no similar match is available', async () => {
  delete process.env.OPENAI_API_KEY;
  const { handler } = require('../netlify/functions/orchestrator-v3');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'mozzarella prosciutto rucola' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.cartUpdates.length, 1);
  assert.ok(body.reply.toLowerCase().includes('pizza personalizzata'));
  assert.ok(!body.reply.includes('Puoi indicarmi il nome esatto della pizza?'));
  assert.ok(body.cartUpdates[0].ingredients.includes('prosciutto'));
  assert.ok(body.cartUpdates[0].ingredients.includes('rucola'));
});

test('falls back gracefully when no valid ingredients are present', async () => {
  delete process.env.OPENAI_API_KEY;
  const { handler } = require('../netlify/functions/orchestrator-v3');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'pizza con pollo' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.reply, 'Puoi indicarmi il nome esatto della pizza?');
});

test('adds menu item directly when name matches and AI is disabled', async () => {
  delete process.env.OPENAI_API_KEY;
  const { handler } = require('../netlify/functions/orchestrator-v3');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'aggiungi margherita' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.cartUpdates[0].id, 'margherita');
  assert.equal(body.reply, 'Margherita aggiunta al carrello (1x).');
  assert.ok(!body.reply.includes('Puoi indicarmi il nome esatto della pizza?'));
});

test('keeps direct name matching via AI tools unchanged', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  process.env.OPENAI_API_KEY = 'test-key';

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async () => ({
            id: 'resp_add_margherita',
            output: [
              {
                type: 'tool_call',
                name: 'add_item',
                call_id: 'call_add_margherita',
                arguments: JSON.stringify({ itemId: 'margherita', quantity: 1 })
              }
            ]
          })
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/orchestrator-v3');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ message: 'aggiungi margherita con ordine' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.cartUpdates[0].id, 'margherita');
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});
