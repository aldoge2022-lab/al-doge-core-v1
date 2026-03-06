const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('ai-controller posts prompts to ai-orchestrator netlify function', () => {
  const script = read('public/js/ai-controller.js');
  assert.match(
    script,
    /fetch\("\/\.netlify\/functions\/ai-orchestrator",\s*\{[\s\S]*method:\s*"POST"/
  );
});

test('ai-controller consumes ai-orchestrator reply payloads and optionally adds items', () => {
  const script = read('public/js/ai-controller.js');
  assert.match(script, /if\s*\(\s*data\.reply\)/);
  assert.match(script, /data\.ok\s*===\s*true/);
  assert.match(script, /window\.addToCart/);
});

test('index.html loads ai-controller script with defer', () => {
  const html = read('public/index.html');
  assert.match(html, /<script\s+defer\s+src="\/js\/ai-controller\.js"><\/script>/);
});
