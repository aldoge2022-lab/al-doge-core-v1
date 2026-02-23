const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('index.html no longer loads static catalog script', () => {
  const html = read('public/index.html');
  assert.ok(!html.includes('/data/catalog.js'));
});

test('public/data directory is removed', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'public/data')), false);
});

test('menu-render loads menu only from api-menu endpoint without static fallback', () => {
  const script = read('public/js/menu-render.js');
  assert.ok(script.includes("fetch('/.netlify/functions/api-menu')"));
  assert.ok(!script.includes('window.ALDOGE_CATALOG ||'));
  assert.ok(!script.includes('/data/catalog.js'));
});
