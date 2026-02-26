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

test('index.html loads ai-controller script with defer', () => {
  const html = read('public/index.html');
  assert.match(html, /<script\s+defer\s+src="\/js\/ai-controller\.js"><\/script>/);
});

test('ai-controller validates orchestrator-v2 reply schema and errors', () => {
  const script = read('public/js/ai-controller.js');
  assert.match(script, /typeof data\.reply !== "string"/);
  assert.doesNotMatch(script, /Risposta ricevuta ma formato non valido/);
  assert.match(script, /Errore di comunicazione con il server\./);
  assert.ok(script.includes('if (!data || typeof data.reply !== "string")'));
});

test('ai-controller handles add_to_cart and upsell session state', () => {
  const script = read('public/js/ai-controller.js');
  assert.match(script, /data\.action === "add_to_cart"/);
  assert.match(script, /data\.mainItem\.id/);
  assert.match(script, /window\.aiSessionState\s*=\s*\{/);
});
