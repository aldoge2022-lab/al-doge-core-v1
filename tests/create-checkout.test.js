const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.SITE_URL = process.env.SITE_URL || 'https://example.com';

let checkoutCalls = [];
let selectedOrder = null;
let updatedOrders = [];
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
    if (table === 'table_orders') {
      const selectBuilder = {
        eq: () => selectBuilder,
        single: async () => ({ data: selectedOrder, error: selectedOrder ? null : { code: 'PGRST116' } })
      };
      const updateBuilder = {
        eq: () => updateBuilder,
        is: () => updateBuilder,
        select: () => ({
          single: async () => {
            if (!selectedOrder || selectedOrder.paid || selectedOrder.status !== 'pending' || selectedOrder.stripe_session_id) {
              return { data: null, error: { code: 'PGRST116' } };
            }
            updatedOrders.push(updateBuilder.payload);
            return { data: { id: selectedOrder.id }, error: null };
          }
        }),
        payload: null
      };
      return {
        select: () => selectBuilder,
        update: (payload) => {
          updateBuilder.payload = payload;
          return updateBuilder;
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
  updatedOrders = [];
  selectedOrder = {
    id: 'to_1',
    table_id: '7',
    total_cents: 2100,
    paid: false,
    status: 'pending',
    stripe_session_id: null
  };
});

test('create-checkout rejects non-POST', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('create-checkout accepts only order_id and uses db amount', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ order_id: 'to_1', total_cents: 1 })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].payment_method_types[0], 'card');
  assert.equal(checkoutCalls[0].line_items[0].price_data.unit_amount, 2100);
  assert.equal(checkoutCalls[0].line_items[0].quantity, 1);
  assert.equal(checkoutCalls[0].metadata.order_id, 'to_1');
  assert.equal(checkoutCalls[0].metadata.table_id, '7');
  assert.equal(checkoutCalls[0].success_url, `${process.env.SITE_URL}/success.html`);
  assert.equal(checkoutCalls[0].cancel_url, `${process.env.SITE_URL}/cancel.html`);
  assert.deepEqual(updatedOrders[0], { stripe_session_id: 'cs_test_1' });
});

test('create-checkout rejects already paid orders', async () => {
  selectedOrder.paid = true;
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ order_id: 'to_1' })
  });

  assert.equal(response.statusCode, 409);
  assert.equal(checkoutCalls.length, 0);
});

test('create-checkout rejects non pending orders', async () => {
  selectedOrder.status = 'paid';
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ order_id: 'to_1' })
  });

  assert.equal(response.statusCode, 409);
  assert.equal(checkoutCalls.length, 0);
});

test('create-checkout rejects when checkout is already created', async () => {
  selectedOrder.stripe_session_id = 'cs_existing';
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ order_id: 'to_1' })
  });

  assert.equal(response.statusCode, 409);
  assert.equal(checkoutCalls.length, 0);
});
