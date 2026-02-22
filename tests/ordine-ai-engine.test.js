const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../netlify/functions/ordine-ai/engine');

const sampleMenu = [
  { ingredienti: ['pomodoro', 'mozzarella', 'basilico'] },
  { ingredienti: ['mozzarella', 'salame', 'olive'] },
  { ingredienti: ['funghi'] }
];

test('generatePizza returns custom pizza with up to 3 available ingredients', () => {
  const result = engine.generatePizza({ richiesta: 'fammi una pizza', menu: sampleMenu });
  const available = new Set(sampleMenu.flatMap((item) => item.ingredienti));

  assert.equal(result.nome, 'Pizza Personalizzata');
  assert.equal(result.ingredienti.length <= 3, true);
  assert.deepEqual(result.ingredienti, [...new Set(result.ingredienti)]);
  assert.equal(result.ingredienti.every((item) => available.has(item)), true);
  assert.equal(result.prezzo, 6 + result.ingredienti.length * 1.5);
});

test('generatePanino returns custom panino with up to 4 available ingredients', () => {
  const result = engine.generatePanino({ richiesta: 'fammi un panino', menu: sampleMenu });
  const available = new Set(sampleMenu.flatMap((item) => item.ingredienti));

  assert.equal(result.nome, 'Panino Personalizzato');
  assert.equal(result.ingredienti.length <= 4, true);
  assert.deepEqual(result.ingredienti, [...new Set(result.ingredienti)]);
  assert.equal(result.ingredienti.every((item) => available.has(item)), true);
  assert.equal(result.prezzo, 5 + result.ingredienti.length * 1.5);
});
