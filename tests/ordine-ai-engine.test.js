const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const enginePath = path.join(__dirname, '..', 'netlify', 'functions', 'ordine-ai', 'engine.js');

test('ordine-ai engine exports pizza and panino generators with expected shape', async () => {
  const source = fs.readFileSync(enginePath, 'utf8');
  const moduleUrl = `data:text/javascript,${encodeURIComponent(source)}`;
  const { aiEngine } = await import(moduleUrl);
  const menu = [
    { ingredienti: ['pomodoro', 'mozzarella', 'basilico'] },
    { ingredienti: ['tonno', 'cipolla', 'pomodoro'] }
  ];
  const originalRandom = Math.random;
  let pizza;
  let panino;
  try {
    Math.random = () => 0.1;
    pizza = aiEngine.generatePizza({ richiesta: 'fammi una pizza', menu });
    panino = aiEngine.generatePanino({ richiesta: 'fammi un panino', menu });
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(pizza.nome, 'Pizza Personalizzata');
  assert.equal(pizza.ingredienti.length, 3);
  assert.equal(pizza.prezzo, 10.5);

  assert.equal(panino.nome, 'Panino Personalizzato');
  assert.equal(panino.ingredienti.length, 4);
  assert.equal(panino.prezzo, 11);
});
