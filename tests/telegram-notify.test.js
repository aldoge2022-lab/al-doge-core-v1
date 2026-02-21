const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/telegram-notify');

test('telegram-notify returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('telegram-notify sends message when configured', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'token';
  process.env.TELEGRAM_CHAT_ID = 'chat';

  let called = false;
  global.fetch = async () => {
    called = true;
    return { ok: true };
  };

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Nuovo ordine test' })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(called, true);
});
