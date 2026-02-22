const test = require('node:test');
const assert = require('node:assert/strict');

test('catalog export does not set global in Node.js', () => {
  delete global.ALDOGE_CATALOG;
  const catalog = require('../public/data/catalog');
  assert.ok(catalog);
  assert.equal(global.ALDOGE_CATALOG, undefined);
});

test('catalog exposes normalized metadata for menu and drinks', () => {
  const catalog = require('../public/data/catalog');
  const pizza = catalog.menu.find((item) => item.id === 'margherita');
  const drink = catalog.drinks.find((item) => item.id === 'acqua-05');
  assert.ok(pizza);
  assert.ok(drink);

  assert.equal(pizza.type, 'pizza');
  assert.equal(pizza.price, 600);
  assert.equal(pizza.size, 'standard');
  assert.ok(Array.isArray(pizza.ingredients));
  assert.ok(Array.isArray(pizza.tags));
  assert.equal(pizza.base_price_cents, 600);
  assert.equal(pizza.extraPrice, 0);

  assert.equal(drink.type, 'drink');
  assert.equal(drink.price, 150);
  assert.equal(drink.size, 'standard');
  assert.ok(Array.isArray(drink.ingredients));
  assert.ok(Array.isArray(drink.tags));
  assert.equal(drink.price_cents, 150);
  assert.equal(drink.extraPrice, 0);
});

test('catalog normalizes every array section item shape', () => {
  const catalog = require('../public/data/catalog');

  Object.keys(catalog).forEach((section) => {
    if (!Array.isArray(catalog[section])) return;
    catalog[section].forEach((item) => {
      assert.equal(typeof item.type, 'string');
      assert.equal(item.size, 'standard');
      assert.ok(Array.isArray(item.ingredients));
      assert.ok(Array.isArray(item.tags));
      assert.equal(item.extraPrice, 0);
    });
  });
});
