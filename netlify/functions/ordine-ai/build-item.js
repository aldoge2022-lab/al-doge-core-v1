const aiRules = require('../../../config/ai-rules');
const { buildPanino } = require('../../../core/panino');

const VALID_CATEGORIES = new Set(['pizza', 'panino']);
const DEFAULT_PIZZA_BASE = 5;

function toMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(2));
}

function dedupe(values) {
  return [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeIngredientTable(ingredientiTable) {
  if (!Array.isArray(ingredientiTable)) return { byName: new Map(), error: 'Tabella ingredienti non valida' };

  const byName = new Map();
  for (const entry of ingredientiTable) {
    const nome = String(entry?.nome || '').trim().toLowerCase();
    const categoriaTecnica = String(entry?.categoria_tecnica || '').trim().toLowerCase();
    const allergeni = Array.isArray(entry?.allergeni)
      ? entry.allergeni.filter((value) => value !== null && value !== undefined).map((value) => String(value).trim().toLowerCase()).filter(Boolean)
      : null;

    if (!nome || !categoriaTecnica || !allergeni) {
      return { byName: new Map(), error: 'Tabella ingredienti incompleta: nome, categoria_tecnica o allergeni mancanti' };
    }

    const prezzoExtra = entry?.prezzo_extra !== undefined ? Number(entry.prezzo_extra) : Number.NaN;

    if (!Number.isFinite(prezzoExtra)) {
      return { byName: new Map(), error: `Prezzo non valido per ingrediente: ${nome}` };
    }

    byName.set(nome, {
      nome,
      categoria_tecnica: categoriaTecnica,
      prezzo_extra: Number(prezzoExtra.toFixed(2)),
      allergeni
    });
  }

  return { byName, error: null };
}

function calculateIngredients(ingredientNames, byName, categoriaItem, lactoseFree) {
  let total = 0;
  const resolved = [];
  const allergeni = new Set();

  for (const ingredientName of ingredientNames) {
    const ingredient = byName.get(ingredientName);
    if (!ingredient) {
      return { error: `Ingrediente non esistente: ${ingredientName}` };
    }

    total += ingredient.prezzo_extra;
    resolved.push(ingredient.nome);

    ingredient.allergeni.forEach((allergene) => {
      if (lactoseFree && allergene === 'lattosio') return;
      allergeni.add(allergene);
    });
  }

  if (!Number.isFinite(total)) {
    return { error: 'Prezzo NaN' };
  }

  return {
    prezzoIngredienti: Number(total.toFixed(2)),
    ingredienti: resolved,
    allergeni: [...allergeni]
  };
}

function applyDeltas(currentIngredients, aggiungi, rimuovi) {
  const next = new Set(currentIngredients);
  aggiungi.forEach((ing) => next.add(ing));
  rimuovi.forEach((ing) => next.delete(ing));
  return [...next];
}

function buildItem({ payload = {}, ingredientiTable = [], impasti = {}, existingItems = new Map(), normalizeDuplicates = true } = {}) {
  const { byName, error: tableError } = normalizeIngredientTable(ingredientiTable);
  if (tableError) return { statusCode: 400, body: { error: tableError } };

  const categoria = String(payload.categoria || '').trim().toLowerCase();
  const isCustom = Boolean(payload.custom);
  const hasItemId = payload.item_id !== undefined && payload.item_id !== null;

  if (hasItemId) {
    const itemId = String(payload.item_id).trim();
    const baseItem = existingItems instanceof Map ? existingItems.get(itemId) : null;
    if (!baseItem) {
      return { statusCode: 400, body: { error: 'item_id inesistente' } };
    }

    const categoriaItem = String(baseItem.categoria || '').toLowerCase();
    if (!VALID_CATEGORIES.has(categoriaItem)) {
      return { statusCode: 400, body: { error: 'categoria non valida' } };
    }

    const addList = dedupe(Array.isArray(payload.aggiungi) ? payload.aggiungi : []);
    const removeList = dedupe(Array.isArray(payload.rimuovi) ? payload.rimuovi : []);
    const ingredienti = applyDeltas(dedupe(baseItem.ingredienti || []), addList, removeList);
    const impastoKey = payload.impasto ? String(payload.impasto).trim().toLowerCase() : String(baseItem.impasto || '').trim().toLowerCase();

    if (impastoKey && impasti[impastoKey] === undefined) {
      return { statusCode: 400, body: { error: 'impasto non esistente' } };
    }

    const lactoseFree = Boolean(payload.senza_lattosio || baseItem.senza_lattosio);
    if (categoriaItem === 'panino') {
      const panino = buildPanino(ingredienti);
      if (!panino.ok) return { statusCode: 400, body: { error: panino.error } };

      return {
        statusCode: 200,
        body: {
          item_id: itemId,
          categoria: categoriaItem,
          ingredienti: panino.ingredientIds,
          impasto: null,
          allergeni: [],
          prezzo: panino.pricing.total,
          senza_lattosio: lactoseFree,
          pricing: panino.pricing
        }
      };
    }
    const calc = calculateIngredients(ingredienti, byName, categoriaItem, lactoseFree);
    if (calc.error) return { statusCode: 400, body: { error: calc.error } };

    const impastoPrice = impastoKey ? Number(impasti[impastoKey]) : 0;
    const prezzo = toMoney(DEFAULT_PIZZA_BASE + calc.prezzoIngredienti + impastoPrice);
    if (prezzo === null) return { statusCode: 400, body: { error: 'Prezzo NaN' } };

    return {
      statusCode: 200,
      body: {
        item_id: itemId,
        categoria: categoriaItem,
        ingredienti: calc.ingredienti,
        impasto: impastoKey || null,
        allergeni: calc.allergeni,
        prezzo,
        senza_lattosio: lactoseFree
      }
    };
  }

  if (!isCustom) {
    return { statusCode: 400, body: { error: 'Payload non supportato' } };
  }

  if (!VALID_CATEGORIES.has(categoria)) {
    return { statusCode: 400, body: { error: 'categoria non valida' } };
  }

  const rawIngredients = Array.isArray(payload.ingredienti) ? payload.ingredienti : [];
  const normalizedIngredients = normalizeDuplicates ? dedupe(rawIngredients) : rawIngredients;
  if (!normalizeDuplicates && dedupe(rawIngredients).length !== rawIngredients.length) {
    return { statusCode: 400, body: { error: 'Ingredienti duplicati non consentiti' } };
  }


  if (categoria === 'pizza' && normalizedIngredients.length > aiRules.maxIngredientsCustomPizza) {
    return { statusCode: 400, body: { error: 'Troppe aggiunte per pizza personalizzata' } };
  }
  const impastoKey = payload.impasto ? String(payload.impasto).trim().toLowerCase() : '';
  if (impastoKey && impasti[impastoKey] === undefined) {
    return { statusCode: 400, body: { error: 'impasto non esistente' } };
  }

  const lactoseFree = Boolean(payload.senza_lattosio);
  if (categoria === 'panino') {
    const panino = buildPanino(normalizedIngredients);
    if (!panino.ok) return { statusCode: 400, body: { error: panino.error } };

    return {
      statusCode: 200,
      body: {
        categoria,
        ingredienti: panino.ingredientIds,
        impasto: null,
        allergeni: [],
        prezzo: panino.pricing.total,
        senza_lattosio: lactoseFree,
        pricing: panino.pricing
      }
    };
  }

    const calc = calculateIngredients(normalizedIngredients, byName, categoria, lactoseFree);
    if (calc.error) return { statusCode: 400, body: { error: calc.error } };

    const basePrice = DEFAULT_PIZZA_BASE;
    const impastoPrice = impastoKey ? Number(impasti[impastoKey]) : 0;
    const prezzo = toMoney(basePrice + calc.prezzoIngredienti + impastoPrice);
    if (prezzo === null) return { statusCode: 400, body: { error: 'Prezzo NaN' } };

  return {
    statusCode: 200,
    body: {
      categoria,
      ingredienti: calc.ingredienti,
      impasto: impastoKey || null,
      allergeni: calc.allergeni,
      prezzo,
      senza_lattosio: lactoseFree
    }
  };
}

module.exports = {
  buildItem,
  normalizeIngredientTable,
  dedupe
};
