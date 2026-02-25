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

function normalizeClientPayload(payload = {}) {
  const message = typeof payload.message === 'string' ? payload.message : null;
  return {
    ...payload,
    cartUpdates: Array.isArray(payload.cartUpdates) ? payload.cartUpdates : [],
    message,
    result: message
  };
}

function tryParseJson(body, fallback) {
  if (typeof body !== 'string') return fallback;
  try {
    return JSON.parse(body);
  } catch (_) {
    return fallback;
  }
}

function parseToolArguments(argumentsJson) {
  if (!argumentsJson) return {};
  if (typeof argumentsJson !== 'string') return argumentsJson;
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

  return { action: 'noop' };
}

async function createOpenAIClient() {
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function toCartUpdate(toolName, output) {
  if (toolName !== 'add_menu_item_to_cart') return null;

  const menuItemId = String(output?.itemId || '').trim();
  const qty = Math.max(1, Number(output?.qty) || 1);
  if (!menuItemId) return null;

  return {
    type: 'add',
    menuItemId,
    qty
  };
}

exports.handler = async (event) => {

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, normalizeClientPayload({
      ok: false,
      error: 'Metodo non consentito',
      message: 'Metodo non consentito'
    }));
  }

  const body = tryParseJson(event.body, {});
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const cart = Array.isArray(body.cart) ? body.cart : [];

  if (!prompt) {
    return jsonResponse(400, normalizeClientPayload({
      ok: false,
      error: 'Prompt mancante',
      message: 'Prompt mancante'
    }));
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(200, normalizeClientPayload({
      cartUpdates: [],
      message: 'Chiave OpenAI non configurata.'
    }));
  }

  const toolsCalled = [];
  const finalActions = [];
  const cartUpdates = [];

  try {

    const client = await createOpenAIClient();

    const tools = [
      {
        type: 'function',
        function: {
          name: 'create_custom_panino',
          strict: true,
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ingredientIds: { type: 'array', items: { type: 'string' } }
            },
            required: ['ingredientIds']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'add_menu_item_to_cart',
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
        }
      }
    ];

    const input = [
      { role: 'system', content: 'Usa solo tool con ID reali del food-core.' },
      { role: 'user', content: prompt }
    ];

    let response = await client.responses.create({
      model: 'gpt-4o-mini-2024-07-18',
      input,
      tools
    });

    let assistantMessage = null;

    while (toolsCalled.length < MAX_TOOL_CALLS) {

      const outputs = Array.isArray(response?.output) ? response.output : [];

      const toolCalls = outputs.filter(o => o.type === 'tool_call');
      const messageItem = outputs.find(o => o.type === 'message');

      if (toolCalls.length > 0) {

        for (const toolCall of toolCalls) {

          const output = await runToolCall(toolCall, { cart });

          toolsCalled.push(toolCall.name);
          finalActions.push({ tool: toolCall.name, ok: true });

          const cartUpdate = toCartUpdate(toolCall.name, output);
          if (cartUpdate) cartUpdates.push(cartUpdate);

          response = await client.responses.create({
            model: 'gpt-4o-mini-2024-07-18',
            previous_response_id: response.id,
            input: [{
              type: 'function_call_output',
              call_id: toolCall.call_id,
              output: JSON.stringify(output)
            }]
          });
        }

        continue;
      }

      if (messageItem) {
        assistantMessage = messageItem.content?.[0]?.text || null;
      }

      break;
    }

    const assistantReply =
      assistantMessage ||
      'Posso aiutarti a scegliere qualcosa dal menu.';

    return jsonResponse(200, normalizeClientPayload({
      ok: true,
      reply: assistantReply,
      toolsCalled,
      finalActions,
      cartUpdates,
      message: assistantReply
    }));

  } catch (error) {

    console.error('AI ERROR:', error);

    return jsonResponse(200, normalizeClientPayload({
      cartUpdates: [],
      message: 'Errore AI temporaneo.'
    }));
  }
};
