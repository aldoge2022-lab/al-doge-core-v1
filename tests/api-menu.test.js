const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let state = {
  rows: [],
  error: null
};

const supabaseMock = {
  from: (table) => {
    if (table !== 'menu_items') {
      throw new Error(`Unexpected table: ${table}`);
    }
    return {
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: state.rows,
            error: state.error
          })
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
const { handler } = require('../netlify/functions/api-menu');
Module._load = originalLoad;

test.beforeEach(() => {
  state = { rows: [], error: null };
});

test('api-menu rejects non-GET', async () => {
  const response = await handler({ httpMethod: 'POST' });
  assert.equal(response.statusCode, 405);
});

test('api-menu returns grouped menu payload', async () => {
  state.rows = [
    {
      id: '1',
      nome: 'Pizza Margherita',
      categoria: 'pizza',
      prezzo: 7,
      ingredienti: ['pomodoro'],
      allergeni: [],
      tag: ['classica'],
      varianti: { impasto: ['normale'] },
      promozioni: {}
    },
    {
      id: '2',
      nome: 'Acqua',
      categoria: 'bevanda',
      prezzo: 1.5,
      ingredienti: [],
      allergeni: [],
      tag: ['fresca'],
      varianti: {},
      promozioni: { prezzo_scontato: 1.2 }
    }
  ];

  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.pizze.length, 1);
  assert.equal(body.bevande.length, 1);
  assert.deepEqual(body.tag, ['classica', 'fresca']);
  assert.deepEqual(body.promozioni['2'], { prezzo_scontato: 1.2 });
});
