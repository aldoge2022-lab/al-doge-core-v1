const fs = require('node:fs');
const path = require('node:path');
const localCatalog = require('../../data/catalog');

const MAX_MESSAGE_LENGTH = 400;
const MAX_ITEMS = 3;

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
  return Math.max(1, Math.min(3, Math.round(n)));
}

function detectPeople(message) {
  const lower = String(message || '').toLowerCase();
  const match = lower.match(/(?:siamo|in|per)\s+(\d{1,2})/) || lower.match(/(\d{1,2})\s+persone?/);
  const people = match ? Number(match[1]) : 2;
  return Math.max(1, Math.min(6, Number.isFinite(people) ? people : 2));
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
    } catch (_) {
      // fallback below
    }
  }

  return localCatalog;
}

function normalizeCatalog(catalog) {
  const pizzas = (catalog.menu || [])
    .filter((p) => p && p.active && p.id && p.name)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name),
      price_cents: Number(p.base_price_cents) || 0,
      category: parseCategory(p)
    }));

  const drinks = (catalog.drinks || [])
    .filter((d) => d && d.active && d.id && d.name)
    .map((d) => ({
      id: String(d.id),
      name: String(d.name),
      price_cents: Number(d.price_cents) || 0
    }));

  if (!pizzas.length) {
    throw new Error('NO_PIZZAS_AVAILABLE');
  }

  return { pizzas, drinks };
}

function buildPrompt(message, pizzas, drinks) {
  const pizzaList = pizzas
    .map((p) => `${p.id}: ${p.name} (€${(p.price_cents / 100).toFixed(2)}) [${p.category}]`)
    .join(', ');
  const drinkList = drinks
    .map((d) => `${d.id}: ${d.name} (€${(d.price_cents / 100).toFixed(2)})`)
    .join(', ');

  return `Sei il consulente vendite di AL DOGE.\nCliente: "${message}"\nPizze disponibili: ${pizzaList}\nBibite disponibili: ${drinkList || 'nessuna'}\nRegole: proponi solo id esistenti, max 3 pizze diverse, evita duplicati, tono commerciale breve, massimo 4 righe nel campo note. Rispondi SOLO JSON: {"items":[{"id":"pizza-id","qty":1}],"drink_id":"id-opzionale","note":"testo breve"}.`;
}

async function callOpenAI(message, pizzas, drinks) {
  if (!process.env.OPENAI_API_KEY) return null;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.2-mini',
      input: buildPrompt(message, pizzas, drinks)
    })
  });

  if (!response.ok) throw new Error('OPENAI_REQUEST_FAILED');

  const payload = await response.json();
  const text = String(payload.output_text || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function heuristicSuggestion(message, pizzas, drinks) {
  const lower = message.toLowerCase();
  const selected = [];

  const pushUnique = (pizza) => {
    if (!pizza || selected.find((entry) => entry.id === pizza.id)) return;
    selected.push({ id: pizza.id, qty: 1 });
  };

  pizzas.forEach((pizza) => {
    const name = pizza.name.toLowerCase();
    const id = pizza.id.toLowerCase();
    if (lower.includes(name) || lower.includes(id)) pushUnique(pizza);
  });

  const wantsVegetarian = /vegetarian|veg/i.test(lower);
  const wantsSpicy = /piccante|spicy|diavola/i.test(lower);

  if (wantsVegetarian) {
    pushUnique(pizzas.find((p) => /vegetar/i.test(p.name) || /vegetar/i.test(p.category)) || pizzas[0]);
  }
  if (wantsSpicy) {
    pushUnique(pizzas.find((p) => /diavola|piccante/i.test(p.name) || /piccante/i.test(p.category)) || pizzas[0]);
  }

  for (const pizza of pizzas) {
    if (selected.length >= MAX_ITEMS) break;
    pushUnique(pizza);
  }

  const people = detectPeople(message);
  selected.forEach((item, idx) => {
    item.qty = idx === 0 ? clampQty(Math.ceil(people / Math.min(MAX_ITEMS, selected.length || 1))) : 1;
  });

  const drink = drinks.find((d) => /birra|acqua|cola/i.test(d.name)) || drinks[0] || null;

  return {
    items: selected.slice(0, MAX_ITEMS),
    drink_id: drink ? drink.id : null,
    note: 'Scelta top per oggi: gusto equilibrato e alta resa. Completa con bibita per combo perfetta.'
  };
}

function sanitizeSuggestion(raw, pizzas, drinks) {
  const pizzaById = new Map(pizzas.map((p) => [p.id, p]));
  const items = Array.isArray(raw && raw.items) ? raw.items : [];
  const seen = new Set();
  const validItems = [];

  for (const item of items) {
    const id = String(item && item.id ? item.id : '');
    if (!pizzaById.has(id) || seen.has(id)) continue;
    seen.add(id);
    validItems.push({ id, qty: clampQty(item.qty) });
    if (validItems.length >= MAX_ITEMS) break;
  }

  if (!validItems.length) {
    validItems.push({ id: pizzas[0].id, qty: 1 });
  }

  const drinkId = String(raw && raw.drink_id ? raw.drink_id : '');
  const drink = drinks.find((d) => d.id === drinkId) || null;

  const note = String(raw && raw.note ? raw.note : '').trim();
  const compactNote = note
    ? note.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 4).join('\n')
    : 'Ti consiglio una combo pronta: ottimo equilibrio e scontrino smart.';

  return {
    items: validItems,
    secondarySuggestion: drink
      ? {
          kind: 'beverage',
          item: { id: drink.id, qty: 1 },
          cta: `Aggiungi ${drink.name}`
        }
      : null,
    note: compactNote
  };
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

    let rawSuggestion = await callOpenAI(message, pizzas, drinks);
    if (!rawSuggestion) {
      rawSuggestion = heuristicSuggestion(message, pizzas, drinks);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(sanitizeSuggestion(rawSuggestion, pizzas, drinks))
    };
  } catch (error) {
    console.error('Errore ai-suggest:', error);
    return errorResponse(headers, 500, 'AI_SUGGEST_ERROR', 'Errore tecnico temporaneo.', { items: [], note: '' });
  }
};
