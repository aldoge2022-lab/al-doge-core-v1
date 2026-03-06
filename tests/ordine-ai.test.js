const test = require('node:test');
const assert = require('node:assert/strict');

const { handler: orchestratorHandler } = require('../netlify/functions/ai-orchestrator');
const { handler } = require('../netlify/functions/ordine-ai');

test('ordine-ai proxies directly to ai-orchestrator handler', () => {
  assert.equal(handler, orchestratorHandler);
});

test('ordine-ai keeps ai-orchestrator reply contract', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'ciao ordinazione di prova' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(typeof body.reply, 'string');
  assert.equal(Array.isArray(body.cartUpdates), true);
  assert.equal(body.type, 'ai-orchestrator');
});
