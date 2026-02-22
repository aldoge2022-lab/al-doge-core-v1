const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/checkout');

test('checkout normalizes non-pizza items and accepts numeric price', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cart: {
        items: [
          { type: 'drink', id: 'cola', price: 2.5 }
        ]
      }
    })
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.cart.items[0].size, 'standard');
  assert.equal(payload.cart.items[0].dough, null);
  assert.deepEqual(payload.cart.items[0].ingredients, []);
  assert.deepEqual(payload.cart.items[0].tags, []);
  assert.equal(payload.cart.items[0].extraPrice, 0);
});

test('checkout rejects non-numeric price', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cart: {
        items: [
          { type: 'pizza', id: 'margherita', price: '6' }
        ]
      }
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'Invalid input');
});

test('checkout accepts non-finite numeric price when numeric and not NaN', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: '{"cart":{"items":[{"type":"pizza","id":"margherita","price":1e309}]}}'
  });

  assert.equal(response.statusCode, 200);
});

test('checkout rejects item without id', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cart: {
        items: [
          { type: 'pizza', price: 6 }
        ]
      }
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'Invalid input');
});
