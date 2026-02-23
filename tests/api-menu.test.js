const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let state = {
  rows: [],
  error: null,
  selectColumns: null,
  eqFilter: null,
  throwError: null
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
            return {
              order: async () => {
                if (state.throwError) throw state.throwError;
                return {
                  data: state.rows,
                  error: state.error
                };
              }
            };
          }
        };
      }
    };
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './_supabase') return supabaseMock;
  return originalLoad.call(this, request, parent, isMain);
};
const { handler } = require('../netlify/functions/api-menu');
Module._load = originalLoad;

test.beforeEach(() => {
  state = { rows: [], error: null, selectColumns: null, eqFilter: null, throwError: null };
});

test('api-menu rejects non-GET', async () => {
  const response = await handler({ httpMethod: 'POST' });
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(response.body).error, 'Method not allowed');
});

test('api-menu returns normalized pizza payload with prezzo_cents integer', async () => {
  state.rows = [
    {
      id: 'margherita',
      nome: 'Margherita',
      categoria: 'classiche',
      prezzo: 6,
      ingredienti: ['pomodoro', 'mozzarella'],
      disponibile: true,
      tag: ['classica']
    },
    {
      id: 'diavola',
      nome: 'Diavola',
      categoria: 'speciali',
      prezzo_cents: 850,
      ingredienti: ['pomodoro', 'mozzarella', 'salame piccante'],
      disponibile: true,
      tag: []
    }
  ];

  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);

  assert.equal(body.pizze.length, 2);
  assert.deepEqual(body.pizze[0], {
    id: 'margherita',
    nome: 'Margherita',
    categoria: 'classiche',
    prezzo_cents: 600,
    ingredienti: ['pomodoro', 'mozzarella'],
    disponibile: true,
    tag: ['classica']
  });
  assert.equal(body.pizze[1].prezzo_cents, 850);
  assert.deepEqual(body.panini, []);
  assert.deepEqual(body.bevande, []);
  assert.equal(state.eqFilter[0], 'disponibile');
  assert.equal(state.eqFilter[1], true);
  assert.match(state.selectColumns, /\bprezzo_cents\b/);
  assert.match(state.selectColumns, /\btag\b/);
});

test('api-menu returns Supabase error details', async () => {
  state.error = {
    message: 'permission denied',
    code: '42501',
    details: 'for relation menu_items'
  };

  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(response.body), {
    error: 'permission denied',
    code: '42501',
    details: 'for relation menu_items'
  });
});

test('api-menu returns uncaught error message', async () => {
  state.throwError = new Error('unexpected boom');

  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 500);
  assert.equal(response.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(response.body), { error: 'unexpected boom' });
});
