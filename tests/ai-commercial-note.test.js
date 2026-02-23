const test = require('node:test');
const assert = require('node:assert/strict');

const path = require.resolve('../netlify/functions/ai-commercial-note');
const originalFetch = global.fetch;

test.beforeEach(() => {
  delete require.cache[path];
  process.env.XAI_API_KEY = 'test-key';
  delete process.env.XAI_MODEL;
});

test.after(() => {
  delete process.env.XAI_API_KEY;
  delete process.env.XAI_MODEL;
  global.fetch = originalFetch;
});

test('ai-commercial-note returns 405 for non-POST', async () => {
  const { handler } = require('../netlify/functions/ai-commercial-note');
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('ai-commercial-note uses separated marketing prompt', async () => {
  let requestBody = null;
  global.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'Test note' } }] };
      }
    };
  };

  const { handler } = require('../netlify/functions/ai-commercial-note');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ orderSummary: 'diavola x2' })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).note, 'Test note');
  assert.match(requestBody.messages[0].content, /Scrivi massimo 3 righe persuasive/);
  assert.match(requestBody.messages[0].content, /Non modificare mai l'ordine/);
});
