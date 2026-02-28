const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let state = {
  rows: [],
  error: null,
  selectColumns: null,
  eqFilter: null,
  callCount: 0
};

const supabaseMock = {
  from: (table) => {
    if (table !== 'menu_items') {
      throw new Error(`Unexpected table: ${table}`);
    }
    return {
      select: (columns) => {
        state.selectColumns = columns;
        return {
          eq: (column, value) => {
            state.eqFilter = [column, value];
            state.callCount += 1;
            return Promise.resolve({
              data: state.rows,
              error: state.error
            });
          }
        };
      }
    };
  }
};

function loadHandler() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === './_supabase') return supabaseMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../netlify/functions/api-menu')];
  const { handler } = require('../netlify/functions/api-menu');
  Module._load = originalLoad;
  return handler;
}

test.beforeEach(() => {
  state = { rows: [], error: null, selectColumns: null, eqFilter: null, callCount: 0 };
});

test('api-menu caches successful responses', async () => {
  const handler = loadHandler();
  state.rows = [{ id: 1, nome: 'Pizza', categoria: 'classiche', prezzo_cents: 600, ingredienti: [] }];

  const first = await handler();
  assert.equal(first.statusCode, 200);
  assert.deepEqual(JSON.parse(first.body), {
    pizze: state.rows,
    panini: [],
    bevande: []
  });
  assert.deepEqual(state.eqFilter, ['disponibile', true]);
  assert.equal(state.callCount, 1);

  // modify underlying rows to ensure cache is used
  state.rows = [{ id: 2 }];
  const second = await handler();
  assert.equal(second.statusCode, 200);
  assert.deepEqual(JSON.parse(second.body), {
    pizze: [{ id: 1, nome: 'Pizza', categoria: 'classiche', prezzo_cents: 600, ingredienti: [] }],
    panini: [],
    bevande: []
  });
  assert.equal(state.callCount, 1, 'db should not be hit when cache valid');
});

test('api-menu returns supabase errors', async () => {
  const handler = loadHandler();
  state.error = { message: 'permission denied' };

  const response = await handler();
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(response.body), { error: 'permission denied' });
});
