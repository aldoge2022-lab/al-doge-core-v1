const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/orchestrator-v2');

test.beforeEach(() => {
  delete require.cache[modulePath];
  delete process.env.OPENAI_API_KEY;
});

test('orchestrator-v2 performs deterministic add without OpenAI', async () => {
  const { handler } = require('../netlify/functions/orchestrator-v2');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: 'per favore aggiungi margherita' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.action, 'add_to_cart');
  assert.equal(body.mainItem.id, 'margherita');
  assert.equal(body.reply.includes('Aggiunto'), true);
  assert.deepEqual(
    Object.keys(body).sort(),
    ['action', 'mainItem', 'ok', 'reply', 'upsell'].sort()
  );
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'cartUpdates'), false);
});

test('orchestrator-v2 confirms add when session state contains lastMainItemId', async () => {
  const { handler } = require('../netlify/functions/orchestrator-v2');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      prompt: 'si',
      sessionState: { lastMainItemId: 'diavola' }
    })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.action, 'add_to_cart');
  assert.equal(body.mainItem.id, 'diavola');
});

test('orchestrator-v2 blocks confirmation when item is missing from catalog', async () => {
  const { handler } = require('../netlify/functions/orchestrator-v2');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      prompt: 'ok',
      sessionState: { lastMainItemId: 'not-found' }
    })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.action, null);
  assert.equal(body.mainItem, null);
  assert.equal(body.reply, 'Prodotto non disponibile');
});
