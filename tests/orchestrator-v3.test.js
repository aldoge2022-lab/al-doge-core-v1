const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/orchestrator-v3');
const { validateResponse } = require('../netlify/functions/orchestrator-v3/contract-validator');
const { parseQty: parseMenuQty } = require('../netlify/functions/orchestrator-v3/menu-handler');

async function call(message) {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message })
  });

  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body)
  };
}

test('dominio PANINO: add panino returns deterministic cart item', async () => {
  const result = await call('Aggiungi panino con mozzarella e pomodoro');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.cartUpdates.length, 1);
  assert.equal(result.body.cartUpdates[0].type, 'PANINO');
  assert.deepEqual(result.body.cartUpdates[0].ingredients.sort(), ['mozzarella', 'pomodoro']);
});

test('dominio MENU: add margherita returns MENU_ITEM', async () => {
  const result = await call('Inserisci 2 margherita');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.cartUpdates[0].type, 'MENU_ITEM');
  assert.equal(result.body.cartUpdates[0].id, 'margherita');
  assert.equal(result.body.cartUpdates[0].qty, 2);
});

test('contract validator returns fallback for invalid reply', () => {
  const validated = validateResponse({ ok: true, cartUpdates: [], reply: '   ' });
  assert.equal(validated.ok, false);
  assert.deepEqual(validated.cartUpdates, []);
  assert.equal(validated.reply, 'Errore interno sistema ordine.');
});

test('ingredient overflow returns structured error', async () => {
  process.env.PANINO_MAX_INGREDIENTS = '2';
  const result = await call('Aggiungi panino con pomodoro mozzarella burrata');
  delete process.env.PANINO_MAX_INGREDIENTS;

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, false);
  assert.deepEqual(result.body.cartUpdates, []);
  assert.match(result.body.reply, /massimo di 2 ingredienti/i);
});

test('pizza non trovata returns clear message and valid contract', async () => {
  const result = await call('Aggiungi pizza inesistente');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, false);
  assert.deepEqual(result.body.cartUpdates, []);
  assert.match(result.body.reply, /Pizza non trovata/i);
});

test('qty parsing supports italian word quantities', () => {
  assert.equal(parseMenuQty('aggiungi due margherita'), 2);
  assert.equal(parseMenuQty('metti 3 diavola'), 3);
});
