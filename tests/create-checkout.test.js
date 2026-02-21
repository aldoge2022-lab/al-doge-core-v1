const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.SITE_URL = process.env.SITE_URL || 'https://example.com';

let checkoutCalls = [];
let ordersInsertError = null;
let orderItemsInsertError = null;
let insertedOrders = [];
let insertedOrderItems = [];
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
const supabaseMock = {
  from: (table) => {
    if (table === 'orders') {
      return {
        insert: (rows) => ({
          select: () => ({
            single: async () => {
              insertedOrders.push(rows);
              if (ordersInsertError) return { data: null, error: ordersInsertError };
              return { data: { id: 'ord_1' }, error: null };
            }
          })
        })
      };
    }
    if (table === 'order_items') {
      return {
        insert: async (rows) => {
          insertedOrderItems.push(rows);
          if (orderItemsInsertError) return { error: orderItemsInsertError };
          return { error: null };
        }
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'stripe') return stripeMock;
  if (request === './_supabase') return supabaseMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { handler } = require('../netlify/functions/create-checkout');
Module._load = originalLoad;

test.beforeEach(() => {
  checkoutCalls = [];
  ordersInsertError = null;
  orderItemsInsertError = null;
  insertedOrders = [];
  insertedOrderItems = [];
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
  assert.equal(checkoutCalls[0].metadata.order_id, 'ord_1');
  assert.equal(insertedOrders[0][0].total_cents, 2100);
  assert.equal(insertedOrderItems[0][0].product_id, 'margherita');
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
  assert.equal(insertedOrders[0][0].total_cents, 900);
});

test('create-checkout blocks Stripe session when DB insert fails', async () => {
  ordersInsertError = new Error('db down');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cart: [{ type: 'drink', id: 'birra-05', quantity: 1 }]
    })
  });

  assert.equal(response.statusCode, 500);
  assert.equal(checkoutCalls.length, 0);
});
