const test = require('node:test');
const assert = require('node:assert/strict');

const { handler, __resetMenuCache } = require('../netlify/functions/ai-suggest');

const menuFixture = {
  size_engine: {
    default: 'normale',
    options: {
      normale: { label: 'Normale', surcharge_cents: 0 }
    }
  },
  menu: [
    { id: 'margherita', name: 'Pizza Margherita', base_price_cents: 800, active: true },
    { id: 'diavola', name: 'Pizza Diavola', base_price_cents: 950, active: true }
  ]
};

function mockMenuFetch(payload = menuFixture, status = 200) {
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  });
}

test.beforeEach(() => {
  process.env.SITE_URL = 'https://example.com';
  __resetMenuCache();
  mockMenuFetch();
});

test.after(() => {
  delete process.env.SITE_URL;
  delete global.fetch;
});

test('ai-suggest returns 400 structured error for empty message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: '   ' })
  });

  assert.equal(response.statusCode, 400);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.code, 'INVALID_INPUT');
  assert.deepEqual(parsed.items, []);
});

test('ai-suggest returns 405 structured error for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.code, 'METHOD_NOT_ALLOWED');
});

test('ai-suggest returns 400 for too long message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'a'.repeat(401) })
  });

  assert.equal(response.statusCode, 400);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.code, 'INVALID_INPUT');
});

test('ai-suggest returns items array for explicit product message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Vorrei 2 margherita' }),
    headers: { host: 'example.com', 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.ok(Array.isArray(parsed.items));
  assert.equal(parsed.items[0].id, 'margherita');
  assert.equal(parsed.items[0].qty, 2);
});

test('ai-suggest applies preference logic for spicy request', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Siamo in 3, proposta piccante' }),
    headers: { host: 'example.com', 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.items[0].id, 'diavola');
  assert.equal(parsed.items[0].qty, 3);
  assert.match(parsed.note, /piccante/i);
});

test('ai-suggest falls back to first active item and adds invisible upsell for groups', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Fammi una proposta', people: 3 }),
    headers: { host: 'example.com', 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.items[0].id, 'margherita');
  assert.equal(parsed.items[0].qty, 3);
  assert.equal(parsed.items[1].id, 'diavola');
  assert.equal(parsed.items[1].qty, 1);
  assert.match(parsed.note, /ticket medio/i);
});


test('ai-suggest avoids upsell for single person requests', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: '1 margherita' }),
    headers: { host: 'example.com', 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].id, 'margherita');
});


test('ai-suggest does not force upsell on explicit multi-person order intent', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Vorrei margherita per 3 persone' }),
    headers: { host: 'example.com', 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].id, 'margherita');
  assert.equal(parsed.items[0].qty, 3);
});

test('ai-suggest returns 500 with code when menu fetch fails', async () => {
  mockMenuFetch({}, 503);

  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'test' }),
    headers: { host: 'example.com', 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.statusCode, 500);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.code, 'MENU_FETCH_FAILED');
  assert.deepEqual(parsed.items, []);
});
