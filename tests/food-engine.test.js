const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateIngredientIds,
  calculateSupplements,
  calculateAllergens,
  getIngredientById
} = require('../core/menu/food-engine');

test('food-engine validates only existing unique ingredient IDs', () => {
  assert.equal(validateIngredientIds(['pomodoro', 'mozzarella']), true);
  assert.equal(validateIngredientIds(['pomodoro', 'pomodoro']), false);
  assert.equal(validateIngredientIds(['pomodoro', 'inesistente']), false);
});

test('food-engine computes supplements/allergens from food-core', () => {
  assert.equal(calculateSupplements(['pomodoro', 'mozzarella']), 4);
  assert.deepEqual(calculateAllergens(['mozzarella', 'burrata']), ['lattosio']);
  assert.equal(getIngredientById('tonno')?.name, 'Tonno');
});
