const test = require('node:test');
const assert = require('node:assert/strict');

const aiSuggestPath = require.resolve('../netlify/functions/ai-suggest');
delete require.cache[aiSuggestPath];
const { handler } = require('../netlify/functions/ai-suggest');

test('ai-suggest returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  assert.equal(JSON.parse(response.body).error, 'METHOD_NOT_ALLOWED');
});

test('ai-suggest returns 400 when message is missing', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'INVALID_INPUT');
});

test('ai-suggest returns action-based recommended items payload', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Siamo in 4, vogliamo una pizza piccante' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.action, 'add_recommended_items');
  assert.equal(Array.isArray(body.items), true);
  assert.equal(body.items[0].id, 'diavola');
  assert.equal(body.items[0].qty, 4);
  assert.equal(body.secondarySuggestion.kind, 'beverage');
});

test('ai-suggest returns custom-item payload for custom pizza request', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Crea pizza personalizzata con pomodoro mozzarella' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.action, 'build_custom_item');
  assert.equal(body.categoria, 'pizza');
  assert.equal(Array.isArray(body.ingredienti), true);
  assert.equal(body.ingredienti.includes('pomodoro'), true);
});

test('ai-suggest blocks fish in panino and returns answer action', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Crea un panino personalizzato con tonno' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.action, 'answer');
  assert.match(body.message, /panini non posso proporre ingredienti di pesce/i);
});
