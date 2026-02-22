const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.SITE_URL = process.env.SITE_URL || 'https://example.com';

let checkoutCalls = [];
let selectedSession = null;
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
    if (table === 'table_sessions') {
      const selectBuilder = {
        eq: () => selectBuilder,
        single: async () => ({ data: selectedSession, error: selectedSession ? null : { code: 'PGRST116' } })
      };
      return {
        select: () => selectBuilder
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
  selectedSession = {
    id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
    table_id: '7',
    total_cents: 12000,
    paid_cents: 0,
    status: 'open'
  };
});

test('create-checkout rejects non-POST', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('create-checkout accepts only session_id/mode and uses db residuo for full payment', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      session_id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
      mode: 'full',
      amount: 1
    })
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.checkout_url, 'https://checkout.example/session');
  assert.equal(payload.amount, 12000);
  assert.equal(payload.residuo_attuale, 12000);
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].payment_method_types[0], 'card');
  assert.equal(checkoutCalls[0].line_items[0].price_data.unit_amount, 12000);
  assert.equal(checkoutCalls[0].line_items[0].quantity, 1);
  assert.equal(checkoutCalls[0].line_items[0].price_data.currency, 'eur');
  assert.equal(checkoutCalls[0].metadata.session_id, '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f');
  assert.equal(checkoutCalls[0].metadata.amount_cents, '12000');
  assert.equal(checkoutCalls[0].metadata.mode, 'full');
  assert.equal(checkoutCalls[0].metadata.split_count, undefined);
  assert.equal(checkoutCalls[0].success_url, `${process.env.SITE_URL}/success.html`);
  assert.equal(checkoutCalls[0].cancel_url, `${process.env.SITE_URL}/cancel.html`);
});

test('create-checkout rejects closed sessions', async () => {
  selectedSession.status = 'closed';
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      session_id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
      mode: 'full'
    })
  });

  assert.equal(response.statusCode, 409);
  assert.equal(checkoutCalls.length, 0);
});

test('create-checkout rejects sessions with no residuo', async () => {
  selectedSession.paid_cents = 12000;
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      session_id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
      mode: 'full'
    })
  });

  assert.equal(response.statusCode, 409);
  assert.equal(checkoutCalls.length, 0);
});

test('create-checkout accepts split_count 2', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      session_id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
      mode: 'split',
      split_count: 2
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].metadata.split_count, '2');
});

test('create-checkout accepts split_count 8', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      session_id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
      mode: 'split',
      split_count: 8
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].metadata.split_count, '8');
});

test('create-checkout rejects disallowed split_count values', async () => {
  for (const split_count of [7, 1, 20]) {
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        session_id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
        mode: 'split',
        split_count
      })
    });

    assert.equal(response.statusCode, 400);
    assert.equal(checkoutCalls.length, 0);
  }
});

test('create-checkout computes split amount from residuo server-side', async () => {
  selectedSession.paid_cents = 3000;
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      session_id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
      mode: 'split',
      split_count: 3
    })
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.amount, 3000);
  assert.equal(payload.residuo_attuale, 9000);
  assert.equal(checkoutCalls[0].line_items[0].price_data.unit_amount, 3000);
  assert.equal(checkoutCalls[0].metadata.amount_cents, '3000');
  assert.equal(checkoutCalls[0].metadata.mode, 'split');
  assert.equal(checkoutCalls[0].metadata.split_count, '3');
});

test('create-checkout requires valid input contract', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ session_id: 'to_1', mode: 'full' })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'Invalid input');
  assert.equal(checkoutCalls.length, 0);
});

test('create-checkout returns 404 when session is missing', async () => {
  selectedSession = null;
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      session_id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
      mode: 'full'
    })
  });

  assert.equal(response.statusCode, 404);
  assert.equal(checkoutCalls.length, 0);
});

test('create-checkout rejects split when amount would be zero', async () => {
  selectedSession.total_cents = 3;
  selectedSession.paid_cents = 0;
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      session_id: '9fc4ae15-43b0-4d59-b7b9-8588ec7f885f',
      mode: 'split',
      split_count: 20
    })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(checkoutCalls.length, 0);
});
