const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/ai-orchestrator');
const openaiModulePath = require.resolve('openai');

test.beforeEach(() => {
  delete require.cache[modulePath];
  delete require.cache[openaiModulePath];
  delete process.env.OPENAI_API_KEY;
});

test('ai-orchestrator rejects non-POST requests with normalized contract', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({ httpMethod: 'GET' });

  assert.equal(response.statusCode, 405);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.type, 'ai-orchestrator');
  assert.deepEqual(body.cartUpdates, []);
  assert.equal(body.reply, 'Metodo non consentito.');
});

test('ai-orchestrator returns safe fallback when OPENAI_API_KEY is missing', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: 'ciao' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.cartUpdates, []);
  assert.equal(body.reply, 'Puoi indicarmi il nome esatto della pizza?');
});

test('ai-orchestrator returns normalized payload when prompt is missing', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: '   ' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.type, 'ai-orchestrator');
  assert.deepEqual(body.cartUpdates, []);
  assert.equal(body.reply, 'Messaggio mancante.');
});

test('ai-orchestrator returns cartUpdates from add_item tool calls', async () => {
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
              id: 'resp_1',
              output: [
                {
                  type: 'tool_call',
                  name: 'add_item',
                  call_id: 'call_1',
                  arguments: JSON.stringify({ itemId: 'margherita', quantity: 2 })
                }
              ]
            };
          }
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/ai-orchestrator');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ prompt: 'aggiungi due margherite al carrello' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.type, 'ai-orchestrator');
    assert.equal(body.cartUpdates[0].id, 'margherita');
    assert.equal(body.cartUpdates[0].qty, 2);
    assert.equal(body.reply.includes('Margherita aggiunta al carrello'), true);

    assert.equal(requests[0].model, 'gpt-4o-mini-2024-07-18');
    assert.equal(requests[0].input[1].content, 'aggiungi due margherite al carrello');
    assert.equal(requests[0].tool_choice, 'auto');
    assert.deepEqual(
      requests[0].tools.map((tool) => tool.name),
      ['add_item', 'remove_item', 'create_custom_item', 'suggest_items']
    );
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('ai-orchestrator parses nested tool calls inside message content', async () => {
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
            id: 'resp_nested_1',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'tool_call',
                    name: 'add_item',
                    call_id: 'call_nested_1',
                    arguments: JSON.stringify({ itemId: 'margherita', quantity: 1 })
                  }
                ]
              }
            ]
          })
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/ai-orchestrator');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ prompt: 'aggiungi una margherita' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.equal(body.cartUpdates[0].id, 'margherita');
    assert.equal(body.cartUpdates[0].qty, 1);
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('ai-orchestrator accepts tool call identifier variants id and tool_call_id', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    for (const [identifierField, identifierValue] of [
      ['id', 'call_from_id'],
      ['tool_call_id', 'call_from_tool_call_id']
    ]) {
      delete require.cache[modulePath];

      require.cache[openaiModulePath] = {
        id: openaiModulePath,
        filename: openaiModulePath,
        loaded: true,
        exports: class OpenAI {
          constructor() {
            this.responses = {
              create: async () => ({
                id: 'resp_variant_1',
                output: [
                  {
                    type: 'tool_call',
                    name: 'add_item',
                    [identifierField]: identifierValue,
                    arguments: JSON.stringify({ itemId: 'margherita', quantity: 1 })
                  }
                ]
              })
            };
          }
        }
      };

      const { handler } = require('../netlify/functions/ai-orchestrator');
      const response = await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ prompt: 'aggiungi margherita' })
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.ok, true);
      assert.equal(body.cartUpdates[0].id, 'margherita');
    }
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('ai-orchestrator blocks unsupported tool names with INVALID_TOOL_PAYLOAD', async () => {
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
            id: 'resp_invalid_1',
            output: [
              {
                type: 'tool_call',
                name: 'create_custom_panino',
                call_id: 'call_invalid_1',
                arguments: JSON.stringify({ ingredientIds: ['ingrediente-fake'] })
              }
            ]
          })
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/ai-orchestrator');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ prompt: 'pizza custom con ingrediente inventato' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, false);
    assert.equal(body.type, 'ai-orchestrator');
    assert.deepEqual(body.cartUpdates, []);
    assert.equal(body.reply, 'INVALID_TOOL_PAYLOAD');
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('ai-orchestrator returns safe fallback when llm call fails', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  process.env.OPENAI_API_KEY = 'test-key';

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async () => {
            throw new Error('boom');
          }
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/ai-orchestrator');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ prompt: 'ciao' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.deepEqual(body.cartUpdates, []);
    assert.equal(body.reply, 'Puoi indicarmi il nome esatto della pizza?');
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('proceed_to_checkout tool is rejected by current ai-orchestrator contract', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  const createCheckoutModulePath = require.resolve('../netlify/functions/create-checkout');
  const originalCreateCheckoutModule = require.cache[createCheckoutModulePath];
  process.env.OPENAI_API_KEY = 'test-key';
  let checkoutCalled = false;

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async () => ({
            id: 'resp_checkout_1',
            output: [
              {
                type: 'tool_call',
                name: 'proceed_to_checkout',
                call_id: 'call_checkout_1',
                arguments: JSON.stringify({})
              }
            ]
          })
        };
      }
    }
  };

  require.cache[createCheckoutModulePath] = {
    id: createCheckoutModulePath,
    filename: createCheckoutModulePath,
    loaded: true,
    exports: {
      handler: async () => {
        checkoutCalled = true;
        return { statusCode: 200, body: JSON.stringify({ checkout_url: 'https://example.test/checkout' }) };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/ai-orchestrator');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        prompt: 'Procedi al pagamento',
        cart: [{ menuItemId: 'margherita', qty: 2 }]
      })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, false);
    assert.equal(body.reply, 'INVALID_TOOL_PAYLOAD');
    assert.equal(checkoutCalled, false);
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }

    if (originalCreateCheckoutModule) {
      require.cache[createCheckoutModulePath] = originalCreateCheckoutModule;
    } else {
      delete require.cache[createCheckoutModulePath];
    }
  }
});
