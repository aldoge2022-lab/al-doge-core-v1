const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let existingTable = null;
let insertedTables = [];
let insertedOrders = [];
let rpcCalls = [];

const supabaseMock = {
  from: (table) => {
    if (table === 'restaurant_tables') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => existingTable
              ? { data: existingTable, error: null }
              : { data: null, error: { code: 'PGRST116', message: 'Not found' } }
          })
        }),
        insert: async (row) => {
          insertedTables.push(row);
          return { data: row, error: null };
        }
      };
    }
    if (table === 'table_orders') {
      return {
        insert: (row) => ({
          select: () => ({
            single: async () => {
              insertedOrders.push(row);
              return { data: { id: 123 }, error: null };
            }
          })
        })
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  },
  rpc: async (fn, params) => {
    rpcCalls.push({ fn, params });
    return { error: null };
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './_supabase') return supabaseMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { handler } = require('../netlify/functions/create-table-order');
Module._load = originalLoad;

test.beforeEach(() => {
  existingTable = null;
  insertedTables = [];
  insertedOrders = [];
  rpcCalls = [];
});

test('create-table-order rejects non-POST', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  assert.equal(JSON.parse(response.body).error, 'Method not allowed');
});

test('create-table-order validates required fields', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ table_id: 7, items: [] })
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'Missing required fields');
});

test('create-table-order inserts order and updates table total', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      table_id: 7,
      items: [{ id: 'pizza', qty: 1 }],
      total_cents: 2450,
      payment_mode: 'stripe'
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).order_id, 123);
  assert.deepEqual(insertedTables[0], { id: 7, status: 'open', total_cents: 0 });
  assert.equal(insertedOrders[0].table_id, 7);
  assert.equal(insertedOrders[0].paid, false);
  assert.deepEqual(rpcCalls[0], {
    fn: 'increment_table_total',
    params: { table_id_input: 7, amount_input: 2450 }
  });
});
