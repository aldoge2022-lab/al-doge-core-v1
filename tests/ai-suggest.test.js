const test = require('node:test');
const assert = require('node:assert/strict');

const aiSuggestPath = require.resolve('../netlify/functions/ai-suggest');
delete require.cache[aiSuggestPath];
const { handler } = require('../netlify/functions/ai-suggest');
const originalFetch = global.fetch;
const fetchState = {
  calls: [],
  impl: async () => ({
    ok: true,
    async json() {
      return { choices: [{ message: { content: 'Nota commerciale breve' } }] };
    }
  })
};

global.fetch = async (url, options) => {
  fetchState.calls.push({ url, options });
  return fetchState.impl(url, options);
};

test.beforeEach(() => {
  fetchState.calls = [];
  fetchState.impl = async () => ({
    ok: true,
    async json() {
      return { choices: [{ message: { content: 'Nota commerciale breve' } }] };
    }
  });
  process.env.XAI_API_KEY = 'test-key';
  delete process.env.XAI_MODEL;
});

test.after(() => {
  delete process.env.XAI_API_KEY;
  delete process.env.XAI_MODEL;
  delete require.cache[aiSuggestPath];
  global.fetch = originalFetch;
});

test('ai-suggest returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  assert.equal(JSON.parse(response.body).error, 'METHOD_NOT_ALLOWED');
});

test('ai-suggest returns 400 when message is missing', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'INVALID_INPUT');
});

test('ai-suggest returns deterministic items and xAI commercial note', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Siamo in 4, vogliamo una pizza piccante' })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/json');
  const body = JSON.parse(response.body);
  assert.equal(body.note, 'Nota commerciale breve');
  assert.equal(body.items.length <= 3, true);
  assert.equal(body.items[0].id, 'diavola');
  assert.equal(body.items[0].qty, 4);
  assert.equal(body.secondarySuggestion.kind, 'beverage');
  assert.equal(body.secondarySuggestion.item.id, 'birra-05');
  assert.equal(body.secondarySuggestion.item.qty, 2);
  assert.equal(fetchState.calls.length, 1);
  assert.equal(fetchState.calls[0].url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(JSON.parse(fetchState.calls[0].options.body).model, 'grok-4-1-fast-reasoning');
});

test('ai-suggest uses XAI_MODEL env override for xAI requests', async () => {
  process.env.XAI_MODEL = 'grok-custom-model';
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Una margherita per 2 persone' })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(fetchState.calls.length, 1);
  assert.equal(JSON.parse(fetchState.calls[0].options.body).model, 'grok-custom-model');
  delete process.env.XAI_MODEL;
});

test('ai-suggest keeps deterministic payload when xAI call fails', async () => {
  fetchState.impl = async () => {
    throw new Error('Boom');
  };
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Per 99 persone, margherita' })
  });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.items.length <= 3, true);
  assert.equal(body.items[0].qty, 5);
  assert.equal(body.note, 'Scelta equilibrata perfetta per il tavolo. Aggiungi una bibita e chiudi l\'ordine ora.');
});
