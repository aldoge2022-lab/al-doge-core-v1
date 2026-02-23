const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/ai-consigli');

test('ai-consigli is deprecated and points to openai-suggestion', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: 'Fammi una pizza piccante' })
  });

  assert.equal(response.statusCode, 410);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'DEPRECATED_ENDPOINT');
});
