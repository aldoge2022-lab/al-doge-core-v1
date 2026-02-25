const OpenAI = require('openai');
const catalog = require('../../data/catalog');
const { createCustomPanino } = require('../../core/menu/panino-engine');
const { handler: createCheckoutHandler } = require('./create-checkout');

const MODEL = 'gpt-4o-mini-2024-07-18';
const MAX_TOOL_CALLS = 6;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function normalizeClientPayload(payload) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const message = typeof safePayload.message === 'string' ? safePayload.message : '';
  return {
    ...safePayload,
    cartUpdates: Array.isArray(safePayload.cartUpdates) ? safePayload.cartUpdates : [],
    message,
    result: message
  };
}

function parseJson(input, fallback = {}) {
  try {
    return JSON.parse(input || '{}');
  } catch (_) {
    return fallback;
  }
}

async function createOpenAIClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Chiave OpenAI non configurata.');
  }
  return new OpenAI({ apiKey });
}

function toCartUpdate(toolName, output) {
  if (toolName === 'add_menu_item_to_cart' && output && output.itemId) {
    return {
      type: 'add',
      menuItemId: String(output.itemId),
      qty: Number(output.qty) || 1
    };
  }

  return null;
}

function mapAiErrorMessage(error) {
  if (error?.status === 401) return 'Errore configurazione AI (chiave non valida).';
  if (error?.status === 429) return 'Servizio AI momentaneamente sovraccarico.';
  if (error?.message === 'Chiave OpenAI non configurata.') return error.message;
  return 'Errore AI temporaneo.';
}

async function runToolCall(toolCall, context) {
  const args = parseJson(toolCall?.arguments, {});

  if (toolCall?.name === 'create_custom_panino') {
    return createCustomPanino({
      ingredientIds: Array.isArray(args.ingredientIds) ? args.ingredientIds : [],
      impasto: args.impasto ?? undefined,
      mozzarella: args.mozzarella ?? undefined
    });
  }

  if (toolCall?.name === 'add_menu_item_to_cart') {
    return {
      itemId: String(args.itemId || ''),
      qty: Number(args.qty) || 1
    };
  }

  if (toolCall?.name === 'suggest_pairing') {
    const menuItemId = String(args.menuItemId || '');
    const pizza = (catalog.menu || []).find((item) => item && item.id === menuItemId);
    return {
      menuItemId,
      pairing: pizza ? `Ti consiglio una ${pizza.name}.` : 'Ti consiglio una bevanda fresca.'
    };
  }

  if (toolCall?.name === 'proceed_to_checkout') {
    const checkoutResponse = await createCheckoutHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ cart: Array.isArray(context?.cart) ? context.cart : [] })
    });
    return parseJson(checkoutResponse?.body, {});
  }

  return { ok: false, error: 'Tool non supportato' };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, normalizeClientPayload({
      cartUpdates: [],
      message: 'Metodo non consentito'
    }));
  }

  const { prompt, cart } = parseJson(event.body, {});
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return jsonResponse(400, normalizeClientPayload({
      cartUpdates: [],
      message: 'Prompt mancante'
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
              ingredientIds: { type: 'array', items: { type: 'string' } },
              impasto: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              mozzarella: { anyOf: [{ type: 'string' }, { type: 'null' }] }
            },
            required: ['ingredientIds', 'impasto', 'mozzarella']
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
      },
      {
        type: 'function',
        function: {
          name: 'suggest_pairing',
          strict: true,
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              menuItemId: { type: 'string' }
            },
            required: ['menuItemId']
          }
        }
      }
    ];

    const input = [
      { role: 'system', content: 'Usa solo tool con ID reali del food-core.' },
      { role: 'user', content: prompt.trim() }
    ];

    let response = await client.responses.create({
      model: MODEL,
      input,
      tools
    });

    let assistantMessage = null;

    while (toolsCalled.length < MAX_TOOL_CALLS) {
      const outputs = Array.isArray(response?.output) ? response.output : [];

      const toolCalls = outputs.filter((o) => o.type === 'tool_call');
      const messageItem = outputs.find((o) => o.type === 'message');

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          const output = await runToolCall(toolCall, { cart });

          toolsCalled.push(toolCall.name);
          finalActions.push({ tool: toolCall.name, ok: true });

          const cartUpdate = toCartUpdate(toolCall.name, output);
          if (cartUpdate) cartUpdates.push(cartUpdate);

          response = await client.responses.create({
            model: MODEL,
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
      } else if (typeof response?.output_text === 'string' && response.output_text.trim()) {
        assistantMessage = response.output_text.trim();
      }

      break;
    }

    const assistantReply = assistantMessage || 'Posso aiutarti a scegliere qualcosa dal menu.';

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
      message: mapAiErrorMessage(error)
    }));
  }
};
