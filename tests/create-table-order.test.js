const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let upsertedTables = [];
let insertedOrders = [];
let rpcCalls = [];

const supabaseMock = {
  from: (table) => {
    if (table === 'restaurant_tables') {
      return {
        upsert: async (row) => {
          upsertedTables.push(row);
          return { error: null };
        }
      };
    }
    if (table === 'table_orders') {
      return {
        insert: (row) => ({
          select: () => ({
            single: async () => {
              insertedOrders.push(row);
              return { data: { id: 'to_1' }, error: null };
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
  upsertedTables = [];
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

test('create-table-order recalculates total from catalog and updates table total', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      table_id: 7,
      items: [
        { id: 'margherita', qty: 2 },
        { id: 'birra-05', qty: 1 }
      ],
      total_cents: 1
    })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).order_id, 'to_1');
  assert.deepEqual(upsertedTables[0], { id: 7, status: 'open', total_cents: 0 });
  assert.equal(insertedOrders[0].table_id, 7);
  assert.equal(insertedOrders[0].paid, false);
  assert.equal(insertedOrders[0].status, 'pending');
  assert.equal(insertedOrders[0].total_cents, 1900);
  assert.deepEqual(rpcCalls[0], {
    fn: 'increment_table_total',
    params: { table_id_input: 7, amount_input: 1900 }
  });
});

test('create-table-order rejects unknown catalog item', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      table_id: 7,
      items: [{ id: 'not-exists', qty: 1 }]
    })
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'Invalid item');
});

test('create-table-order rejects qty <= 0', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      table_id: 7,
      items: [{ id: 'margherita', qty: 0 }]
    })
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'Invalid qty');
});
