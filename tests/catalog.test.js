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

  assert.ok(Array.isArray(pizza.allergeni));
  assert.equal(pizza.categoria, 'pizza');
  assert.ok(pizza.varianti && Array.isArray(pizza.varianti.impasto));
  assert.ok(pizza.promozioni && typeof pizza.promozioni === 'object');

  assert.ok(Array.isArray(drink.allergeni));
  assert.equal(drink.categoria, 'bevanda');
  assert.deepEqual(drink.varianti, {});
  assert.deepEqual(drink.promozioni, {});
});
