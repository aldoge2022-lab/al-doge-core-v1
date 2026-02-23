const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'public/js/menu-render.js'), 'utf8');

test('homepage limits each category to 3 pizzas', () => {
  assert.match(script, /\.slice\(0, 3\)/);
});

test('category page filters menu by categoria slug', () => {
  assert.match(script, /pizza\.categoria === slug/);
  assert.ok(script.includes('window.location.pathname.match(/^\\/menu\\/([^/]+)\\/?$/)'));
});

test('seo title for category pages is dynamic', () => {
  assert.match(script, /document\.title = 'Pizze ' \+ label \+ ' \| AL DOGE'/);
});
