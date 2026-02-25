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
      code: 'METHOD_NOT_ALLOWED',
      error: 'Metodo non consentito',
      message: 'Metodo non consentito'
    }));
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

  if (!prompt) {
    return jsonResponse(400, normalizeClientPayload({
      ok: false,
      error: 'Prompt mancante',
      message: 'Prompt mancante'
    }));
  }

  if (!process.env.OPENAI_API_KEY || !String(process.env.OPENAI_API_KEY).trim()) {
    return jsonResponse(200, normalizeClientPayload({
      cartUpdates: [],
      message: 'Chiave OpenAI non configurata.',
      result: 'Chiave OpenAI non configurata.'
    }));
  }

  try {
    const client = await createOpenAIClient();

    const tools = [
      {
        type: 'function',
        function: {
          name: 'create_custom_panino',
          description: 'Crea un panino custom con ID ingredienti reali del food-core.',
          strict: true,
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
        }
      },
      {
        type: 'function',
        function: {
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
        }
      },
      {
        type: 'function',
        function: {
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
      }
    ];

    const input = [
      { role: 'system', content: 'Usa solo tool con ID reali del food-core. Non usare nomi ingredienti.' },
      { role: 'user', content: prompt }
    ];

    let response = await client.responses.create({
      model: 'gpt-4o-mini-2024-07-18',
      input,
      tools
    });

    console.log('OPENAI_RAW_RESPONSE', JSON.stringify(response, null, 2));

    let assistantMessage = null;

    while (toolsCalled.length < MAX_TOOL_CALLS) {
      const first = Array.isArray(response?.output) ? response.output[0] : null;

      if (!first) break;

      if (first.type === 'tool_call') {
        try {
          const output = await runToolCall(first, { cart, ...parseToolArguments(first.arguments) });
          toolsCalled.push(first.name);
          finalActions.push({ tool: first.name, ok: true });

          const cartUpdate = toCartUpdate(first.name, output);
          if (cartUpdate) cartUpdates.push(cartUpdate);

          response = await client.responses.create({
            model: 'gpt-4o-mini-2024-07-18',
            previous_response_id: response.id,
            input: [{
              type: 'function_call_output',
              call_id: first.call_id,
              output: JSON.stringify(output)
            }]
          });
        } catch (error) {
          toolsCalled.push(first.name);
          finalActions.push({ tool: first.name, ok: false, error: error.message });

          response = await client.responses.create({
            model: 'gpt-4o-mini-2024-07-18',
            previous_response_id: response.id,
            input: [{
              type: 'function_call_output',
              call_id: first.call_id,
              output: JSON.stringify({ error: error.message })
            }]
          });
        }

        continue;
      }

      if (first.type === 'message') {
        assistantMessage =
          first.content?.[0]?.text ||
          response?.output_text ||
          null;
      }

      break;
    }

    const assistantReply =
      assistantMessage ||
      response?.output_text ||
      (Array.isArray(response?.output) ? response.output[0]?.content?.[0]?.text : null) ||
      'Non ho capito la richiesta.';

    return jsonResponse(200, normalizeClientPayload({
      ok: true,
      reply: assistantReply,
      toolsCalled,
      finalActions,
      cartUpdates,
      message: assistantReply
    }));

  } catch (error) {
    console.error('AI_ORCHESTRATOR_ERROR', error);

    let clientMessage = 'Errore AI temporaneo.';
    if (error?.status === 401) clientMessage = 'Errore configurazione AI (chiave non valida).';
    if (error?.status === 429) clientMessage = 'Servizio AI momentaneamente sovraccarico.';

    return jsonResponse(200, normalizeClientPayload({
      cartUpdates: [],
      message: clientMessage,
      result: clientMessage
    }));
  }
};
