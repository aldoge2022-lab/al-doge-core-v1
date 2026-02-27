const test = require('node:test');
const assert = require('node:assert/strict');

const { extractValidIngredients } = require('../netlify/functions/orchestrator-v3/services/ingredientExtractor');

test('extracts ingredients with token-based matching', () => {
  const result = extractValidIngredients('mozzarella e prosciutto');

  assert.ok(result.includes('mozzarella'));
  assert.ok(result.some((id) => id.includes('prosciutto')));
});

test('returns single match when only one ingredient is present', () => {
  const result = extractValidIngredients('pizza con mozzarella');

  assert.equal(result.length, 1);
  assert.equal(result[0], 'mozzarella');
});

test('returns empty array when no valid ingredients are found', () => {
  const result = extractValidIngredients('pizza con pollo');

  assert.deepEqual(result, []);
});

test('extracts all valid ingredients present in the text', () => {
  const result = extractValidIngredients('mozzarella prosciutto rucola');

  ['mozzarella', 'prosciutto', 'rucola'].forEach((id) => {
    assert.ok(result.includes(id));
  });
});

test('matches multi-word ingredients when all tokens are present in any order', () => {
  const result = extractValidIngredients('bufala di mozzarella');

  assert.ok(result.includes('mozzarella di bufala'));
});
