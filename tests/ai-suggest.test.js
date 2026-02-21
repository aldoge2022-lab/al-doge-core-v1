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

test('ai-suggest returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('ai-suggest returns 400 for too long message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'a'.repeat(401) })
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
  assert.equal(parsed.items[0].id, 'margherita');
  assert.equal(parsed.items[0].qty, 2);
});

test('ai-suggest falls back to first active item when no menu match is found', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Proposta leggera', people: 3 })
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.items[0].id, 'margherita');
  assert.equal(parsed.items[0].qty, 3);
});
