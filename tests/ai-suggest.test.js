const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/ai-suggest');

test.beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
});

test('ai-suggest returns 400 for empty message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: '   ' })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).code, 'INVALID_INPUT');
});

test('ai-suggest returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  assert.equal(JSON.parse(response.body).code, 'METHOD_NOT_ALLOWED');
});

test('ai-suggest returns 400 for too long message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'a'.repeat(401) })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).code, 'INVALID_INPUT');
});

test('ai-suggest returns only existing pizzas with max 3 unique items', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Siamo in 3, uno vegetariano e uno piccante' })
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.ok(Array.isArray(parsed.items));
  assert.ok(parsed.items.length >= 1);
  assert.ok(parsed.items.length <= 3);

  const ids = parsed.items.map((item) => item.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length);
  ids.forEach((id) => assert.match(id, /^(margherita|diavola)$/));
  assert.match(parsed.note, /combo|scelta|consiglio|equilibrio/i);
});

test('ai-suggest can include beverage upsell suggestion', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Proposta veloce per 2 persone' })
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  if (parsed.secondarySuggestion) {
    assert.equal(parsed.secondarySuggestion.kind, 'beverage');
    assert.ok(parsed.secondarySuggestion.item.id);
    assert.ok(parsed.secondarySuggestion.cta);
  }
});
