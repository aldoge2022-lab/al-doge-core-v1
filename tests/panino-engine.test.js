const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPanino } = require('../core/panino');

test('buildPanino rejects ingredient not allowed in panino', () => {
  const result = buildPanino(['tonno']);
  assert.equal(result.ok, false);
  assert.match(result.error, /tonno/i);
});

test('buildPanino returns pricing for valid ingredients', () => {
  const result = buildPanino(['pomodoro', 'mozzarella', 'insalata']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ingredientIds, ['pomodoro', 'mozzarella', 'insalata']);
  assert.equal(result.pricing.total, 8.5);
});
