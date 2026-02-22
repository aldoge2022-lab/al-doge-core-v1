const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const enginePath = path.join(__dirname, '..', 'netlify', 'functions', 'ordine-ai', 'engine.js');

test('ordine-ai engine file exports aiEngine with pizza and panino generators', () => {
  const source = fs.readFileSync(enginePath, 'utf8');

  assert.match(source, /export const aiEngine/);
  assert.match(source, /generatePizza/);
  assert.match(source, /generatePanino/);
});
