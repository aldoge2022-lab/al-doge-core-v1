const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.SITE_URL = process.env.SITE_URL || 'https://example.com';

const { handler } = require('./ordine-ai');

test('returns 405 for non-POST requests', async () => {
  const response = await handler({ httpMethod: 'GET' });

  assert.equal(response.statusCode, 405);
  assert.equal(response.body, 'Method not allowed');
});

test('returns 400 for empty message', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: '   ' })
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body, 'Invalid input');
});

test('returns conversational reply when no order intent/phone is found', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ message: 'Ciao, cosa mi consigli?' })
  });

  assert.equal(response.statusCode, 200);
  assert.match(JSON.parse(response.body).reply, /Posso consigliarti/);
});
