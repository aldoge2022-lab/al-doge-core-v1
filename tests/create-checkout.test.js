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

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'stripe') return stripeMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { handler } = require('../netlify/functions/create-checkout');
Module._load = originalLoad;

test.beforeEach(() => {
  checkoutCalls = [];
});

test('create-checkout rejects non-POST', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('create-checkout calculates totals only from catalog', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cart: [{ type: 'pizza', id: 'margherita', dough: 'kamut', extras: ['burrata'], quantity: 2 }]
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].line_items[0].price_data.unit_amount, 1050);
  assert.equal(checkoutCalls[0].line_items[0].quantity, 2);
});

test('create-checkout adds cover charge for sala service', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      service: 'sala',
      people: 2,
      cart: [{ type: 'drink', id: 'birra-05', quantity: 1 }]
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(checkoutCalls[0].line_items.length, 2);
  assert.equal(checkoutCalls[0].line_items[1].price_data.product_data.name, 'Coperto');
  assert.equal(checkoutCalls[0].line_items[1].quantity, 2);
});
