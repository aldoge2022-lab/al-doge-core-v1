const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/ai-consigli');

test('ai-consigli returns stable ok/items response', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: 'Fammi una pizza piccante' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(Array.isArray(body.items), true);
  assert.equal(body.items.length > 0, true);
  assert.equal(body.items[0].id, 'diavola');
});
