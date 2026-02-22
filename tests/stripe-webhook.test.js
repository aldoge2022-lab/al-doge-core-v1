const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

let paymentInsertError = null;
let paymentInserts = [];
let sessionRow = null;
let sessionIncrementPayloads = [];
let sessionClosePayloads = [];

const stripeMock = () => ({
  webhooks: {
    constructEvent: (body) => JSON.parse(body)
  }
});

const supabaseMock = {
  raw: (value) => value,
  from: (table) => {
    if (table === 'stripe_payments') {
      return {
        insert: async (payload) => {
          paymentInserts.push(payload);
          return { error: paymentInsertError };
        }
      };
    }
    if (table === 'table_sessions') {
      return {
        update: (payload) => {
          const state = { payload, filters: {} };
          const builder = {
            eq: (column, value) => {
              state.filters[column] = value;
              return builder;
            },
            lt: (column, value) => {
              state.filters[`lt:${column}`] = value;
              return builder;
            },
            select: () => ({
              single: async () => {
                sessionIncrementPayloads.push(state.payload);
                if (!sessionRow || state.filters.id !== sessionRow.id || state.filters.status !== 'open') {
                  return { data: null, error: { code: 'PGRST116' } };
                }
                if (!(Number(sessionRow.paid_cents) < Number(sessionRow.total_cents))) {
                  return { data: null, error: { code: 'PGRST116' } };
                }
                const increment = Number(String(state.payload.paid_cents).split('+')[1].trim());
                const updated = { ...sessionRow, paid_cents: Number(sessionRow.paid_cents) + increment };
                sessionRow = updated;
                return { data: updated, error: null };
              }
            }),
            then: (resolve) => {
              sessionClosePayloads.push(state.payload);
              if (sessionRow && state.payload.status === 'closed' && state.filters.id === sessionRow.id && state.filters.status === 'open') {
                sessionRow = { ...sessionRow, status: 'closed' };
              }
              resolve({ data: null, error: null });
            }
          };
          return builder;
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
  paymentInsertError = null;
  paymentInserts = [];
  sessionIncrementPayloads = [];
  sessionClosePayloads = [];
  sessionRow = {
    id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
    status: 'open',
    paid_cents: 1000,
    total_cents: 3000
  };
});

test('stripe-webhook increments paid_cents for a valid checkout completion', async () => {
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          payment_intent: 'pi_1',
          metadata: {
            session_id: sessionRow.id,
            amount_cents: '500'
          }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(paymentInserts[0], {
    payment_intent: 'pi_1',
    session_id: sessionRow.id,
    amount_cents: 500
  });
  assert.deepEqual(sessionIncrementPayloads[0], { paid_cents: 'paid_cents + 500' });
  assert.equal(sessionClosePayloads.length, 0);
});

test('stripe-webhook closes session when paid reaches total', async () => {
  sessionRow = { ...sessionRow, paid_cents: 2500, total_cents: 3000 };
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_2',
          payment_intent: 'pi_2',
          metadata: {
            session_id: sessionRow.id,
            amount_cents: '500'
          }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(sessionClosePayloads[0], { status: 'closed' });
  assert.equal(sessionRow.status, 'closed');
});

test('stripe-webhook is idempotent when payment_intent already exists', async () => {
  paymentInsertError = { code: '23505' };
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_3',
          payment_intent: 'pi_3',
          metadata: {
            session_id: sessionRow.id,
            amount_cents: '500'
          }
        }
      }
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(sessionIncrementPayloads.length, 0);
  assert.equal(sessionClosePayloads.length, 0);
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
  assert.equal(paymentInserts.length, 0);
});

test('stripe-webhook ignores invalid metadata payloads', async () => {
  const response = await handler({
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_intent: 'pi_4',
          metadata: { session_id: '', amount_cents: 'abc' }
        }
      }
    })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(paymentInserts.length, 0);
});
