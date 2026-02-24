const { createCustomPanino } = require('../../core/menu/panino-engine');
const { validateIngredientIds } = require('../../core/menu/food-engine');

const MAX_TOOL_CALLS = 3;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function tryParseJson(body, fallback) {
  if (typeof body !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(body);
  } catch (_) {
    return fallback;
  }
}

function getToolCalls(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  return output.filter((entry) => entry?.type === 'function_call' && entry?.name);
}

function parseToolArguments(argumentsJson) {
  if (!argumentsJson || typeof argumentsJson !== 'string') {
    return {};
  }

  try {
    return JSON.parse(argumentsJson);
  } catch (_) {
    return {};
  }
}

async function runToolCall(call, context = {}) {
  const args = parseToolArguments(call.arguments);
  if (call.name === 'create_custom_panino') {
    const ingredientIds = Array.isArray(args.ingredientIds) ? args.ingredientIds : [];
    if (!validateIngredientIds(ingredientIds)) {
      throw new Error('Invalid ingredientIds provided');
    }

    return createCustomPanino({
      ingredientIds,
      impasto: args.impasto,
      mozzarella: args.mozzarella
    });
  }

  if (call.name === 'add_menu_item_to_cart') {
    return {
      action: 'add_menu_item_to_cart',
      itemId: String(args.itemId || ''),
      qty: Number(args.qty) || 1
    };
  }

  if (call.name === 'suggest_pairing') {
    return {
      action: 'suggest_pairing',
      itemId: String(args.itemId || ''),
      suggestion: 'Acqua 0.5L'
    };
  }

  if (call.name === 'proceed_to_checkout') {
    const { handler: createCheckoutHandler } = require('./create-checkout');
    return createCheckoutHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ cart: Array.isArray(context.cart) ? context.cart : [] })
    });
  }

  return { action: 'noop' };
}

async function createOpenAIClient() {
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function toCartUpdate(toolName, output) {
  if (toolName !== 'add_menu_item_to_cart') {
    return null;
  }

  const menuItemId = String(output?.itemId || '').trim();
  const qty = Math.max(1, Number(output?.qty) || 1);
  if (!menuItemId) {
    return null;
  }

  return {
    type: 'add',
    menuItemId,
    qty
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Metodo non consentito'
    });
  }

  const body = tryParseJson(event.body, {});
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const cart = Array.isArray(body.cart) ? body.cart : [];
  const toolsCalled = [];
  const finalActions = [];
  const cartUpdates = [];

  console.log('=== AI ORCHESTRATOR START ===');
  console.log('METHOD:', event.httpMethod);
  console.log('RAW BODY:', event.body);
  console.log('PROMPT:', prompt);

  if (!process.env.OPENAI_API_KEY || !String(process.env.OPENAI_API_KEY).trim()) {
    console.log('TOOLS CALLED:', toolsCalled);
    console.log('FINAL ACTIONS:', finalActions);
    console.log('FINAL RESPONSE SENT');
    console.log('=== AI ORCHESTRATOR END ===');
    return jsonResponse(200, {
      ok: true,
      fallback: true,
      reply: 'AI orchestrator non disponibile: OPENAI_API_KEY mancante.',
      toolsCalled,
      finalActions,
      cartUpdates
    });
  }

  if (!prompt) {
    console.log('TOOLS CALLED:', toolsCalled);
    console.log('FINAL ACTIONS:', finalActions);
    console.log('FINAL RESPONSE SENT');
    console.log('=== AI ORCHESTRATOR END ===');
    return jsonResponse(400, {
      ok: false,
      error: 'Prompt mancante'
    });
  }

  try {
    const client = await createOpenAIClient();
    const tools = [
      {
        type: 'function',
        name: 'create_custom_panino',
        description: 'Crea un panino custom con ID ingredienti reali del food-core.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ingredientIds: { type: 'array', items: { type: 'string' } },
            impasto: { type: 'string' },
            mozzarella: { type: 'string' }
          },
          required: ['ingredientIds']
        }
      },
      {
        type: 'function',
        name: 'add_menu_item_to_cart',
        description: 'Aggiunge un item del menu al carrello.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            itemId: { type: 'string' },
            qty: { type: 'number' }
          },
          required: ['itemId']
        }
      },
      {
        type: 'function',
        name: 'suggest_pairing',
        description: 'Suggerisce abbinamenti a un item del menu.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            itemId: { type: 'string' }
          },
          required: ['itemId']
        }
      }
    ];

    let response = await client.responses.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      input: [
        {
          role: 'system',
          content: [{
            type: 'input_text',
            text: 'Usa solo tool con ID reali del food-core. Non usare nomi ingredienti.'
          }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }]
        }
      ],
      tools
    });

    while (toolsCalled.length < MAX_TOOL_CALLS) {
      const pendingCalls = getToolCalls(response);
      if (!pendingCalls.length) {
        break;
      }

      const remaining = MAX_TOOL_CALLS - toolsCalled.length;
      const executableCalls = pendingCalls.slice(0, remaining);

      const outputs = [];
      for (const call of executableCalls) {
        try {
          const output = await runToolCall(call, { cart });
          toolsCalled.push(call.name);
          finalActions.push({ tool: call.name, ok: true });
          const cartUpdate = toCartUpdate(call.name, output);
          if (cartUpdate) {
            cartUpdates.push(cartUpdate);
          }
          outputs.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(output)
          });
        } catch (error) {
          toolsCalled.push(call.name);
          finalActions.push({ tool: call.name, ok: false, error: error.message || 'Tool error' });
          outputs.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify({ error: error.message || 'Tool error' })
          });
        }
      }

      response = await client.responses.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        previous_response_id: response.id,
        input: outputs
      });
    }

    const assistantReply = typeof response?.output_text === 'string' ? response.output_text : '';

    console.log('TOOLS CALLED:', toolsCalled);
    console.log('FINAL ACTIONS:', finalActions);
    console.log('FINAL RESPONSE SENT');
    console.log('=== AI ORCHESTRATOR END ===');

    return jsonResponse(200, {
      ok: true,
      reply: assistantReply,
      toolsCalled,
      finalActions,
      cartUpdates
    });
  } catch (error) {
    console.error('AI ORCHESTRATOR ERROR:', error);
    console.log('TOOLS CALLED:', toolsCalled);
    console.log('FINAL ACTIONS:', finalActions);
    console.log('FINAL RESPONSE SENT');
    console.log('=== AI ORCHESTRATOR END ===');

    return jsonResponse(200, {
      ok: false,
      error: 'AI orchestrator temporaneamente non disponibile',
      toolsCalled,
      finalActions,
      cartUpdates
    });
  }
};
