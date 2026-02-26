const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('ai-controller posts prompts to orchestrator-v2 netlify function', () => {
  const script = read('public/js/ai-controller.js');
  assert.match(
    script,
    /fetch\("\/\.netlify\/functions\/orchestrator-v2",\s*\{[\s\S]*method:\s*"POST"/
  );
});

test('ai-controller accepts reply-based responses without legacy result validation', () => {
  const script = read('public/js/ai-controller.js');
  assert.match(script, /typeof data\?\.\s*reply === "string"/);
  assert.doesNotMatch(script, /data\.result/);
  assert.doesNotMatch(script, /Risposta ricevuta ma formato non valido/);
  assert.match(script, /data\.action === "add_to_cart"/);
});

test('index.html loads ai-controller script with defer', () => {
  const html = read('public/index.html');
  assert.match(html, /<script\s+defer\s+src="\/js\/ai-controller\.js"><\/script>/);
});
