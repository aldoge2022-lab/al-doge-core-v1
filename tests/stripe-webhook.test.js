const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

let selectedOrder = null;
let tableOrders = [];
let orderUpdates = [];
let tableUpdates = [];

const stripeMock = () => ({
  webhooks: {
    constructEvent: (body) => JSON.parse(body)
  }
});

const supabaseMock = {
  from: (table) => {
    if (table === 'table_orders') {
      const selectBuilder = {
        eq: (column, value) => {
          if (column === 'id') {
            return {
              single: async () => ({ data: selectedOrder, error: selectedOrder ? null : { code: 'PGRST116' } })
            };
          }
          if (column === 'table_id') {
            return Promise.resolve({ data: tableOrders, error: null });
          }
          return selectBuilder;
        }
      };
      const updateBuilder = {
        eq: () => updateBuilder,
        then: (resolve) => {
          orderUpdates.push(updateBuilder.payload);
          resolve({ error: null });
        },
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
    if (table === 'restaurant_tables') {
      const updateBuilder = {
        eq: () => updateBuilder,
        then: (resolve) => {
          tableUpdates.push(updateBuilder.payload);
          resolve({ error: null });
        },
        payload: null
      };
      return {
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
const { handler } = require('../netlify/functions/stripe-webhook');
Module._load = originalLoad;

test.beforeEach(() => {
  selectedOrder = { id: 'to_1', table_id: '7', paid: false };
  tableOrders = [
    { total_cents: 1000, paid: true },
    { total_cents: 1500, paid: false }
  ];
  orderUpdates = [];
  tableUpdates = [];
});

test('stripe-webhook marks table order as paid and recalculates table total', async () => {
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          metadata: { order_id: 'to_1', table_id: '7' }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(orderUpdates[0], { paid: true, status: 'paid' });
  assert.deepEqual(tableUpdates[0], { total_cents: 1500, status: 'open' });
});

test('stripe-webhook closes table when no unpaid orders remain', async () => {
  tableOrders = [{ total_cents: 1000, paid: true }];
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_2',
          metadata: { order_id: 'to_1', table_id: '7' }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(tableUpdates[0], { total_cents: 0, status: 'closed' });
});

test('stripe-webhook is idempotent when order is already paid', async () => {
  selectedOrder = { id: 'to_1', table_id: '7', paid: true };
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_3',
          metadata: { order_id: 'to_1', table_id: '7' }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(orderUpdates.length, 0);
  assert.equal(tableUpdates.length, 0);
});

test('stripe-webhook ignores non checkout completed events', async () => {
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: {} }
    })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(orderUpdates.length, 0);
});
