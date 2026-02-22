const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.STAFF_API_KEY = 'staff-secret';

let state = {
  response: { data: null, error: null }
};

const supabaseMock = {
  from: (table) => {
    if (table !== 'menu_items') {
      throw new Error(`Unexpected table: ${table}`);
    }
    return {
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => state.response
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
const { handler } = require('../netlify/functions/update-menu-item');
Module._load = originalLoad;

test.beforeEach(() => {
  state.response = {
    data: { id: '11111111-1111-4111-8111-111111111111', prezzo: 9, promozioni: {}, disponibile: true },
    error: null
  };
});

test('update-menu-item rejects unauthorized requests', async () => {
  const response = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
  assert.equal(response.statusCode, 401);
});

test('update-menu-item validates payload', async () => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-api-key': 'staff-secret' },
    body: JSON.stringify({ id: 'invalid' })
  });
  assert.equal(response.statusCode, 400);
});

test('update-menu-item updates allowed fields', async () => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-api-key': 'staff-secret' },
    body: JSON.stringify({
      id: '11111111-1111-4111-8111-111111111111',
      prezzo: 9.5,
      promozioni: { prezzo_scontato: 8.5 },
      disponibile: false
    })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).id, '11111111-1111-4111-8111-111111111111');
});
