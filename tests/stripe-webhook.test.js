const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

let mockOrder = { total_cents: 6000, paid_cents: 0 };
let orderUpdates = [];
let paymentInserts = [];

const stripeMock = () => ({
  webhooks: {
    constructEvent: (body) => JSON.parse(body)
  }
});

const supabaseMock = {
  from: (table) => {
    if (table === 'orders') {
      const selectBuilder = {
        eq: () => selectBuilder,
        single: async () => ({ data: mockOrder, error: null })
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
    if (table === 'payments') {
      return {
        insert: async (rows) => {
          paymentInserts.push(rows);
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
const { handler } = require('../netlify/functions/stripe-webhook');
Module._load = originalLoad;

test.beforeEach(() => {
  mockOrder = { total_cents: 6000, paid_cents: 0 };
  orderUpdates = [];
  paymentInserts = [];
});

test('stripe-webhook updates split payments as partial', async () => {
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_split_1',
          amount_total: 1500,
          metadata: { order_id: 'ord_1', table_number: '5', payment_mode: 'split' }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(orderUpdates[0].paid_cents, 1500);
  assert.equal(orderUpdates[0].status, 'partial');
  assert.equal(paymentInserts.length, 0);
});

test('stripe-webhook updates split payments as paid at completion', async () => {
  mockOrder = { total_cents: 6000, paid_cents: 4500 };
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_split_2',
          amount_total: 1500,
          metadata: { order_id: 'ord_1', payment_mode: 'split' }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(orderUpdates[0].paid_cents, 6000);
  assert.equal(orderUpdates[0].status, 'paid');
});

test('stripe-webhook keeps full payment flow for non-split', async () => {
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_full_1',
          amount_total: 2100,
          metadata: { order_id: 'ord_2' }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(orderUpdates[0].status, 'paid');
  assert.equal(orderUpdates[0].paid_cents, 2100);
  assert.equal(paymentInserts[0][0].payment_mode, 'full');
});

test('stripe-webhook accepts table metadata fallback', async () => {
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_split_3',
          amount_total: 1500,
          metadata: { order_id: 'ord_1', table: '7', payment_mode: 'split' }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(orderUpdates[0].paid_cents, 1500);
  assert.equal(orderUpdates[0].status, 'partial');
});
