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
let menuItemsRows = [];
global.fetch = async (url, options) => {
  telegramCalls.push({ url, options });
  return { ok: true };
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'stripe') {
    return stripeMock;
  }
  if (request === './_supabase') {
    return {
      from: (table) => {
        if (table === 'orders') {
          return {
            insert: (rows) => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'ord_1', total_cents: rows[0].total_cents, paid_cents: rows[0].paid_cents },
                  error: null
                })
              })
            })
          };
        }
        if (table === 'order_items') {
          return { insert: async () => ({ error: null }) };
        }
        if (table === 'menu_items') {
          return {
            select: () => ({
              eq: async () => ({
                data: menuItemsRows,
                error: null
              })
            })
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { handler } = require('../netlify/functions/ordine-ai');
Module._load = originalLoad;

test.beforeEach(() => {
  checkoutCalls = [];
  telegramCalls = [];
  menuItemsRows = [
    {
      nome: 'margherita',
      prezzo: 6,
      ingredienti: ['pomodoro', 'mozzarella'],
      tag: ['classica'],
      varianti: { impasto: ['normale'] },
      promozioni: {}
    },
    {
      nome: 'diavola',
      prezzo: 7,
      ingredienti: ['salame piccante'],
      tag: ['forte'],
      varianti: { impasto: ['normale'] },
      promozioni: {}
    }
  ];
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
  assert.match(JSON.parse(response.body).reply, /(Posso consigliarti|Ti consiglio)/);
});

test('returns custom pizza reply when message asks for personal pizza', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Vorrei una pizza personalizzata' })
  });

  assert.equal(response.statusCode, 200);
  assert.match(JSON.parse(response.body).reply, /Ecco la tua pizza personalizzata:/);
});

test('returns custom panino reply when message asks for personal panino', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Vorrei un panino personalizzato' })
  });

  assert.equal(response.statusCode, 200);
  assert.match(JSON.parse(response.body).reply, /Ecco il tuo panino personalizzato:/);
});

test('returns custom pizza reply when message asks to create a pizza', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Puoi creare una pizza per me?' })
  });

  assert.equal(response.statusCode, 200);
  assert.match(JSON.parse(response.body).reply, /Ecco la tua pizza personalizzata:/);
});

test('returns spicy pizza reply when message asks for a strong pizza', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Voglio una pizza forte' })
  });

  assert.equal(response.statusCode, 200);
  assert.match(JSON.parse(response.body).reply, /Pizza forte in arrivo:/);
});

test('returns light pizza reply when message asks for a light pizza', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Vorrei una pizza leggera' })
  });

  assert.equal(response.statusCode, 200);
  assert.match(JSON.parse(response.body).reply, /Pizza leggera creata per te:/);
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

test('creates checkout session from cart items payload with server-side catalog price', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      items: [
        { id: 'margherita', quantity: 2, unit_price_cents: 9999, name: 'Margherita' }
      ]
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).url, 'https://checkout.example/session');
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].line_items[0].price_data.unit_amount, 700);
  assert.equal(checkoutCalls[0].line_items[0].quantity, 2);
});

test('returns 400 for cart items payload with invalid product id', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      items: [
        { id: 'prodotto-inesistente', quantity: 2, unit_price_cents: 0, name: 'Margherita' }
      ]
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body, 'Invalid input');
});

test('uses discounted menu_items price for AI order parsing', async () => {
  menuItemsRows = [{
    nome: 'margherita',
    prezzo: 6,
    ingredienti: ['pomodoro', 'mozzarella'],
    tag: ['classica'],
    varianti: { impasto: ['normale'] },
    promozioni: { prezzo_scontato: 5.5 }
  }];

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Ordino 2 margherita, +39 3331234567' })
  });

  assert.equal(response.statusCode, 200);
  assert.match(JSON.parse(response.body).reply, /Totale ordine: €11/);
  assert.equal(checkoutCalls[0].line_items[0].price_data.unit_amount, 550);
});
