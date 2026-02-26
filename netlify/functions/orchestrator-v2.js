const { createCustomPanino } = require('../../core/menu/panino-engine');
const { validateIngredientIds } = require('../../core/menu/food-engine');

const MAX_TOOL_CALLS = 1;
const MAX_QTY_PER_ITEM = 5;
const DIRECT_ADD_KEYWORDS = ['aggiungi', 'metti nel carrello'];
const CONFIRM_REGEX = /^(sì|si|ok|va bene|aggiungi)$/i;

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

function parseArgs(args) {
  if (!args) return {};
  if (typeof args === 'string') {
    try { return JSON.parse(args); } catch { return {}; }
  }
  return args;
}

async function createOpenAIClient() {
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function sanitizeQty(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(MAX_QTY_PER_ITEM, numeric));
}

function normalizeCatalogItem(item) {
  const id = String(item?.id || '');
  if (!id) return null;

  return {
    id,
    nome: item?.name || item?.nome || '',
    prezzo: Number(item?.price_cents ?? item?.price ?? item?.prezzo ?? 0) || 0,
    ingredienti: Array.isArray(item?.ingredienti)
      ? item.ingredienti
      : (Array.isArray(item?.ingredients) ? item.ingredients : []),
    categoria: String(item?.type || item?.category || item?.categoria || 'other'),
    type: item?.type || item?.category || 'pizza',
    active: item?.active !== false
  };
}

function flattenCatalog(catalog) {
  const sections = [catalog?.menu, catalog?.pizzas, catalog?.drinks, catalog?.desserts, catalog?.extras];
  const items = sections
    .filter(Array.isArray)
    .flat()
    .filter(Boolean)
    .map(normalizeCatalogItem)
    .filter((item) => item && item.id);

  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return item.active;
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function promptContainsExactItemName(prompt, itemName) {
  const normalizedName = String(itemName || '').trim();
  if (!normalizedName) return false;

  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedName)}([^\\p{L}\\p{N}]|$)`, 'iu');
  return pattern.test(prompt);
}

function findDeterministicAddMatch(prompt, catalogItems) {
  const normalizedPrompt = String(prompt || '').toLowerCase();
  if (!DIRECT_ADD_KEYWORDS.some((keyword) => normalizedPrompt.includes(keyword))) {
    return null;
  }

  return catalogItems.find((item) => promptContainsExactItemName(prompt, item?.nome)) || null;
}

function buildEnvelope({ ok, action = null, mainItem = null, upsell = null, reply }) {
  return { ok, action, mainItem, upsell, reply };
}

function toMainItemFromCatalog(item, qty = 1) {
  if (!item || !item.id) return null;
  return {
    id: item.id,
    nome: item.nome,
    prezzo: Number(item.prezzo) || 0,
    ingredienti: Array.isArray(item.ingredienti) ? item.ingredienti : [],
    categoria: item.categoria,
    type: item.type,
    qty: sanitizeQty(qty)
  };
}

function toMainItemFromCustom(panino) {
  if (!panino) return null;
  return {
    id: panino.id,
    nome: panino.displayName || 'Panino personalizzato',
    prezzo: Number(panino.totalPrice) || 0,
    ingredienti: Array.isArray(panino.ingredientIds) ? panino.ingredientIds : [],
    categoria: 'custom_panino',
    type: 'custom_panino',
    qty: 1
  };
}

async function runTool(toolCall, { catalogItems }) {
  const args = parseArgs(toolCall.arguments);

  if (toolCall.name === 'create_custom_panino') {
    const ids = Array.isArray(args.ingredientIds) ? args.ingredientIds : [];
    if (!validateIngredientIds(ids)) {
      throw new Error('Invalid ingredientIds');
    }
    return createCustomPanino({ ingredientIds: ids });
  }

  if (toolCall.name === 'add_menu_item_to_cart') {
    const itemId = String(args.itemId || '');
    if (!itemId) {
      throw new Error('Missing itemId');
    }
    const catalogItem = catalogItems.find((item) => item.id === itemId);
    if (!catalogItem) {
      throw new Error('Item not in catalog');
    }

    return {
      itemId,
      qty: sanitizeQty(args.qty)
    };
  }

  return null;
}

function extractToolCall(outputs) {
  if (!Array.isArray(outputs)) return null;
  const toolCall = outputs.find((o) => o?.type === 'tool_call');
  if (toolCall) return toolCall;

  const message = outputs.find((o) => o?.type === 'message');
  if (message && Array.isArray(message.content)) {
    return message.content.find((contentItem) => contentItem?.type === 'tool_call') || null;
  }

  return null;
}

function extractAssistantMessage(outputs) {
  if (!Array.isArray(outputs)) return null;
  const message = outputs.find((o) => o?.type === 'message');
  return message?.content?.[0]?.text || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, buildEnvelope({
      ok: false,
      reply: 'Metodo non consentito'
    }));
  }

  const body = tryParseJson(event.body);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const sessionState = body && typeof body.sessionState === 'object' ? body.sessionState : {};

  if (!prompt) {
    return jsonResponse(400, buildEnvelope({
      ok: false,
      reply: 'Prompt mancante'
    }));
  }

  const catalog = require('../../data/catalog');
  const catalogItems = flattenCatalog(catalog);

  if (CONFIRM_REGEX.test(prompt) && sessionState?.lastMainItemId) {
    const candidate = catalogItems.find((item) => item.id === String(sessionState.lastMainItemId));
    if (!candidate) {
      return jsonResponse(200, buildEnvelope({
        ok: false,
        reply: 'Prodotto non disponibile',
        mainItem: null
      }));
    }

    return jsonResponse(200, buildEnvelope({
      ok: true,
      action: 'add_to_cart',
      mainItem: toMainItemFromCatalog(candidate),
      upsell: null,
      reply: `Aggiunto ${candidate.nome} al carrello.`
    }));
  }

  const deterministicMatch = findDeterministicAddMatch(prompt, catalogItems);
  if (deterministicMatch) {
    return jsonResponse(200, buildEnvelope({
      ok: true,
      action: 'add_to_cart',
      mainItem: toMainItemFromCatalog(deterministicMatch),
      upsell: null,
      reply: `Aggiunto ${deterministicMatch.nome} al carrello.`
    }));
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(500, buildEnvelope({
      ok: false,
      reply: 'OPENAI_API_KEY non configurata',
      mainItem: null
    }));
  }

  try {
    const client = await createOpenAIClient();

    const tools = [
      {
        type: 'function',
        name: 'create_custom_panino',
        description: 'Crea panino custom con ingredientIds validi',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ingredientIds: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['ingredientIds']
        }
      },
      {
        type: 'function',
        name: 'add_menu_item_to_cart',
        description: 'Aggiunge item al carrello',
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
    ];

    const response = await client.responses.create({
      model: 'gpt-4o-mini-2024-07-18',
      input: [
        { role: 'system', content: 'Usa solo ID reali del catalogo fornito e non aggiungere nulla automaticamente.' },
        { role: 'user', content: prompt }
      ],
      tools,
      tool_choice: 'auto'
    });

    const toolCall = extractToolCall(response?.output);
    if (toolCall) {
      try {
        const result = await runTool(toolCall, { catalogItems });
        if (toolCall.name === 'add_menu_item_to_cart') {
          const catalogItem = catalogItems.find((item) => item.id === String(result.itemId));
          if (!catalogItem) {
            throw new Error('Item not in catalog');
          }

          return jsonResponse(200, buildEnvelope({
            ok: true,
            action: null,
            mainItem: toMainItemFromCatalog(catalogItem, result.qty),
            upsell: null,
            reply: 'Vuoi che aggiunga la prima al carrello?'
          }));
        }

        if (toolCall.name === 'create_custom_panino') {
          return jsonResponse(200, buildEnvelope({
            ok: true,
            action: null,
            mainItem: toMainItemFromCustom(result),
            upsell: null,
            reply: 'Vuoi che aggiunga la prima al carrello?'
          }));
        }
      } catch (toolError) {
        console.error('TOOL ERROR:', toolError);
        return jsonResponse(200, buildEnvelope({
          ok: false,
          action: null,
          mainItem: null,
          upsell: null,
          reply: 'Non sono riuscito a completare l\'operazione.'
        }));
      }
    }

    const assistantMessage = extractAssistantMessage(response?.output);
    return jsonResponse(200, buildEnvelope({
      ok: true,
      action: null,
      mainItem: null,
      upsell: null,
      reply: assistantMessage || 'Posso aiutarti con il menu.'
    }));
  } catch (error) {
    console.error('AI ERROR V2:', error);

    return jsonResponse(500, buildEnvelope({
      ok: false,
      action: null,
      mainItem: null,
      upsell: null,
      reply: error.message || 'Errore AI'
    }));
  }
};
