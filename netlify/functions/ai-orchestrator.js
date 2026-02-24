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

function parseBody(body) {
  try {
    return JSON.parse(body || '{}');
  } catch (_) {
    return {};
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

async function runToolCall(call) {
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
      type: 'add',
      menuItemId: String(args.itemId || ''),
      qty: Math.max(1, Number(args.qty) || 1)
    };
  }

  if (call.name === 'update_item_quantity') {
    return {
      type: 'update',
      menuItemId: String(args.menuItemId || ''),
      qty: Math.max(1, Number(args.qty) || 1)
    };
  }

  if (call.name === 'remove_menu_item_from_cart') {
    return {
      type: 'remove',
      menuItemId: String(args.menuItemId || '')
    };
  }

  if (call.name === 'clear_cart') {
    return { type: 'clear' };
  }

  if (call.name === 'proceed_to_checkout') {
    const createCheckout = require('./create-checkout');
    const checkoutResponse = await createCheckout.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        cart: Array.isArray(args.cart) ? args.cart : []
      })
    });
    const checkoutPayload = parseBody(checkoutResponse?.body);
    if (checkoutResponse?.statusCode !== 200) {
      throw new Error(String(checkoutPayload?.error || 'Checkout non disponibile'));
    }
    const url = String(checkoutPayload?.url || checkoutPayload?.checkout_url || '').trim();
    if (!url) {
      throw new Error('checkout_url mancante');
    }
    return {
      type: 'checkout',
      url
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
  if (toolName === 'add_menu_item_to_cart' || toolName === 'update_item_quantity') {
    const menuItemId = String(output?.menuItemId || output?.itemId || '').trim();
    const qty = Math.max(1, Number(output?.qty) || 1);
    if (!menuItemId) {
      return null;
    }

    return {
      type: toolName === 'add_menu_item_to_cart' ? 'add' : 'update',
      menuItemId,
      qty
    };
  }

  if (toolName === 'remove_menu_item_from_cart') {
    const menuItemId = String(output?.menuItemId || '').trim();
    if (!menuItemId) {
      return null;
    }
    return { type: 'remove', menuItemId };
  }

  if (toolName === 'clear_cart') {
    return { type: 'clear' };
  }

  if (toolName === 'proceed_to_checkout') {
    const url = String(output?.url || '').trim();
    if (!url) {
      return null;
    }
    return { type: 'checkout', url };
  }

  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Metodo non consentito'
    });
  }

  const body = parseBody(event.body);
  const prompt = String(body.prompt || body.message || '').trim();
  const toolsCalled = [];
  const finalActions = [];
  const cartUpdates = [];

  console.log('=== AI ORCHESTRATOR START ===');
  console.log('PROMPT:', prompt);

  if (!process.env.OPENAI_API_KEY || !String(process.env.OPENAI_API_KEY).trim()) {
    console.log('TOOLS CALLED:', toolsCalled);
    console.log('FINAL ACTIONS:', finalActions);
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
      },
      {
        type: 'function',
        name: 'update_item_quantity',
        description: 'Aggiorna quantità di un item nel carrello',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            menuItemId: { type: 'string' },
            qty: { type: 'number' }
          },
          required: ['menuItemId', 'qty']
        }
      },
      {
        type: 'function',
        name: 'remove_menu_item_from_cart',
        description: 'Rimuove completamente un item dal carrello',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            menuItemId: { type: 'string' }
          },
          required: ['menuItemId']
        }
      },
      {
        type: 'function',
        name: 'clear_cart',
        description: 'Svuota completamente il carrello',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {}
        }
      },
      {
        type: 'function',
        name: 'proceed_to_checkout',
        description: 'Crea sessione checkout Stripe e restituisce checkout URL',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cart: { type: 'array' }
          },
          required: ['cart']
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
            text: 'Usa solo tool con ID reali del food-core. Non usare nomi ingredienti. Se l’utente dice "togli" usa remove_menu_item_from_cart. Se dice "cambia quantità" usa update_item_quantity. Se dice "svuota" usa clear_cart. Se dice "procedi al pagamento" usa proceed_to_checkout.'
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
          const output = await runToolCall(call);
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
