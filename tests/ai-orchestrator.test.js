const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/ai-orchestrator');
const openaiModulePath = require.resolve('openai');
const createCheckoutModulePath = require.resolve('../netlify/functions/create-checkout');

test.beforeEach(() => {
  delete require.cache[modulePath];
  delete require.cache[openaiModulePath];
  delete require.cache[createCheckoutModulePath];
  delete process.env.OPENAI_API_KEY;
});

test('ai-orchestrator rejects non-POST requests', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
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
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('ai-orchestrator returns cartUpdates from update_item_quantity tool calls', async () => {
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
                    name: 'update_item_quantity',
                    call_id: 'call_1',
                    arguments: JSON.stringify({ menuItemId: 'margherita', qty: 1 })
                  }
                ],
                output_text: ''
              };
            }

            return {
              id: 'resp_2',
              output: [],
              output_text: 'Quantità aggiornata'
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
      body: JSON.stringify({ prompt: 'cambia quantità margherita a 1' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.deepEqual(body.cartUpdates, [{ type: 'update', menuItemId: 'margherita', qty: 1 }]);
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('ai-orchestrator returns cartUpdates from remove_menu_item_from_cart and clear_cart tool calls', async () => {
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
                    name: 'remove_menu_item_from_cart',
                    call_id: 'call_1',
                    arguments: JSON.stringify({ menuItemId: 'margherita' })
                  },
                  {
                    type: 'function_call',
                    name: 'clear_cart',
                    call_id: 'call_2',
                    arguments: JSON.stringify({})
                  }
                ],
                output_text: ''
              };
            }

            return {
              id: 'resp_2',
              output: [],
              output_text: 'Carrello aggiornato'
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
      body: JSON.stringify({ prompt: 'togli margherita e svuota carrello' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.deepEqual(body.cartUpdates, [{ type: 'remove', menuItemId: 'margherita' }, { type: 'clear' }]);
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('ai-orchestrator returns cartUpdates from proceed_to_checkout tool calls', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  const originalCheckoutModule = require.cache[createCheckoutModulePath];
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
                    name: 'proceed_to_checkout',
                    call_id: 'call_1',
                    arguments: JSON.stringify({ cart: [{ id: 'margherita', qty: 1 }] })
                  }
                ],
                output_text: ''
              };
            }

            return {
              id: 'resp_2',
              output: [],
              output_text: 'Vai al pagamento'
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
      handler: async () => ({
        statusCode: 200,
        body: JSON.stringify({ checkout_url: 'https://checkout.example/session' })
      })
    }
  };

  try {
    const { handler } = require('../netlify/functions/ai-orchestrator');
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ prompt: 'procedi al pagamento' })
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.deepEqual(body.cartUpdates, [{ type: 'checkout', url: 'https://checkout.example/session' }]);
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
    if (originalCheckoutModule) {
      require.cache[createCheckoutModulePath] = originalCheckoutModule;
    } else {
      delete require.cache[createCheckoutModulePath];
    }
  }
});
