const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
const openaiState = {
  calls: [],
  createImpl: async () => ({ output_text: 'Prova risposta' })
};

Module._load = function mockOpenAILoad(request, parent, isMain) {
  if (request === 'openai') {
    return function OpenAI(config) {
      return {
        config,
        responses: {
          create: async (payload) => {
            openaiState.calls.push({ config, payload });
            return openaiState.createImpl(payload, config);
          }
        }
      };
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const aiSuggestPath = require.resolve('../netlify/functions/ai-suggest');
delete require.cache[aiSuggestPath];
const { handler } = require('../netlify/functions/ai-suggest');

test.beforeEach(() => {
  openaiState.calls = [];
  openaiState.createImpl = async () => ({ output_text: 'Prova risposta' });
  process.env.OPENAI_API_KEY = 'test-key';
});

test.after(() => {
  delete process.env.OPENAI_API_KEY;
  delete require.cache[aiSuggestPath];
  Module._load = originalLoad;
});

test('ai-suggest returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  assert.equal(response.body, 'Method Not Allowed');
});

test('ai-suggest returns 400 when message is missing', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'Missing message');
});

test('ai-suggest returns OpenAI reply payload on success', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Consigliami una pizza' })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(response.body).reply, 'Prova risposta');
  assert.equal(openaiState.calls.length, 1);
  assert.equal(openaiState.calls[0].config.apiKey, 'test-key');
  assert.equal(openaiState.calls[0].payload.model, 'gpt-5-2-mini');
  assert.match(openaiState.calls[0].payload.input, /Pizza Margherita/);
  assert.match(openaiState.calls[0].payload.input, /Pizza Diavola/);
  assert.match(openaiState.calls[0].payload.input, /massimo 3 pizze/i);
  assert.match(openaiState.calls[0].payload.input, /massimo 4 righe/i);
});

test('ai-suggest returns 500 on runtime errors', async () => {
  openaiState.createImpl = async () => {
    throw new Error('Boom');
  };

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Consigliami una pizza' })
  });
  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).error, 'Boom');
});
