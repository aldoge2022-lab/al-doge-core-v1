const { createCustomPanino } = require('../../core/menu/panino-engine');
const { validateIngredientIds, getIngredients } = require('../../core/menu/food-engine');

const MAX_TOOL_CALLS = 3;
const VEG_KEYWORDS = ['veg', 'vegetar', 'verdur', 'orto'];
const DESSERT_KEYWORDS = ['dessert', 'dolce', 'tiramisu', 'gelato', 'panna', 'nutella'];
const DRINK_KEYWORDS = ['drink', 'bevanda', 'acqua', 'birra', 'cola', 'spritz', 'vino', 'bibita'];
const PROTEIN_KEYWORDS = ['salame', 'prosciutto', 'salsic', 'pollo', 'tonno', 'wurstel', 'bacon', 'carne'];

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

function flattenCatalog(catalog) {
  const sections = [catalog?.menu, catalog?.pizzas, catalog?.drinks, catalog?.desserts, catalog?.extras];
  const items = sections
    .filter(Array.isArray)
    .flat()
    .filter(Boolean);

  const seen = new Set();
  return items.filter((item) => {
    const itemId = String(item?.id || '');
    if (!itemId || seen.has(itemId)) return false;
    seen.add(itemId);
    return true;
  });
}

function normalizeCartLine(line) {
  const menuItemId = String(line?.menuItemId || line?.itemId || line?.id || line?.productId || '');
  const qty = Math.max(1, Number(line?.qty || line?.quantity) || 1);
  if (!menuItemId) return null;
  return { menuItemId, qty };
}

function findCategory(item) {
  const type = String(item?.type || '').toLowerCase();
  const tags = [...(Array.isArray(item?.tags) ? item.tags : []), ...(Array.isArray(item?.tag) ? item.tag : [])]
    .map((value) => String(value || '').toLowerCase());
  const joined = `${type} ${tags.join(' ')} ${String(item?.name || '').toLowerCase()}`;

  if (DESSERT_KEYWORDS.some((token) => joined.includes(token))) return 'dessert';
  if (DRINK_KEYWORDS.some((token) => joined.includes(token))) return 'drink';
  if (type === 'pizza') return 'pizza';
  return 'other';
}

function isVegItem(item) {
  const tags = [...(Array.isArray(item?.tags) ? item.tags : []), ...(Array.isArray(item?.tag) ? item.tag : [])]
    .map((value) => String(value || '').toLowerCase());
  if (tags.some((value) => VEG_KEYWORDS.some((token) => value.includes(token)))) {
    return true;
  }

  const ingredients = [...(Array.isArray(item?.ingredients) ? item.ingredients : []), ...(Array.isArray(item?.ingredienti) ? item.ingredienti : [])]
    .map((value) => String(value || '').toLowerCase());
  if (ingredients.length === 0) return false;
  return !ingredients.some((ingredient) => PROTEIN_KEYWORDS.some((token) => ingredient.includes(token)));
}

function detectProfile({ hasDrink, hasDessert, vegOnly, premiumCount, itemCount }) {
  if (vegOnly && itemCount > 0) return 'veg-focused';
  if (premiumCount >= 2) return 'premium';
  if (hasDrink && hasDessert) return 'full-meal';
  if (!hasDrink && itemCount >= 2) return 'thirsty';
  if (!hasDessert && itemCount >= 2) return 'sweet-tooth';
  return 'standard';
}

function analyzeCart(cart, catalog) {
  const catalogItems = flattenCatalog(catalog);
  const byId = new Map(catalogItems.map((item) => [String(item.id), item]));
  const normalizedCart = (Array.isArray(cart) ? cart : []).map(normalizeCartLine).filter(Boolean);

  let total = 0;
  let itemCount = 0;
  let hasDrink = false;
  let hasDessert = false;
  let vegOnly = normalizedCart.length > 0;
  let premiumCount = 0;

  for (const line of normalizedCart) {
    const item = byId.get(line.menuItemId);
    const category = findCategory(item || {});
    const unitPrice = Number(item?.price_cents ?? item?.price ?? 0) || 0;
    const tags = [...(Array.isArray(item?.tags) ? item.tags : []), ...(Array.isArray(item?.tag) ? item.tag : [])]
      .map((value) => String(value || '').toLowerCase());

    total += unitPrice * line.qty;
    itemCount += line.qty;
    if (category === 'drink') hasDrink = true;
    if (category === 'dessert') hasDessert = true;
    if (!isVegItem(item || {})) vegOnly = false;
    if (tags.includes('premium') || unitPrice >= 900) premiumCount += line.qty;
  }

  return {
    total,
    itemCount,
    hasDrink,
    hasDessert,
    vegOnly,
    premiumCount,
    profile: detectProfile({ hasDrink, hasDessert, vegOnly, premiumCount, itemCount })
  };
}

function cartCompatibility(cartAnalysis, candidateCategory) {
  if (candidateCategory === 'drink' && !cartAnalysis.hasDrink) return 1.2;
  if (candidateCategory === 'dessert' && !cartAnalysis.hasDessert) return 1.2;
  if (candidateCategory === 'pizza' && cartAnalysis.itemCount < 2) return 1.1;
  return 0.9;
}

function profileBoost(cartAnalysis, candidateCategory, candidateTags) {
  const isPremium = candidateTags.includes('premium');
  if (cartAnalysis.profile === 'premium' && isPremium) return 1.25;
  if (cartAnalysis.profile === 'veg-focused' && candidateTags.some((tag) => VEG_KEYWORDS.some((token) => tag.includes(token)))) return 1.2;
  if (cartAnalysis.profile === 'thirsty' && candidateCategory === 'drink') return 1.25;
  if (cartAnalysis.profile === 'sweet-tooth' && candidateCategory === 'dessert') return 1.25;
  return 1;
}

function aggressionLevel(cartAnalysis) {
  if (cartAnalysis.itemCount <= 1) return 4;
  if (!cartAnalysis.hasDrink || !cartAnalysis.hasDessert) return 3;
  if (cartAnalysis.total >= 1800 || cartAnalysis.premiumCount >= 2) return 2;
  return 1;
}

function decideUpsell(cartAnalysis, catalog, cart = []) {
  const catalogItems = flattenCatalog(catalog);
  const cartIds = new Set(
    (Array.isArray(cart) ? cart : [])
      .map(normalizeCartLine)
      .filter(Boolean)
      .map((line) => line.menuItemId)
  );

  const candidates = catalogItems
    .filter((item) => !cartIds.has(String(item.id)))
    .map((item) => {
      const price = Number(item?.price_cents ?? item?.price ?? 0) || 0;
      const category = findCategory(item);
      const tags = [...(Array.isArray(item?.tags) ? item.tags : []), ...(Array.isArray(item?.tag) ? item.tag : [])]
        .map((value) => String(value || '').toLowerCase());

      const marginScore = Math.max(0.5, Math.min(2, price / 500));
      const categoryWeight = category === 'drink' || category === 'dessert' ? 1.25 : 1;
      const tagWeight = tags.includes('premium') ? 1.15 : 1;
      const boost = profileBoost(cartAnalysis, category, tags);
      const compatibility = cartCompatibility(cartAnalysis, category);
      const score = marginScore * categoryWeight * tagWeight * boost * compatibility;

      return {
        id: String(item.id),
        name: item.name,
        category,
        tags,
        price,
        marginScore,
        profileBoost: boost,
        cartCompatibility: compatibility,
        score
      };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0] || null;
}

async function createOpenAIClient() {
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function loadMenu() {
  return require('../../data/catalog');
}

async function loadIngredients() {
  return getIngredients();
}

function toCartUpdate(toolName, output) {
  if (toolName !== 'add_menu_item_to_cart') return null;

  return {
    type: 'add',
    menuItemId: String(output.itemId),
    qty: Math.max(1, Number(output.qty) || 1)
  };
}

async function runToolCall(toolCall, { cart, validIngredientIds }) {
  const args = parseArgs(toolCall.arguments);

  if (toolCall.name === 'create_custom_panino') {
    const ingredientIds = Array.isArray(args.ingredientIds) ? args.ingredientIds : [];
    if (!ingredientIds.every((id) => validIngredientIds.includes(id))) {
      throw new Error('Invalid ingredient from model');
    }
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
    const catalog = await loadMenu();
    const ingredients = await loadIngredients();
    const ingredientList = ingredients
      .map((i) => `${i.id}: ${i.name}`)
      .join('\n');
    const validIngredientIds = ingredients.map((i) => i.id);

    const tools = [
      {
        type: 'function',
        name: 'create_custom_panino',
        description: 'Crea un panino personalizzato con ingredienti validi.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ingredientIds: {
              type: 'array',
              items: { type: 'string' }
            },
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
      {
        role: 'system',
        content: `
Sei l'orchestrator ufficiale di AL DOGE.

Puoi:
- Aggiungere pizze esistenti usando add_menu_item_to_cart
- Creare pizze personalizzate usando create_custom_panino

Regole obbligatorie:
- Usa SOLO ingredienti presenti in questo elenco:

${ingredientList}

- Non inventare ingredienti.
- Non inventare pizze predefinite.
- Se l’utente chiede “con verdure”, seleziona ingredienti vegetali presenti.
- Se personalizzi, devi usare create_custom_panino.
- Non rispondere solo con testo quando puoi usare un tool.
`
      },
      { role: 'user', content: prompt }
    ];

    let response = await client.responses.create({
      model: 'gpt-4o-mini-2024-07-18',
      input,
      tools,
      tool_choice: { type: 'required' }
    });

    let assistantMessage = null;

    while (toolsCalled.length < MAX_TOOL_CALLS) {
      const outputs = Array.isArray(response?.output) ? response.output : [];
      const toolCalls = outputs.filter((output) => output.type === 'tool_call');
      const messageItem = outputs.find((output) => output.type === 'message');

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          const output = await runToolCall(toolCall, { cart, validIngredientIds });

          toolsCalled.push(toolCall.name);
          finalActions.push({ tool: toolCall.name, ok: true });

          const cartUpdate = toCartUpdate(toolCall.name, output);
          if (cartUpdate) cartUpdates.push(cartUpdate);

          const projectedCart = [...cart, ...cartUpdates.map((update) => ({ menuItemId: update.menuItemId, qty: update.qty }))];
          const cartAnalysis = analyzeCart(projectedCart, catalog);
          const upsellCandidate = decideUpsell(cartAnalysis, catalog, projectedCart);
          const upsellSuggestion = upsellCandidate
            ? {
                engine: 'revenue-engine-v1',
                aggressionLevel: aggressionLevel(cartAnalysis),
                profile: cartAnalysis.profile,
                cartAnalysis,
                suggestion: {
                  itemId: upsellCandidate.id,
                  name: upsellCandidate.name,
                  category: upsellCandidate.category,
                  tags: upsellCandidate.tags,
                  price: upsellCandidate.price,
                  marginScore: Number(upsellCandidate.marginScore.toFixed(3)),
                  profileBoost: Number(upsellCandidate.profileBoost.toFixed(3)),
                  cartCompatibility: Number(upsellCandidate.cartCompatibility.toFixed(3)),
                  score: Number(upsellCandidate.score.toFixed(3))
                }
              }
            : {
                engine: 'revenue-engine-v1',
                aggressionLevel: aggressionLevel(cartAnalysis),
                profile: cartAnalysis.profile,
                cartAnalysis,
                suggestion: null
              };

          const enrichedToolOutput = toolCall.name === 'add_menu_item_to_cart'
            ? { ...output, upsellSuggestion }
            : output;

          response = await client.responses.create({
            model: 'gpt-4o-mini-2024-07-18',
            previous_response_id: response.id,
            input: [{
              type: 'function_call_output',
              call_id: toolCall.call_id,
              output: JSON.stringify(enrichedToolOutput)
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
