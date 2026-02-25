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

function tryParseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function normalizeClientPayload(payload) {
  const message = typeof payload?.message === 'string'
    ? payload.message
    : (typeof payload?.reply === 'string' ? payload.reply : '');

  return {
    ...payload,
    cartUpdates: Array.isArray(payload?.cartUpdates) ? payload.cartUpdates : [],
    message,
    result: message
  };
}

function parseArgs(args) {
  if (!args) return {};
  if (typeof args === 'string') {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return args;
}

async function createOpenAIClient() {
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function toCartUpdate(toolName, output) {
  if (toolName !== 'add_menu_item_to_cart') return null;

  return {
    type: 'add',
    menuItemId: String(output.itemId),
    qty: Math.max(1, Number(output.qty) || 1)
  };
}

async function runToolCall(toolCall, { cart }) {
  const args = parseArgs(toolCall.arguments);

  if (toolCall.name === 'create_custom_panino') {
    const ingredientIds = Array.isArray(args.ingredientIds) ? args.ingredientIds : [];
    if (!validateIngredientIds(ingredientIds)) {
      throw new Error('Invalid ingredientIds');
    }
    return createCustomPanino({
      ingredientIds,
      impasto: args.impasto || undefined,
      mozzarella: args.mozzarella || undefined
    });
  }

  if (toolCall.name === 'add_menu_item_to_cart') {
    return {
      itemId: String(args.itemId),
      qty: Number(args.qty) || 1
    };
  }

  if (toolCall.name === 'proceed_to_checkout') {
    const { handler } = require('./create-checkout');
    const checkoutResponse = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ cart })
    });
    return tryParseJson(checkoutResponse?.body || '{}');
  }

  if (toolCall.name === 'suggest_pairing') {
    return { ok: true };
  }

  return {};
}

function mapAiErrorMessage(status) {
  if (status === 401) return 'Errore configurazione AI (chiave non valida).';
  if (status === 429) return 'Servizio AI momentaneamente sovraccarico.';
  return 'Errore AI temporaneo.';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, normalizeClientPayload({
      cartUpdates: [],
      message: 'Metodo non consentito'
    }));
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(200, normalizeClientPayload({
      cartUpdates: [],
      message: 'Chiave OpenAI non configurata.'
    }));
  }

  const body = tryParseJson(event.body);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const cart = Array.isArray(body.cart) ? body.cart : [];

  if (!prompt) {
    return jsonResponse(400, normalizeClientPayload({
      cartUpdates: [],
      message: 'Prompt mancante'
    }));
  }

  const cartUpdates = [];
  const toolsCalled = [];
  const finalActions = [];

  try {
    const client = await createOpenAIClient();

    const tools = [
      {
        type: 'function',
        name: 'create_custom_panino',
        description: 'Crea un panino personalizzato con ingredienti validi.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ingredientIds: { type: 'array', items: { type: 'string' } },
            impasto: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            mozzarella: { anyOf: [{ type: 'string' }, { type: 'null' }] }
          },
          required: ['ingredientIds']
        }
      },
      {
        type: 'function',
        name: 'add_menu_item_to_cart',
        description: 'Aggiunge un elemento del menu al carrello.',
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
        description: 'Suggerisce un abbinamento per un elemento del menu.',
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
      const toolCalls = outputs.filter((output) => output.type === 'tool_call');
      const messageItem = outputs.find((output) => output.type === 'message');

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

    const assistantReply = assistantMessage || response?.output_text || 'Posso aiutarti a scegliere qualcosa dal menu.';

    return jsonResponse(200, normalizeClientPayload({
      ok: true,
      reply: assistantReply,
      toolsCalled,
      finalActions,
      cartUpdates,
      message: assistantReply
    }));
  } catch (error) {
    console.error('AI FULL ERROR:', error);

    return jsonResponse(200, normalizeClientPayload({
      cartUpdates: [],
      message: mapAiErrorMessage(error?.status)
    }));
  }
};
