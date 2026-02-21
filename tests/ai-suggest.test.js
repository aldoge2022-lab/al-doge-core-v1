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
    { id: 'margherita', name: 'Margherita', base_price_cents: 800, active: true },
    { id: 'diavola', name: 'Diavola', base_price_cents: 950, active: true }
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

test('ai-suggest returns 400 for empty message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: '   ' })
  });

  assert.equal(response.statusCode, 400);
});

test('ai-suggest returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('ai-suggest returns 400 for too long message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'a'.repeat(401) })
  });

  assert.equal(response.statusCode, 400);
});

test('ai-suggest returns items array for valid message', async () => {
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

test('ai-suggest falls back to first active item when no menu match is found', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Proposta leggera', people: 3 }),
    headers: { host: 'example.com', 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.statusCode, 200);
  const parsed = JSON.parse(response.body);
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
