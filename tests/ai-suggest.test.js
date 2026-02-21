const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/ai-suggest');

const originalFetch = global.fetch;

test.beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  global.fetch = originalFetch;
});

test.after(() => {
  global.fetch = originalFetch;
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

test('ai-suggest deterministic logic returns only existing pizzas and max 3 items', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Siamo in 3, una vegetariana e una piccante' })
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

  const totalQty = parsed.items.reduce((sum, item) => sum + item.qty, 0);
  assert.ok(totalQty >= 1);
  assert.ok(totalQty <= 9);
});

test('ai-suggest includes drink upsell from deterministic pairing', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Qualcosa di piccante per 2 persone' })
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.ok(parsed.secondarySuggestion);
  assert.equal(parsed.secondarySuggestion.kind, 'beverage');
  assert.ok(parsed.secondarySuggestion.item.id);
  assert.ok(parsed.secondarySuggestion.cta);
});

test('ai-suggest uses OpenAI only for commercial note text', async () => {
  process.env.OPENAI_API_KEY = 'sk_test';
  let called = 0;
  global.fetch = async () => {
    called += 1;
    return {
      ok: true,
      async json() {
        return { output_text: 'Combo perfetta per il tavolo.\nAggiungi una bibita e chiudi l\'ordine ora.' };
      }
    };
  };

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Siamo in 2, proposta veloce' })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(called, 1);
  const parsed = JSON.parse(response.body);
  assert.ok(Array.isArray(parsed.items));
  assert.ok(parsed.items.length >= 1);
  assert.match(parsed.note, /Combo perfetta/i);
});
