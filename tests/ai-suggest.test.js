const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/ai-suggest');

test('ai-suggest returns 400 for empty message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: '   ' })
  });

  assert.equal(response.statusCode, 400);
});

test('ai-suggest returns items array for valid message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Vorrei 2 margherita' })
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.ok(Array.isArray(parsed.items));
});
