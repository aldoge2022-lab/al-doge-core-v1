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
