const test = require('node:test');
const assert = require('node:assert/strict');

const { buildItem } = require('../netlify/functions/ordine-ai/build-item');

const ingredientiTable = [
  { nome: 'pomodoro', categoria_tecnica: 'salsa', prezzo_extra: 1, allergeni: [] },
  { nome: 'mozzarella', categoria_tecnica: 'latticini', prezzo_extra: 3, allergeni: ['lattosio'] },
  { nome: 'burrata', categoria_tecnica: 'latticini', prezzo_extra: 3, allergeni: ['lattosio'] },
  { nome: 'tonno', categoria_tecnica: 'pesce', prezzo_extra: 2.5, allergeni: ['pesce'] },
  { nome: 'insalata', categoria_tecnica: 'verdura', prezzo_extra: 1.5, allergeni: [] }
];

const impasti = { normale: 0, kamut: 1.5 };

test('Panino con tonno deve fallire', () => {
  const response = buildItem({
    payload: { custom: true, categoria: 'panino', ingredienti: ['tonno'] },
    ingredientiTable,
    impasti
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /tonno/i);
});

test('Pizza custom con tonno deve passare', () => {
  const response = buildItem({
    payload: { custom: true, categoria: 'pizza', ingredienti: ['tonno'] },
    ingredientiTable,
    impasti
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.prezzo, 7.5);
});

test('Pizza custom con burrata deve aggiungere +3€', () => {
  const response = buildItem({
    payload: { custom: true, categoria: 'pizza', ingredienti: ['burrata'] },
    ingredientiTable,
    impasti
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.prezzo, 8);
});

test('Panino custom con verdura deve aggiungere +1.50€', () => {
  const response = buildItem({
    payload: { custom: true, categoria: 'panino', ingredienti: ['insalata'] },
    ingredientiTable,
    impasti
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.prezzo, 8.5);
});

test('Pizza con impasto kamut deve aggiungere +1.50€', () => {
  const response = buildItem({
    payload: { custom: true, categoria: 'pizza', ingredienti: [], impasto: 'kamut' },
    ingredientiTable,
    impasti
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.prezzo, 6.5);
});

test('Mozzarella senza lattosio deve rimuovere allergene lattosio', () => {
  const response = buildItem({
    payload: { custom: true, categoria: 'pizza', ingredienti: ['mozzarella'], senza_lattosio: true },
    ingredientiTable,
    impasti
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.prezzo, 8);
  assert.deepEqual(response.body.allergeni, []);
});

test('Ingrediente inventato deve restituire errore 400', () => {
  const response = buildItem({
    payload: { custom: true, categoria: 'pizza', ingredienti: ['ananas-spaziale'] },
    ingredientiTable,
    impasti
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /Ingrediente non esistente/);
});

test('Duplicati vengono normalizzati per evitare vulnerabilità pricing', () => {
  const response = buildItem({
    payload: { custom: true, categoria: 'pizza', ingredienti: ['burrata', 'burrata'] },
    ingredientiTable,
    impasti
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.ingredienti, ['burrata']);
  assert.equal(response.body.prezzo, 8);
});

test('Modifica pizza esistente ricalcola prezzo server-side', () => {
  const existingItems = new Map([
    ['pizza-1', { categoria: 'pizza', ingredienti: ['pomodoro'], impasto: 'normale', senza_lattosio: false }]
  ]);
  const response = buildItem({
    payload: { item_id: 'pizza-1', aggiungi: ['burrata'], rimuovi: [], impasto: 'kamut' },
    ingredientiTable,
    impasti,
    existingItems
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.ingredienti, ['pomodoro', 'burrata']);
  assert.equal(response.body.prezzo, 10.5);
});


test('Pizza custom oltre limite ingredienti da regole centralizzate deve fallire', () => {
  const response = buildItem({
    payload: { custom: true, categoria: 'pizza', ingredienti: ['pomodoro','mozzarella','burrata','insalata','tonno','pomodoro1','pomodoro2','pomodoro3','pomodoro4'] },
    ingredientiTable: [
      ...ingredientiTable,
      { nome: 'pomodoro1', categoria_tecnica: 'salsa', prezzo_extra: 1, allergeni: [] },
      { nome: 'pomodoro2', categoria_tecnica: 'salsa', prezzo_extra: 1, allergeni: [] },
      { nome: 'pomodoro3', categoria_tecnica: 'salsa', prezzo_extra: 1, allergeni: [] },
      { nome: 'pomodoro4', categoria_tecnica: 'salsa', prezzo_extra: 1, allergeni: [] }
    ],
    impasti
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'Troppe aggiunte per pizza personalizzata');
});
