const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/ai-health');
const openaiModulePath = require.resolve('openai');

test.beforeEach(() => {
  delete require.cache[modulePath];
  delete require.cache[openaiModulePath];
  delete process.env.OPENAI_API_KEY;
});

test('ai-health returns error when OPENAI_API_KEY is missing', async () => {
  const { handler } = require('../netlify/functions/ai-health');
  const response = await handler({});

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    status: 'error',
    reason: 'OPENAI_API_KEY missing'
  });
});

test('ai-health returns ok when OpenAI minimal call succeeds', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  process.env.OPENAI_API_KEY = 'test-key';

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async () => ({ id: 'resp_ok' })
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/ai-health');
    const response = await handler({});
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});

test('ai-health returns error reason when OpenAI call fails', async () => {
  const originalOpenAIModule = require.cache[openaiModulePath];
  process.env.OPENAI_API_KEY = 'test-key';

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async () => {
            throw new Error('upstream unavailable');
          }
        };
      }
    }
  };

  try {
    const { handler } = require('../netlify/functions/ai-health');
    const response = await handler({});
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      status: 'error',
      reason: 'upstream unavailable'
    });
  } finally {
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
  }
});
