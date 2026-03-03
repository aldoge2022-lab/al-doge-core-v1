const test = require('node:test');
const assert = require('node:assert/strict');

const { handler } = require('../netlify/functions/openai-suggestion');

test('openai-suggestion returns 405 for non-POST', async () => {
  const response = await handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 405);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'METHOD_NOT_ALLOWED');
});

test('openai-suggestion returns 400 when prompt is missing', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Prompt mancante');
});

test('openai-suggestion returns unified suggestion payload', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ prompt: 'Fammi una pizza piccante' })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(Array.isArray(body.suggestion.items), true);
  assert.equal(typeof body.suggestion.note, 'string');
  assert.equal(body.suggestion.note, '');
});

test('openai-suggestion emits full AI diagnostic logging block', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args);

  try {
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ prompt: 'Fammi una pizza piccante' })
    });
    assert.equal(response.statusCode, 200);
  } finally {
    console.log = originalLog;
  }

  const headers = logs.map((args) => args[0]);
  assert.equal(headers.includes('=== AI DEBUG START ==='), true);
  assert.equal(headers.includes('PROMPT:'), true);
  assert.equal(headers.includes('AVAILABLE IDS:'), true);
  assert.equal(headers.includes('OPENAI RAW CONTENT:'), true);
  assert.equal(headers.includes('PARSED IDS:'), true);
  assert.equal(headers.includes('VALID IDS AFTER FILTER:'), true);
  assert.equal(headers.includes('AI IDS:'), true);
  assert.equal(headers.includes('FINAL IDS USED:'), true);
  assert.equal(headers.includes('=== AI DEBUG END ==='), true);
});

test('openai-suggestion sends full active menu semantic context to OpenAI prompt', async () => {
  const openaiModulePath = require.resolve('openai');
  const suggestionModulePath = require.resolve('../netlify/functions/openai-suggestion');
  const originalOpenAIModule = require.cache[openaiModulePath];
  const originalSuggestionModule = require.cache[suggestionModulePath];
  const originalApiKey = process.env.OPENAI_API_KEY;
  let capturedRequest = null;

  require.cache[openaiModulePath] = {
    id: openaiModulePath,
    filename: openaiModulePath,
    loaded: true,
    exports: class OpenAI {
      constructor() {
        this.responses = {
          create: async (request) => {
            capturedRequest = request;
            return { output_text: '{"ids":["margherita"]}' };
          }
        };
      }
    }
  };

  delete require.cache[suggestionModulePath];
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const { handler: isolatedHandler } = require('../netlify/functions/openai-suggestion');
    const response = await isolatedHandler({
      httpMethod: 'POST',
      body: JSON.stringify({
        prompt: 'Voglio qualcosa con tonno',
        catalog: {
          menu: [
            {
              id: 'margherita',
              name: 'Pizza Margherita',
              ingredients: 'pomodoro, mozzarella',
              category: 'classiche',
              active: true
            },
            {
              id: 'tonno-cipolla',
              name: 'Pizza Tonno e Cipolla',
              ingredients: 'tonno, cipolla',
              active: true
            }
          ]
        }
      })
    });

    assert.equal(response.statusCode, 200);
    const userText = capturedRequest.input[1].content[0].text;
    assert.equal(userText.includes('Menu attivo:'), true);
    assert.equal(userText.includes('ID: margherita'), true);
    assert.equal(userText.includes('Nome: Pizza Margherita'), true);
    assert.equal(userText.includes('Ingredienti: pomodoro, mozzarella'), true);
    assert.equal(userText.includes('Categoria: classiche'), true);
    assert.match(
      userText,
      /ID: tonno-cipolla[\s\S]*Nome: Pizza Tonno e Cipolla[\s\S]*Ingredienti: tonno, cipolla[\s\S]*Categoria:\s*(?:\n|$)/
    );
  } finally {
    delete require.cache[suggestionModulePath];
    if (originalSuggestionModule) {
      require.cache[suggestionModulePath] = originalSuggestionModule;
    }
    if (originalOpenAIModule) {
      require.cache[openaiModulePath] = originalOpenAIModule;
    } else {
      delete require.cache[openaiModulePath];
    }
    if (typeof originalApiKey === 'undefined') {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }
});

test('openai-suggestion handles non-string IDs in tie-break sorting deterministically', async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      prompt: 'zzzz-nomatch',
      catalog: {
        menu: [
          { id: 2, name: 'Item Due', ingredients: '', category: '', active: true },
          { id: null, name: 'Item Null', ingredients: '', category: '', active: true },
          { id: 10, name: 'Item Dieci', ingredients: '', category: '', active: true }
        ]
      }
    })
  });

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.deepEqual(
    body.suggestion.items.map((item) => item.id),
    ['2', '10']
  );
});
