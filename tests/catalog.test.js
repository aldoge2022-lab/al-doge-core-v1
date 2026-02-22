const test = require('node:test');
const assert = require('node:assert/strict');

test('catalog export does not set global in Node.js', () => {
  delete global.ALDOGE_CATALOG;
  const catalog = require('../public/data/catalog');
  assert.ok(catalog);
  assert.equal(global.ALDOGE_CATALOG, undefined);
});
