const { calculateSupplements, getIngredients } = require('../../../core/menu/food-engine');

const BASE_PRICE = Number(process.env.PANINO_BASE_PRICE || 5);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function parseQty(message) {
  const normalized = normalizeText(message);
  const match = normalized.match(/\b(\d{1,2})\b/);
  const qty = match ? Number(match[1]) : 1;
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function getPaninoWhitelist() {
  return getIngredients().filter((ingredient) => ingredient?.paninoAllowed);
}

function extractRequestedIngredients(message) {
  const normalizedMessage = normalizeText(message);
  const catalog = getIngredients();
  const mapById = new Map();

  catalog.forEach((ingredient) => {
    const key = normalizeText(ingredient.name || ingredient.id);
    if (key && normalizedMessage.includes(key)) {
      mapById.set(ingredient.id, ingredient);
    }
  });

  return Array.from(mapById.values());
}

function buildPaninoItem(ingredients, qty) {
  const ingredientsExtra = calculateSupplements(ingredients);
  const unitPrice = Number((BASE_PRICE + ingredientsExtra).toFixed(2));

  return {
    type: 'PANINO',
    name: 'Panino Custom',
    ingredients,
    price: unitPrice,
    qty
  };
}

function getMaxIngredients() {
  const value = Number(process.env.PANINO_MAX_INGREDIENTS || 6);
  return Number.isFinite(value) && value > 0 ? value : 6;
}

function handlePanino({ message, intent }) {
  const requestedIngredients = extractRequestedIngredients(message);
  const whitelist = getPaninoWhitelist();
  const effectiveIntent = intent === 'info' ? 'build' : intent;
  const maxIngredients = getMaxIngredients();

  let validIngredients = requestedIngredients.filter((ingredient) => ingredient?.paninoAllowed);

  // HARD FIX: prevent empty panino when explicit ingredient requested
  if (
    requestedIngredients &&
    requestedIngredients.length > 0 &&
    validIngredients.length === 0
  ) {
    // forza inclusione ingredienti richiesti se esistono nel catalogo
    validIngredients = requestedIngredients.filter((i) => i.paninoAllowed !== false);
  }

  const ingredientIds = Array.from(
    new Set((validIngredients || []).map((ingredient) => ingredient?.id).filter(Boolean))
  );

  if (ingredientIds.length > maxIngredients) {
    return {
      ok: false,
      cartUpdates: [],
      reply: `Hai superato il massimo di ${maxIngredients} ingredienti consentiti per il panino.`
    };
  }

  if (effectiveIntent !== 'add' && effectiveIntent !== 'build') {
    return {
      ok: true,
      cartUpdates: [],
      reply: 'Posso creare un panino custom: dimmi "aggiungi panino" con gli ingredienti desiderati.'
    };
  }

  if (ingredientIds.length === 0) {
    if (requestedIngredients.length === 0 && whitelist.length > 0) {
      const defaultIngredients = whitelist.slice(
        0,
        Math.min(whitelist.length, Math.min(3, maxIngredients))
      );
      const defaultIds = defaultIngredients.map((ingredient) => ingredient.id).filter(Boolean);
      const qty = parseQty(message);
      const cartItem = buildPaninoItem(defaultIds, qty);

      return {
        ok: true,
        cartUpdates: [cartItem],
        reply: `Panino custom aggiunto (${qty}x) con ${defaultIds.length} ingredienti.`
      };
    }

    return {
      ok: true,
      cartUpdates: [],
      reply: 'Ti preparo un panino personalizzato perfetto per te.'
    };
  }

  const qty = parseQty(message);
  const cartItem = buildPaninoItem(ingredientIds, qty);

  return {
    ok: true,
    cartUpdates: [cartItem],
    reply: `Panino custom aggiunto (${qty}x) con ${ingredientIds.length} ingredienti.`
  };
}

module.exports = {
  handlePanino,
  extractRequestedIngredients,
  parseQty
};
