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
let insertedPayments = [];
const stripeMock = () => ({
  checkout: {
    sessions: {
      create: async (payload) => {
        checkoutCalls.push(payload);
        return { id: 'cs_test_1', url: 'https://checkout.example/session' };
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
              return {
                data: { id: 'ord_1', total_cents: rows[0].total_cents, paid_cents: rows[0].paid_cents },
                error: null
              };
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
    if (table === 'payments') {
      return {
        insert: async (rows) => {
          insertedPayments.push(rows);
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
  insertedPayments = [];
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
  assert.equal(checkoutCalls[0].payment_method_types[0], 'card');
  assert.equal(checkoutCalls[0].success_url, `${process.env.SITE_URL}/success.html`);
  assert.equal(checkoutCalls[0].cancel_url, `${process.env.SITE_URL}/cancel.html`);
  assert.equal(checkoutCalls[0].line_items[0].price_data.unit_amount, 1050);
  assert.equal(checkoutCalls[0].line_items[0].quantity, 2);
  assert.equal(checkoutCalls[0].metadata.order_id, 'ord_1');
  assert.equal(checkoutCalls[0].metadata.table, 'asporto');
  assert.equal(checkoutCalls[0].metadata.table_number, undefined);
  assert.equal(insertedOrders[0][0].type, 'takeaway');
  assert.equal(insertedOrders[0][0].table_number, null);
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


test('create-checkout sets table mode and metadata when table_number query param is present', async () => {
  const response = await handler({
    httpMethod: 'POST',
    queryStringParameters: { table_number: 'A12' },
    body: JSON.stringify({
      cart: [{ type: 'drink', id: 'birra-05', quantity: 1 }]
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(insertedOrders[0][0].type, 'table');
  assert.equal(insertedOrders[0][0].table_number, 'A12');
  assert.equal(checkoutCalls[0].metadata.order_id, 'ord_1');
  assert.equal(checkoutCalls[0].metadata.table, 'A12');
  assert.equal(checkoutCalls[0].metadata.table_number, 'A12');
});

test('create-checkout sets table mode when table_number is present in request body', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      table_number: '5',
      cart: [{ type: 'drink', id: 'birra-05', quantity: 1 }]
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(insertedOrders[0][0].type, 'table');
  assert.equal(insertedOrders[0][0].table_number, '5');
  assert.equal(checkoutCalls[0].metadata.table_number, '5');
  assert.equal(checkoutCalls[0].metadata.table, '5');
});

test('create-checkout accepts table in request body', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      table: '7',
      cart: [{ type: 'drink', id: 'birra-05', quantity: 1 }]
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(insertedOrders[0][0].type, 'table');
  assert.equal(insertedOrders[0][0].table_number, '7');
  assert.equal(checkoutCalls[0].metadata.table_number, '7');
  assert.equal(checkoutCalls[0].metadata.table, '7');
});

test('create-checkout supports split amount override and records split payment', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      table_number: '5',
      split_mode: true,
      split_persons: 4,
      amount_override_cents: 1500,
      cart: [{ type: 'drink', id: 'birra-05', quantity: 3 }]
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(checkoutCalls[0].line_items.length, 1);
  assert.equal(checkoutCalls[0].line_items[0].price_data.unit_amount, 1500);
  assert.equal(checkoutCalls[0].metadata.payment_mode, 'split');
  assert.equal(checkoutCalls[0].metadata.split_persons, '4');
  assert.equal(insertedOrders[0][0].total_cents, 1500);
  assert.equal(insertedPayments[0][0].payment_mode, 'split');
  assert.equal(insertedPayments[0][0].amount_cents, 1500);
});

test('create-checkout blocks split overpay', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      table_number: '5',
      split_mode: true,
      split_persons: 2,
      amount_override_cents: 5000,
      cart: [{ type: 'drink', id: 'birra-05', quantity: 2 }]
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(checkoutCalls.length, 0);
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

test('create-checkout blocks Stripe session when order_items insert fails', async () => {
  orderItemsInsertError = new Error('db down');
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      cart: [{ type: 'drink', id: 'birra-05', quantity: 1 }]
    })
  });

  assert.equal(response.statusCode, 500);
  assert.equal(checkoutCalls.length, 0);
});
