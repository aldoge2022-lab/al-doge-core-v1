const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/ai-orchestrator');

test.beforeEach(() => {
  delete require.cache[modulePath];
  delete process.env.OPENAI_API_KEY;
});

test('ai-orchestrator rejects non-POST requests', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({ httpMethod: 'GET' });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 405);
  assert.equal(body.reply, 'Metodo non consentito.');
  assert.deepEqual(body.cartUpdates, []);
  assert.equal(body.type, 'ai-orchestrator');
});

test('ai-orchestrator responds gracefully when message is missing', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: '   ' })
  });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, false);
  assert.equal(body.reply, 'Messaggio mancante.');
  assert.deepEqual(body.cartUpdates, []);
});

test('panino con bufala non ritorna pizza', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'panino con bufala' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);

  assert.equal(typeof body.reply, 'string');
  assert.match(body.reply.toLowerCase(), /panino/);
  assert.equal(body.reply.toLowerCase().includes('margherita'), false);
});

test('direct pizza name produces structured cart update', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'margherita' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);

  assert.equal(Array.isArray(body.cartUpdates), true);
  assert.equal(body.cartUpdates.length > 0, true);
  const item = body.cartUpdates[0];
  assert.equal(item.type, 'MENU_ITEM');
  assert.equal(item.id, 'margherita');
  assert.equal(item.name, 'Margherita');
  assert.equal(typeof body.reply, 'string');
});

test('orchestrator returns coherent reply without OPENAI_API_KEY', async () => {
  const { handler } = require('../netlify/functions/ai-orchestrator');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'consigliami qualcosa di piccante' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);

  assert.equal(typeof body.reply, 'string');
  assert.equal(body.reply.length > 0, true);
  assert.equal(Array.isArray(body.cartUpdates), true);
});
