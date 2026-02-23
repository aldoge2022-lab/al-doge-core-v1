const test = require('node:test');
const assert = require('node:assert/strict');

const aiSuggestPath = require.resolve('../netlify/functions/ai-suggest');
delete require.cache[aiSuggestPath];
const { handler } = require('../netlify/functions/ai-suggest');

test('ai-suggest returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'METHOD_NOT_ALLOWED');
});

test('ai-suggest returns 400 when prompt is missing', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'INVALID_INPUT');
});

test('ai-suggest returns stable recommended items payload', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: 'Siamo in 4, vogliamo una pizza piccante' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(Array.isArray(body.items), true);
  assert.equal(body.items[0].id, 'diavola');
  assert.equal(typeof body.items[0].name, 'string');
  assert.equal(Number.isFinite(body.items[0].price_cents), true);
});

test('ai-suggest accepts legacy message field and returns stable payload', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Crea pizza personalizzata con pomodoro mozzarella' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(Array.isArray(body.items), true);
});

test('ai-suggest returns ok true with empty items when menu is empty', async () => {
  const currentCatalog = require('../data/catalog');
  const originalMenu = currentCatalog.menu;
  currentCatalog.menu = [];
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: 'Fammi una pizza piccante' })
  });
  currentCatalog.menu = originalMenu;

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.items, []);
});
