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

  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true };
  };

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Nuovo ordine test' })
  });

  assert.equal(response.statusCode, 200);
  assert.match(request.url, /api\.telegram\.org\/bottoken\/sendMessage$/);
  assert.equal(request.options.method, 'POST');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.chat_id, 'chat');
  assert.equal(payload.text, 'Nuovo ordine test');
});

test('telegram-notify returns 400 for invalid message payload', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'token';
  process.env.TELEGRAM_CHAT_ID = 'chat';

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: '   ' })
  });

  assert.equal(response.statusCode, 400);
});

test('telegram-notify returns 500 when Telegram env is missing', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'test' })
  });

  assert.equal(response.statusCode, 500);
});
