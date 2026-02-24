const test = require('node:test');
const assert = require('node:assert/strict');

const { createCustomPanino } = require('../core/menu/panino-engine');

test('panino-engine rejects unknown impasto options', () => {
  assert.throws(
    () => createCustomPanino({ ingredientIds: ['pomodoro'], impasto: 'impasto-inventato' }),
    /Invalid impasto option/
  );
});

test('panino-engine rejects unknown mozzarella options', () => {
  assert.throws(
    () => createCustomPanino({ ingredientIds: ['pomodoro'], mozzarella: 'mozzarella-inventata' }),
    /Invalid mozzarella option/
  );
});
