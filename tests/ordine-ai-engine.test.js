const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../netlify/functions/ordine-ai/engine');
const { calculatePaninoPrice } = require('../core/panino/panino-pricing');

const sampleMenu = [
  { ingredienti: ['pomodoro', 'mozzarella', 'basilico'] },
  { ingredienti: ['mozzarella', 'salame', 'olive'] },
  { ingredienti: ['funghi'] }
];

test('generatePizza returns custom pizza with deterministic valid ingredients and technical-category pricing', () => {
  const result = engine.generatePizza({ richiesta: 'fammi una pizza', menu: sampleMenu });
  const available = new Set(sampleMenu.flatMap((item) => item.ingredienti));

  assert.equal(result.nome, 'Pizza Personalizzata');
  assert.equal(result.ingredienti.length <= 3, true);
  assert.deepEqual(result.ingredienti, [...new Set(result.ingredienti)]);
  assert.equal(result.ingredienti.every((item) => available.has(item)), true);
  assert.equal(result.prezzo, 11);
});

test('generatePanino returns custom panino ingredients without fish and with technical-category pricing', () => {
  const result = engine.generatePanino({ richiesta: 'fammi un panino', menu: sampleMenu });
  const available = new Set(sampleMenu.flatMap((item) => item.ingredienti));
  const expectedPrice = calculatePaninoPrice(result.ingredienti).total;

  assert.equal(result.nome, 'Panino Personalizzato');
  assert.equal(result.ingredienti.length <= 4, true);
  assert.deepEqual(result.ingredienti, [...new Set(result.ingredienti)]);
  assert.equal(result.ingredienti.every((item) => available.has(item)), true);
  assert.equal(result.ingredienti.some((item) => String(item).toLowerCase().includes('tonno')), false);
  assert.equal(result.prezzo, expectedPrice);
});

test('generatePanino excludes ingredients not allowed for panino from request', () => {
  const result = engine.generatePanino({
    richiesta: 'fammi un panino con tonno e mozzarella',
    menu: [{ ingredienti: ['tonno', 'mozzarella', 'pomodoro'] }]
  });

  assert.equal(result.nome, 'Panino Personalizzato');
  assert.equal(result.ingredienti.includes('tonno'), false);
  assert.equal(result.ingredienti.includes('mozzarella'), true);
});
