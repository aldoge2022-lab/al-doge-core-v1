const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.SITE_URL = process.env.SITE_URL || 'https://example.com';

let checkoutCalls = [];
const stripeMock = () => ({
  checkout: {
    sessions: {
      create: async (payload) => {
        checkoutCalls.push(payload);
        return { url: 'https://checkout.example/session' };
      }
    }
  }
});

let telegramCalls = [];
global.fetch = async (url, options) => {
  telegramCalls.push({ url, options });
  return { ok: true };
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'stripe') {
    return stripeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { handler } = require('../netlify/functions/ordine-ai');
Module._load = originalLoad;

test.beforeEach(() => {
  checkoutCalls = [];
  telegramCalls = [];
});

test('returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });

  assert.equal(response.statusCode, 405);
  assert.equal(response.body, 'Method not allowed');
});

test('returns 400 for empty message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: '   ' })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body, 'Invalid input');
});

test('returns conversational reply when no order intent/phone is found', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Ciao, cosa mi consigli?' })
  });

  assert.equal(response.statusCode, 200);
  assert.match(JSON.parse(response.body).reply, /Posso consigliarti/);
});

test('creates checkout session and telegram notification for valid order', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'token';
  process.env.TELEGRAM_CHAT_ID = 'chat';

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Ordino 2 margherita, +39 3331234567, subito' })
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.match(parsed.reply, /Totale ordine: €12/);
  assert.match(parsed.reply, /https:\/\/checkout\.example\/session/);
  assert.equal(checkoutCalls.length, 1);
  assert.equal(telegramCalls.length, 1);
});

test('creates checkout session from cart items payload', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      items: [
        { id: 'margherita', quantity: 2, unit_price_cents: 600, name: 'Margherita' }
      ]
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).url, 'https://checkout.example/session');
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].line_items[0].price_data.unit_amount, 600);
  assert.equal(checkoutCalls[0].line_items[0].quantity, 2);
});

test('returns 400 for cart items payload without valid prices', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      items: [
        { id: 'margherita', quantity: 2, unit_price_cents: 0, name: 'Margherita' }
      ]
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body, 'Invalid input');
});
