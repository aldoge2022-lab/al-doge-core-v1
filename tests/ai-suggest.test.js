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
  const fn = async () => ({
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  });
  fn.calls = 0;
  const wrapped = async (...args) => {
    fn.calls += 1;
    return fn(...args);
  };
  wrapped.calls = fn.calls;
  Object.defineProperty(wrapped, 'calls', {
    get() {
      return fn.calls;
    }
  });
  global.fetch = wrapped;
  return wrapped;
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
  assert.equal(JSON.parse(response.body).code, 'INVALID_INPUT');
});

test('ai-suggest returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  assert.equal(JSON.parse(response.body).code, 'METHOD_NOT_ALLOWED');
});

test('ai-suggest returns 400 for too long message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'a'.repeat(401) })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).code, 'INVALID_INPUT');
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
  assert.match(parsed.note, /Proposta per/i);
});

test('ai-suggest falls back to first active item when no menu match is found', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'siamo in 3, proposta leggera' }),
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
    body: JSON.stringify({ message: 'Vorrei una proposta' }),
    headers: { host: 'example.com', 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.statusCode, 500);
  const parsed = JSON.parse(response.body);
  assert.equal(parsed.code, 'MENU_FETCH_FAILED');
  assert.deepEqual(parsed.items, []);
});

test('ai-suggest handles required spicy message without 500', async () => {
  const fetchSpy = mockMenuFetch();
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'siamo in 3, qualcosa di piccante' }),
    headers: { host: 'example.com', 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(fetchSpy.calls, 1);
  const parsed = JSON.parse(response.body);
  assert.ok(Array.isArray(parsed.items));
  assert.match(parsed.note, /stile spicy/i);
});
