const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/ai-orchestrator');
const openaiModulePath = require.resolve('openai');

test.beforeEach(() => {
  delete require.cache[modulePath];
  delete require.cache[openaiModulePath];
  delete process.env.OPENAI_API_KEY;
});

test('ai-orchestrator rejects non-POST requests', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.cartUpdates, []);
  assert.equal(body.message, 'Metodo non consentito');
});

test('ai-orchestrator returns fallback response when OPENAI_API_KEY is missing', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: 'crea un panino custom' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.fallback, true);
  assert.equal(Array.isArray(body.toolsCalled), true);
  assert.equal(Array.isArray(body.finalActions), true);
  assert.equal(Array.isArray(body.cartUpdates), true);
  assert.equal(body.message, 'AI orchestrator non disponibile: OPENAI_API_KEY mancante.');
  assert.equal(body.result, body.message);
});

test('ai-orchestrator returns normalized payload when prompt is missing', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: '   ' })
  });

  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.cartUpdates, []);
  assert.equal(body.message, 'Prompt mancante');
  assert.equal(body.result, body.message);
});

test('ai-orchestrator returns cartUpdates from add_menu_item_to_cart tool calls', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  process.env.OPENAI_API_KEY = 'test-key';
  let callIndex = 0;

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async () => {
            callIndex += 1;
            if (callIndex === 1) {
              return {
                id: 'resp_1',
                output: [
                  {
                    type: 'function_call',
                    name: 'add_menu_item_to_cart',
                    call_id: 'call_1',
                    arguments: JSON.stringify({ itemId: 'margherita', qty: 2 })
                  }
                ],
                output_text: ''
              };
            }

            return {
              id: 'resp_2',
              output: [],
              output_text: 'Aggiunto al carrello'
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
    assert.deepEqual(body.cartUpdates, [{ type: 'add', menuItemId: 'margherita', qty: 2 }]);
    assert.equal(body.message, 'Aggiunto al carrello');
    assert.equal(body.result, body.message);
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('ai-orchestrator catch path returns normalized temporary error', async () => {
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
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(body.cartUpdates, []);
    assert.equal(body.message, 'Errore AI temporaneo.');
    assert.equal(body.result, body.message);
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('proceed_to_checkout uses frontend cart state', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  const createCheckoutModulePath = require.resolve('../netlify/functions/create-checkout');
  const originalCreateCheckoutModule = require.cache[createCheckoutModulePath];
  process.env.OPENAI_API_KEY = 'test-key';
  let callIndex = 0;
  let checkoutPayload = null;

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async () => {
            callIndex += 1;
            if (callIndex === 1) {
              return {
                id: 'resp_checkout_1',
                output: [
                  {
                    type: 'function_call',
                    name: 'proceed_to_checkout',
                    call_id: 'call_checkout_1',
                    arguments: JSON.stringify({})
                  }
                ],
                output_text: ''
              };
            }

            return {
              id: 'resp_checkout_2',
              output: [],
              output_text: 'Procedo al pagamento'
            };
          }
        };
      }
    }
  };

  require.cache[createCheckoutModulePath] = {
    id: createCheckoutModulePath,
    filename: createCheckoutModulePath,
    loaded: true,
    exports: {
      handler: async (event) => {
        checkoutPayload = JSON.parse(event.body || '{}');
        return { statusCode: 200, body: JSON.stringify({ checkout_url: 'https://example.test/checkout' }) };
      }
    }
  };

  const mockCart = [
    { menuItemId: 'margherita', qty: 2 }
  ];

  try {
    const { handler } = require('../netlify/functions/ai-orchestrator');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        prompt: 'Procedi al pagamento',
        cart: mockCart
      })
    });

    const payload = JSON.parse(response.body);
    assert.equal(payload.ok, true);
    assert.deepEqual(checkoutPayload, { cart: mockCart });
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
