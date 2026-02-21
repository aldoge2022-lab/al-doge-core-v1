const fs = require('node:fs');
const path = require('node:path');
const localCatalog = require('../../data/catalog');

const MAX_MESSAGE_LENGTH = 400;
const MAX_ITEMS = 3;
const MAX_QTY = 3;

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function errorResponse(headers, statusCode, code, message, extra = {}) {
  return {
    statusCode,
    headers,
    body: JSON.stringify({ error: message, code, ...extra })
  };
}

function clampQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_QTY, Math.round(n)));
}

function detectPeople(message) {
  const lower = String(message || '').toLowerCase();
  const match = lower.match(/(?:siamo|in|per)\s+(\d{1,2})/) || lower.match(/(\d{1,2})\s+persone?/);
  const people = match ? Number(match[1]) : 2;
  return Math.max(1, Math.min(8, Number.isFinite(people) ? people : 2));
}

function parseCategory(pizza) {
  if (pizza && pizza.category) return String(pizza.category);
  if (pizza && Array.isArray(pizza.tags) && pizza.tags.length) return String(pizza.tags[0]);
  return 'classica';
}

function loadCatalogFromDisk() {
  const candidates = [
    path.resolve(process.cwd(), 'public/data/catalog.json'),
    path.resolve(process.cwd(), 'public/data/menu.json')
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.menu)) return parsed;
    } catch (_) {}
  }

  return localCatalog;
}

function normalizeCatalog(catalog) {
  const sourceMenu = Array.isArray(catalog.menu) && catalog.menu.length ? catalog.menu : (localCatalog.menu || []);
  const sourceDrinks = Array.isArray(catalog.drinks) && catalog.drinks.length ? catalog.drinks : (localCatalog.drinks || []);

  const pizzas = sourceMenu
    .filter((p) => p && p.active && p.id && p.name)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name),
      price_cents: Number(p.base_price_cents) || 0,
      category: parseCategory(p).toLowerCase(),
      tags: Array.isArray(p.tags) ? p.tags.map((tag) => String(tag).toLowerCase()) : []
    }));

  const drinks = sourceDrinks
    .filter((d) => d && d.active && d.id && d.name)
    .map((d) => ({
      id: String(d.id),
      name: String(d.name),
      price_cents: Number(d.price_cents) || 0
    }));

  if (!pizzas.length) throw new Error('NO_PIZZAS_AVAILABLE');
  return { pizzas, drinks };
}

function detectPreferences(message) {
  const lower = message.toLowerCase();
  return {
    wantsVegetarian: /(vegetarian|vegetariana|veg|verdur)/i.test(lower),
    wantsSpicy: /(piccante|spicy|diavola|pepperoni)/i.test(lower),
    wantsLight: /(leggera|light|delicata)/i.test(lower)
  };
}

function scorePizza(pizza, message, preferences) {
  const lower = message.toLowerCase();
  let score = 0;
  const haystack = `${pizza.id} ${pizza.name}`.toLowerCase();

  if (lower.includes(pizza.id.toLowerCase()) || lower.includes(pizza.name.toLowerCase())) score += 6;
  if (preferences.wantsVegetarian && /(vegetar|verdur|margherita|classica)/i.test(haystack + ' ' + pizza.category + ' ' + pizza.tags.join(' '))) score += 4;
  if (preferences.wantsSpicy && /(diavola|piccant|spicy|pepperoni)/i.test(haystack + ' ' + pizza.category + ' ' + pizza.tags.join(' '))) score += 4;
  if (preferences.wantsLight && /(margherita|light|legger|classica)/i.test(haystack + ' ' + pizza.category + ' ' + pizza.tags.join(' '))) score += 2;

  return score;
}

function pickDeterministicItems(message, pizzas) {
  const preferences = detectPreferences(message);
  const sorted = [...pizzas]
    .map((pizza, index) => ({ pizza, score: scorePizza(pizza, message, preferences), index }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const selected = sorted.slice(0, MAX_ITEMS).map(({ pizza }) => ({ id: pizza.id, qty: 1 }));
  const people = detectPeople(message);
  let remaining = people;

  for (let i = 0; i < selected.length; i += 1) {
    if (remaining <= 0) break;
    const slotsLeft = selected.length - i;
    const alloc = clampQty(Math.ceil(remaining / slotsLeft));
    selected[i].qty = alloc;
    remaining -= alloc;
  }

  return selected;
}

function pickDrink(message, drinks, selectedPizzaIds) {
  if (!drinks.length) return null;
  const lower = message.toLowerCase();
  const spicyOrder = /(piccante|spicy|diavola)/i.test(lower) || selectedPizzaIds.some((id) => /diavola|piccant/i.test(id));

  const preferred = spicyOrder
    ? drinks.find((d) => /birra|acqua/i.test(d.name))
    : drinks.find((d) => /acqua|cola|fanta|birra/i.test(d.name));

  return preferred || drinks[0];
}

function fallbackNote(items, drink) {
  const drinkText = drink ? ` + ${drink.name}` : '';
  return `Combo consigliata: ${items.length} pizza${items.length > 1 ? 'e' : ''}${drinkText}.\nScelta bilanciata, veloce da preparare e perfetta da condividere.`;
}

async function generateCommercialNote(message, pizzas, items, drink) {
  if (!process.env.OPENAI_API_KEY) return fallbackNote(items, drink);

  const selectedNames = items
    .map((item) => pizzas.find((pizza) => pizza.id === item.id))
    .filter(Boolean)
    .map((pizza, idx) => `${idx + 1}. ${pizza.name} (€${(pizza.price_cents / 100).toFixed(2)})`)
    .join('\n');

  const prompt = [
    'Sei il consulente vendite di AL DOGE.',
    `Richiesta cliente: "${message}"`,
    `Proposta già decisa dal sistema:\n${selectedNames}`,
    `Bibita suggerita: ${drink ? drink.name : 'nessuna'}`,
    'Scrivi SOLO una nota commerciale breve (max 4 righe), convincente, chiara, senza cambiare i prodotti proposti.'
  ].join('\n\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.2-mini',
      input: prompt
    })
  });

  if (!response.ok) return fallbackNote(items, drink);

  const payload = await response.json();
  const note = String(payload.output_text || '').trim();
  if (!note) return fallbackNote(items, drink);
  return note.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 4).join('\n');
}

exports.handler = async function (event) {
  const headers = getCorsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(headers, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const message = String(body.message || '').trim();
    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return errorResponse(headers, 400, 'INVALID_INPUT', 'Invalid input');
    }

    const catalog = loadCatalogFromDisk();
    const { pizzas, drinks } = normalizeCatalog(catalog);

    const items = pickDeterministicItems(message, pizzas);
    const drink = pickDrink(message, drinks, items.map((item) => item.id));
    const note = await generateCommercialNote(message, pizzas, items, drink);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items,
        secondarySuggestion: drink
          ? {
              kind: 'beverage',
              item: { id: drink.id, qty: 1 },
              cta: `Aggiungi ${drink.name}`
            }
          : null,
        note
      })
    };
  } catch (error) {
    console.error('Errore ai-suggest:', error);
    return errorResponse(headers, 500, 'AI_SUGGEST_ERROR', 'Errore tecnico temporaneo.', { items: [], note: '' });
  }
};
