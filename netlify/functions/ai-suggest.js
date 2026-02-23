const catalog = require('../../data/catalog');
const aiRules = require('../../config/ai-rules');

const MAX_UNIQUE_ITEMS = 3;
const MAX_QTY = 5;

function methodNotAllowed() {
  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED' })
  };
}

function invalidInput() {
  return {
    statusCode: 400,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'INVALID_INPUT' })
  };
}

function parseJsonBody(rawBody) {
  try {
    return JSON.parse(rawBody || '{}');
  } catch {
    return null;
  }
}

function detectPeople(message) {
  const text = String(message || '').toLowerCase();
  const match = text.match(/(?:siamo|in|per)\s+(\d{1,2})/) || text.match(/(\d{1,2})\s+persone?/);
  const people = match ? Number(match[1]) : 1;
  if (!Number.isFinite(people) || people < 1) return 1;
  return Math.min(MAX_QTY, Math.max(1, Math.floor(people)));
}

function extractKnownIngredients() {
  return [...new Set((catalog.menu || []).flatMap((item) => Array.isArray(item?.ingredienti) ? item.ingredienti : []))];
}

function inferCategoriaTecnica(ingredientName) {
  const lower = String(ingredientName || '').toLowerCase();
  if (/tonno|salmone|acciug|gamber|pesce/.test(lower)) return 'pesce';
  if (/mozzarella|burrata|bufala|gorgonzola|parmigiano|provola|formaggio/.test(lower)) return 'latticini';
  if (/salame|prosciutto|salsiccia|carne/.test(lower)) return 'carne';
  if (/pomodoro|salsa|pesto/.test(lower)) return 'salsa';
  return 'verdura';
}

function buildCustomAction(message) {
  const text = String(message || '').toLowerCase();
  const wantsCustom = /personal|crea|invent/.test(text);
  if (!wantsCustom) return null;

  const categoria = text.includes('panino') ? 'panino' : (text.includes('pizza') ? 'pizza' : null);
  if (!categoria) return null;

  const availableIngredients = extractKnownIngredients();
  const lowerToOriginal = new Map(availableIngredients.map((ing) => [String(ing).toLowerCase(), ing]));
  const chosen = availableIngredients.filter((ing) => text.includes(String(ing).toLowerCase()));

  const normalizedIngredients = [...new Set(chosen.map((ing) => lowerToOriginal.get(String(ing).toLowerCase())).filter(Boolean))];

  if (categoria === 'panino') {
    const hasForbidden = normalizedIngredients.some((ingredient) => aiRules.forbiddenInPanini.includes(inferCategoriaTecnica(ingredient)))
      || /tonno|salmone|acciug|gamber|pesce/.test(text);
    if (hasForbidden) {
      return { action: 'answer', message: 'Nei panini non posso proporre ingredienti di pesce. Vuoi un panino con ingredienti di terra?' };
    }
  }

  const limitedIngredients = categoria === 'pizza'
    ? normalizedIngredients.slice(0, aiRules.maxIngredientsCustomPizza)
    : normalizedIngredients;

  return {
    action: 'build_custom_item',
    categoria,
    ingredienti: limitedIngredients
  };
}

function chooseItems(message) {
  const text = String(message || '').toLowerCase();
  const activePizzas = (catalog.menu || []).filter((item) => item && item.active);
  const byId = new Map(activePizzas.map((item) => [item.id, item]));
  const fallback = activePizzas[0];
  if (!fallback) return [];

  const people = detectPeople(message);
  const ids = [];
  if (/diavola|piccante|spicy/.test(text) && byId.has('diavola')) ids.push('diavola');
  if (/margherita|classica/.test(text) && byId.has('margherita')) ids.push('margherita');
  if (/mix|assortit|varia|metà|meta/.test(text) && byId.has('margherita')) ids.push('margherita');
  if (!ids.length) ids.push(fallback.id);

  return Array.from(new Set(ids))
    .slice(0, MAX_UNIQUE_ITEMS)
    .map((id, index) => ({
      id,
      qty: Math.max(1, Math.min(MAX_QTY, index === 0 ? people : Math.ceil(people / 2)))
    }));
}

function chooseDrinkUpsell(message, people) {
  const drinks = (catalog.drinks || []).filter((drink) => drink && drink.active);
  if (!drinks.length) return null;
  const text = String(message || '').toLowerCase();
  const preferred = /diavola|piccante|spicy/.test(text)
    ? drinks.find((drink) => /birra/i.test(drink.name))
    : drinks.find((drink) => /acqua/i.test(drink.name));
  const drink = preferred || drinks[0];
  return {
    kind: 'beverage',
    item: { id: drink.id, qty: Math.max(1, Math.min(MAX_QTY, Math.ceil(people / 2))) },
    cta: 'Completa con bevande'
  };
}

function validateActionSchema(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.action !== 'string') return false;

  if (payload.action === 'answer') {
    return typeof payload.message === 'string' && payload.message.trim().length > 0;
  }

  if (payload.action === 'build_custom_item') {
    return ['pizza', 'panino'].includes(payload.categoria)
      && Array.isArray(payload.ingredienti)
      && payload.ingredienti.every((it) => typeof it === 'string');
  }

  if (payload.action === 'add_recommended_items') {
    return Array.isArray(payload.items)
      && payload.items.every((it) => typeof it?.id === 'string' && Number.isFinite(Number(it?.qty)));
  }

  return false;
}

function fallbackAnswer() {
  return {
    action: 'answer',
    message: 'Posso aiutarti a scegliere tra pizza o panino?'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return methodNotAllowed();
  }

  try {
    const body = parseJsonBody(event.body);
    if (!body || typeof body.message !== 'string' || !body.message.trim()) return invalidInput();

    const message = body.message.trim();

    let decision = buildCustomAction(message);

    if (!decision) {
      const items = chooseItems(message);
      if (!items.length) {
        decision = fallbackAnswer();
      } else {
        decision = {
          action: 'add_recommended_items',
          items,
          secondarySuggestion: chooseDrinkUpsell(message, detectPeople(message))
        };
      }
    }

    if (!validateActionSchema(decision)) {
      decision = fallbackAnswer();
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(decision)
    };
  } catch {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR'
      })
    };
  }
};
