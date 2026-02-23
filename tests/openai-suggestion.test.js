const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/openai-suggestion');

test('openai-suggestion returns 405 for non-POST', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'METHOD_NOT_ALLOWED');
});

test('openai-suggestion returns 400 when prompt is missing', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Prompt mancante');
});

test('openai-suggestion returns unified suggestion payload', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: 'Fammi una pizza piccante' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(Array.isArray(body.suggestion.items), true);
  assert.equal(typeof body.suggestion.note, 'string');
  assert.equal(body.suggestion.note, '');
});
