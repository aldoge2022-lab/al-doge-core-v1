const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let state = {
  existingSession: null,
  insertResult: { data: { id: 'session_1' }, error: null },
  throwOnFrom: false,
  existingCalls: [],
  insertCalls: []
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
      select: (selection) => {
        const existingCall = { selection, filters: [] };
        state.existingCalls.push(existingCall);
        return {
          eq: (field, value) => {
            existingCall.filters.push({ field, value });
            return {
              eq: (field2, value2) => {
                existingCall.filters.push({ field: field2, value: value2 });
                return {
                  maybeSingle: async () => ({ data: state.existingSession, error: null })
                };
              }
            };
          }
        };
      },
      insert: (payload) => ({
        select: () => ({
          single: async () => {
            state.insertCalls.push(payload);
            return state.insertResult;
          }
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
const { handler } = require('../netlify/functions/open-table-session');
Module._load = originalLoad;

test.beforeEach(() => {
  state = {
    existingSession: null,
    insertResult: { data: { id: 'session_1' }, error: null },
    throwOnFrom: false,
    existingCalls: [],
    insertCalls: []
  };
});

test('open-table-session rejects non-POST', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('open-table-session validates table_id', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ table_id: 0 })
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'Invalid table_id');
});

test('open-table-session creates new session for valid table', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ table_id: '7' })
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { success: true, session_id: 'session_1' });
  assert.deepEqual(state.existingCalls[0], {
    selection: 'id',
    filters: [
      { field: 'table_id', value: 7 },
      { field: 'status', value: 'open' }
    ]
  });
  assert.deepEqual(state.insertCalls[0], {
    table_id: 7,
    total_cents: 0,
    paid_cents: 0,
    status: 'open'
  });
});

test('open-table-session returns 409 when a session is already open', async () => {
  state.existingSession = { id: 'session_existing' };

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ table_id: 7 })
  });

  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).error, 'Session already open');
  assert.equal(state.insertCalls.length, 0);
});

test('open-table-session returns database error when insert fails', async () => {
  state.insertResult = { data: null, error: { message: 'db error' } };

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ table_id: 2 })
  });

  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).error, 'Database error');
});

test('open-table-session returns internal error on unexpected exception', async () => {
  state.throwOnFrom = true;

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ table_id: 2 })
  });

  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).error, 'Internal error');
});
