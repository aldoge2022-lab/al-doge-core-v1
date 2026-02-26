const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const publicJsDir = path.join(repoRoot, 'public/js');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('frontend scripts target orchestrator-v2 endpoint', () => {
  const aiController = read('public/js/ai-controller.js');
  const aiSuggest = read('public/js/ai-suggest.js');

  assert.match(aiController, /\/\.netlify\/functions\/orchestrator-v2/);
  assert.match(aiSuggest, /\/\.netlify\/functions\/orchestrator-v2/);
});

test('public js has no openai-suggestion endpoint references', () => {
  const files = fs.readdirSync(publicJsDir).filter((name) => name.endsWith('.js'));

  for (const name of files) {
    const content = fs.readFileSync(path.join(publicJsDir, name), 'utf8');
    assert.doesNotMatch(
      content,
      /\/\.netlify\/functions\/openai-suggestion/,
      `${name} should not call openai-suggestion`
    );
  }
});
