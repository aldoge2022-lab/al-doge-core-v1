const test = require('node:test');
const assert = require('node:assert/strict');

const { handler: orchestratorHandler } = require('../netlify/functions/ai-orchestrator');
const { handler } = require('../netlify/functions/ai-engine');

test('ai-engine proxies directly to ai-orchestrator handler', () => {
  assert.equal(handler, orchestratorHandler);
});
