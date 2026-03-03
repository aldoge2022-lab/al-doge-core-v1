const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('ai-controller posts prompts to ai-engine netlify function', () => {
  const script = read('public/js/ai-controller.js');
  assert.match(
    script,
    /fetch\("\/\.netlify\/functions\/ai-engine",\s*\{[\s\S]*method:\s*"POST"/
  );
});

test('ai-controller accepts reply-based responses without legacy result validation', () => {
  const script = read('public/js/ai-controller.js');
  assert.match(script, /if\s*\(!data\s*\|\|\s*!data\.reply\)/);
  assert.doesNotMatch(script, /resultBox\.textContent\s*=\s*typeof data\.result/);
  assert.doesNotMatch(script, /Risposta ricevuta ma formato non valido/);
  assert.match(script, /data\.ok && data\.item/);
});

test('index.html loads ai-controller script with defer', () => {
  const html = read('public/index.html');
  assert.match(html, /<script\s+defer\s+src="\/js\/ai-controller\.js"><\/script>/);
});
