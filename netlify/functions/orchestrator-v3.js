const OpenAI = require('openai');
const { validateResponse, FALLBACK_RESPONSE } = require('./orchestrator-v3/contract-validator');
const { logExecution } = require('./orchestrator-v3/logger');
const {
  AddItemSchema,
  RemoveItemSchema,
  CreateCustomItemSchema,
  SuggestItemsSchema,
  parseWith,
  toToolParameters,
  normalizeIngredientId
} = require('./orchestrator-v3/schemas/orderSchemas');
const { buildOrderItem, CATALOG_ITEMS } = require('./orchestrator-v3/services/orderBuilder');
const { extractValidIngredients } = require('./orchestrator-v3/services/ingredientExtractor');
const { findBestMatches } = require('./orchestrator-v3/services/ingredientMatchEngine');
const { findPizza, parseQty } = require('./orchestrator-v3/menu-handler');

// Skip direct-name matching when the message contains Italian prepositions indicating ingredient
// additions ("con") or removals ("senza"); this intentionally limited set avoids masking ingredient lists.
const SKIP_DIRECT_MATCH_REGEX = /\b(con|senza)\b/;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}

function parseBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === 'object') {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
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

function buildAddItemResponse(orderItem) {
  return {
    ok: true,
    cartUpdates: [orderItem],
    reply: `${orderItem.name} aggiunta al carrello (${orderItem.qty}x).`
  };
}

function tryDirectNameMatch(message) {
  if (!message) {
    return null;
  }

  const normalized = String(message).toLowerCase();
  if (SKIP_DIRECT_MATCH_REGEX.test(normalized)) {
    return null;
  }

  const pizza = findPizza(normalized);
  if (!pizza) {
    return null;
  }

  const quantity = parseQty(normalized);

  try {
    const orderItem = buildOrderItem({
      baseItem: pizza,
      extraIngredients: [],
      removedIngredients: [],
      quantity
    });
    return orderItem;
  } catch {
    return null;
  }
}

function buildCustomPizzaFromIngredients({ ingredients, message }) {
  const baseItem = CATALOG_ITEMS.get('margherita') || Array.from(CATALOG_ITEMS.values())[0];
  if (!baseItem) {
    return null;
  }

  const normalizedMessage = String(message || '').toLowerCase();
  const includeTomatoBase = !normalizedMessage.includes('bianca');
  const desiredIngredients = new Set(
    (ingredients || []).map((ingredient) => normalizeIngredientId(ingredient)).filter(Boolean)
  );

  if (includeTomatoBase) {
    desiredIngredients.add('pomodoro');
  } else {
    desiredIngredients.delete('pomodoro');
  }

  const baseIngredients = [
    ...(Array.isArray(baseItem.ingredients) ? baseItem.ingredients : []),
    ...(Array.isArray(baseItem.ingredienti) ? baseItem.ingredienti : [])
  ]
    .map(normalizeIngredientId)
    .filter(Boolean);

  const removedIngredients = baseIngredients.filter((ingredient) => !desiredIngredients.has(ingredient));
  const extraIngredients = Array.from(desiredIngredients).filter(
    (ingredient) => !baseIngredients.includes(ingredient)
  );

  const orderItem = buildOrderItem({
    baseItem,
    extraIngredients,
    removedIngredients,
    quantity: 1
  });

  const ingredientList = orderItem.ingredients.join(', ');
  return {
    ok: true,
    cartUpdates: [orderItem],
    reply: `Ho creato una pizza personalizzata con ${ingredientList}.`
  };
}

function runDeterministicIngredientMatch(message) {
  const ingredients = extractValidIngredients(message);
  if (ingredients.length === 0) {
    return null;
  }

  const matches = findBestMatches(ingredients, Array.from(CATALOG_ITEMS.values()));

  if (matches.identical) {
    const orderItem = buildOrderItem({
      baseItem: matches.identical,
      extraIngredients: [],
      removedIngredients: [],
      quantity: 1
    });

    return buildAddItemResponse(orderItem);
  }

  if (Array.isArray(matches.similar) && matches.similar.length > 0) {
    return {
      ok: true,
      cartUpdates: [],
      reply: 'Non esiste esattamente questa combinazione. Ti propongo:',
      suggestions: matches.similar.map((pizza) => pizza.name || pizza.id).filter(Boolean)
    };
  }

  return buildCustomPizzaFromIngredients({ ingredients, message });
}

const TOOL_CONFIG = {
  add_item: {
    schema: AddItemSchema,
    parameters: toToolParameters('add'),
    executor: (data) => {
      const baseItem = CATALOG_ITEMS.get(String(data.itemId));
      if (!baseItem) {
        return { ok: false, error: 'INVALID_TOOL_PAYLOAD' };
      }

      let orderItem;
      try {
        orderItem = buildOrderItem({
          baseItem,
          extraIngredients: data.extraIngredients || [],
          removedIngredients: data.removedIngredients || [],
          quantity: data.quantity
        });
      } catch {
        return { ok: false, error: 'INVALID_TOOL_PAYLOAD' };
      }

      return {
        ok: true,
        cartUpdates: [orderItem],
        reply: `${orderItem.name} aggiunta al carrello (${orderItem.qty}x).`
      };
    }
  },
  remove_item: {
    schema: RemoveItemSchema,
    parameters: toToolParameters('remove'),
    executor: (data) => {
      if (!CATALOG_ITEMS.has(String(data.itemId))) {
        return { ok: false, error: 'INVALID_TOOL_PAYLOAD' };
      }

      return {
        ok: true,
        cartUpdates: [
          {
            type: 'REMOVE_ITEM',
            id: String(data.itemId),
            qty: data.quantity
          }
        ],
        reply: `Rimosso ${data.quantity}x ${data.itemId} dal carrello.`
      };
    }
  },
  create_custom_item: {
    schema: CreateCustomItemSchema,
    parameters: toToolParameters('custom'),
    executor: (data) => {
      const baseItem = CATALOG_ITEMS.get(String(data.baseItemId));
      if (!baseItem) {
        return { ok: false, error: 'INVALID_TOOL_PAYLOAD' };
      }

      let orderItem;
      try {
        orderItem = buildOrderItem({
          baseItem,
          extraIngredients: data.extraIngredients || [],
          removedIngredients: data.removedIngredients || [],
          quantity: data.quantity
        });
      } catch {
        return { ok: false, error: 'INVALID_TOOL_PAYLOAD' };
      }

      return {
        ok: true,
        cartUpdates: [orderItem],
        reply: `Creato articolo personalizzato (${orderItem.qty}x ${orderItem.name}).`
      };
    }
  },
  suggest_items: {
    schema: SuggestItemsSchema,
    parameters: toToolParameters('suggest'),
    executor: (data) => {
      const items = Array.from(CATALOG_ITEMS.values()).slice(0, data.limit || 3);
      const reply =
        items.length === 0
          ? 'Catalogo non disponibile.'
          : `Posso proporre: ${items.map((item) => item.name).join(', ')}.`;

      return {
        ok: true,
        cartUpdates: [],
        reply
      };
    }
  }
};

const TOOL_DEFINITIONS = Object.entries(TOOL_CONFIG).map(([name, config]) => ({
  type: 'function',
  name,
  description: 'Usa il tool per modificare il carrello in modo strutturato.',
  parameters: config.parameters
}));

function collectToolCalls(outputs) {
  if (!Array.isArray(outputs)) return [];
  const toolCalls = [];

  outputs.forEach((output) => {
    if (output?.type === 'tool_call') {
      toolCalls.push(output);
      return;
    }

    if (output?.type === 'message' && Array.isArray(output.content)) {
      output.content.forEach((part) => {
        if (part?.type === 'tool_call') {
          toolCalls.push(part);
        }
      });
    }
  });

  return toolCalls;
}

async function runLLM(prompt) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client.responses.create({
    model: 'gpt-4o-mini-2024-07-18',
    input: [
      {
        role: 'system',
        content:
          'Sei un orchestratore ordini. Rispondi SOLO usando tool_call obbligatorio. Non restituire mai testo libero. Non generare prezzi.'
      },
      { role: 'user', content: prompt }
    ],
    tools: TOOL_DEFINITIONS,
    tool_choice: 'auto'
  });
}

function isHealthRequest(event) {
  const path = String(event.path || event.rawUrl || '').toLowerCase();
  return path.includes('orchestrator-v3/health');
}

exports.handler = async (event) => {
  const startedAt = Date.now();

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: JSON_HEADERS,
      body: ''
    };
  }

  if (isHealthRequest(event) && event.httpMethod === 'GET') {
    return jsonResponse(200, {
      status: 'ok',
      catalogLoaded: CATALOG_ITEMS.size > 0,
      schemaLoaded: true
    });
  }

  if (event.httpMethod !== 'POST') {
    const validated = validateResponse({
      ok: false,
      cartUpdates: [],
      reply: 'Metodo non consentito.'
    });

    return jsonResponse(405, validated);
  }

  try {
    const parsedBody = parseBody(event.body);
    if (!parsedBody || typeof parsedBody !== 'object') {
      const invalidBodyResponse = validateResponse({
        ok: false,
        cartUpdates: [],
        reply: 'Body richiesta non valido.'
      });

      logExecution({
        intent: 'invalid_body',
        toolUsed: null,
        validation: 'invalid',
        finalCartDelta: [],
        executionTimeMs: Date.now() - startedAt,
        status: 'error',
        error: 'invalid_body'
      });

      return jsonResponse(200, invalidBodyResponse);
    }

    const message = String(parsedBody.message || parsedBody.prompt || '').trim();
    if (!message) {
      const missingMessageResponse = validateResponse({
        ok: false,
        cartUpdates: [],
        reply: 'Messaggio mancante.'
      });

      logExecution({
        intent: 'missing_message',
        toolUsed: null,
        validation: 'invalid',
        finalCartDelta: [],
        executionTimeMs: Date.now() - startedAt,
        status: 'error',
        error: 'missing_message'
      });

      return jsonResponse(200, missingMessageResponse);
    }

    const directMatch = tryDirectNameMatch(message);
    if (directMatch) {
      const validatedDirectMatch = validateResponse(buildAddItemResponse(directMatch));

      logExecution({
        intent: 'direct_name_match',
        toolUsed: 'add_item',
        validation: validatedDirectMatch.ok ? 'valid' : 'invalid',
        finalCartDelta: validatedDirectMatch.cartUpdates,
        executionTimeMs: Date.now() - startedAt,
        status: validatedDirectMatch.ok ? 'success' : 'error',
        error: validatedDirectMatch.ok ? null : 'invalid_direct_match'
      });

      return jsonResponse(200, validatedDirectMatch);
    }

  const deterministicResponse = runDeterministicIngredientMatch(message);
  if (deterministicResponse) {
    const validatedDeterministic = validateResponse(deterministicResponse);

    logExecution({
      intent: 'deterministic_ingredients',
      toolUsed:
        validatedDeterministic.cartUpdates.length > 0
          ? validatedDeterministic.cartUpdates[0]?.type === 'REMOVE_ITEM'
            ? 'remove_item'
            : 'add_item'
          : null,
      validation: validatedDeterministic.ok ? 'valid' : 'invalid',
      finalCartDelta: validatedDeterministic.cartUpdates,
      executionTimeMs: Date.now() - startedAt,
      status: validatedDeterministic.ok ? 'success' : 'error',
      error: validatedDeterministic.ok ? null : 'invalid_ingredient_match'
    });

    return jsonResponse(200, validatedDeterministic);
  }

    if (!process.env.OPENAI_API_KEY) {
      logExecution({
        intent: 'info',
        toolUsed: null,
        validation: 'skipped',
        finalCartDelta: [],
        executionTimeMs: Date.now() - startedAt,
        status: 'success',
        error: null
      });
      return jsonResponse(200, { ok: true, cartUpdates: [], reply: 'Puoi indicarmi il nome esatto della pizza?' });
    }

    const aiResponse = await runLLM(message);
    const toolCalls = collectToolCalls(aiResponse?.output);
    const primaryToolCall = toolCalls[0];

    if (!primaryToolCall) {
      const fallback = validateResponse({
        ok: true,
        cartUpdates: [],
        reply: 'Puoi indicarmi il nome esatto della pizza?'
      });

      logExecution({
        intent: 'none',
        toolUsed: null,
        validation: 'skipped',
        finalCartDelta: [],
        executionTimeMs: Date.now() - startedAt,
        status: 'success'
      });

      return jsonResponse(200, fallback);
    }

    const toolConfig = TOOL_CONFIG[primaryToolCall.name];
    if (!toolConfig) {
      return jsonResponse(200, { ok: false, cartUpdates: [], error: 'INVALID_TOOL_PAYLOAD' });
    }

    const parsed = parseWith(toolConfig.schema, parseArgs(primaryToolCall.arguments));
    if (!parsed.ok) {
      logExecution({
        intent: primaryToolCall.name,
        toolUsed: primaryToolCall.name,
        validation: 'invalid',
        finalCartDelta: [],
        executionTimeMs: Date.now() - startedAt,
        status: 'error',
        error: 'INVALID_TOOL_PAYLOAD'
      });
      return jsonResponse(200, { ok: false, cartUpdates: [], error: 'INVALID_TOOL_PAYLOAD' });
    }

    const execution = toolConfig.executor(parsed.data);
    if (execution.ok === false && execution.error) {
      logExecution({
        intent: primaryToolCall.name,
        toolUsed: primaryToolCall.name,
        validation: 'invalid',
        finalCartDelta: [],
        executionTimeMs: Date.now() - startedAt,
        status: 'error',
        error: execution.error
      });
      return jsonResponse(200, { ok: false, cartUpdates: [], error: 'INVALID_TOOL_PAYLOAD' });
    }

    const validatedResponse = validateResponse(execution);

    logExecution({
      intent: primaryToolCall.name,
      toolUsed: primaryToolCall.name,
      validation: validatedResponse.ok ? 'valid' : 'invalid',
      finalCartDelta: validatedResponse.cartUpdates,
      executionTimeMs: Date.now() - startedAt,
      status: validatedResponse.ok ? 'success' : 'error',
      error: validatedResponse.ok ? null : validatedResponse.reply
    });

    return jsonResponse(200, validatedResponse);
  } catch (error) {
    const fallback = validateResponse(FALLBACK_RESPONSE);

    logExecution({
      intent: 'unknown',
      toolUsed: null,
      validation: 'error',
      finalCartDelta: [],
      executionTimeMs: Date.now() - startedAt,
      status: 'error',
      error: error && error.message ? error.message : 'unknown_error'
    });

    return jsonResponse(200, fallback);
  }
};
