const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/ai-orchestrator');

test.beforeEach(() => {
  delete require.cache[modulePath];
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
});
