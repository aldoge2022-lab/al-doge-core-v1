const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/openai-suggestion');

test('openai-suggestion returns 405 for non-POST', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('openai-suggestion suggests catalog drink for spicy cart', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cart: [{ type: 'pizza', id: 'diavola', dough: 'normale', extras: [], quantity: 1 }]
    })
  });
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.suggested_drink, 'Birra 0.5L');
  assert.match(parsed.reason, /piccante/i);
});
