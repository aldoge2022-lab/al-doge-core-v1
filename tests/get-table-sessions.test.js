const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let state = {
  rows: [],
  error: null,
  throwOnFrom: false
};

const supabaseMock = {
  from: (table) => {
    if (state.throwOnFrom) {
      throw new Error('Boom');
    }
    if (table !== 'table_sessions') {
      throw new Error(`Unexpected table: ${table}`);
    }
    return {
      select: () => ({
        order: async () => ({
          data: state.rows,
          error: state.error
        })
      })
    };
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './_supabase') return supabaseMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { handler } = require('../netlify/functions/get-table-sessions');
Module._load = originalLoad;

test.beforeEach(() => {
  state = {
    rows: [],
    error: null,
    throwOnFrom: false
  };
});

test('get-table-sessions rejects non-GET', async () => {
  const response = await handler({ httpMethod: 'POST' });
  assert.equal(response.statusCode, 405);
});

test('get-table-sessions returns mapped rows with residual cents', async () => {
  state.rows = [
    { id: 's1', table_id: 1, total_cents: 2500, paid_cents: 500, status: 'open' },
    { id: 's2', table_id: 2, total_cents: 4000, paid_cents: 4000, status: 'closed' },
    { id: 's3', table_id: 3, total_cents: 2000, paid_cents: 3000, status: 'open' }
  ];

  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), [
    { id: 's1', table_id: 1, total_cents: 2500, paid_cents: 500, residual_cents: 2000, status: 'open' },
    { id: 's2', table_id: 2, total_cents: 4000, paid_cents: 4000, residual_cents: 0, status: 'closed' },
    { id: 's3', table_id: 3, total_cents: 2000, paid_cents: 3000, residual_cents: 0, status: 'open' }
  ]);
});

test('get-table-sessions returns database error', async () => {
  state.error = { message: 'db error' };

  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).error, 'Database error');
});

test('get-table-sessions returns internal error on thrown exception', async () => {
  state.throwOnFrom = true;

  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).error, 'Internal error');
});
