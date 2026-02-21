const catalog = require('../../data/catalog');

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

async function createCommercialNote(message, items, drinkUpsell) {
  if (!process.env.OPENAI_API_KEY || typeof fetch !== 'function') return '';
  try {
    const itemText = items.map((item) => `${item.id} x${item.qty}`).join(', ');
    const upsellText = drinkUpsell ? `${drinkUpsell.item.id} x${drinkUpsell.item.qty}` : 'nessuna bevanda';
    const prompt = `Scrivi una nota commerciale breve in italiano (max 18 parole) per questa proposta pizzeria. Cliente: "${String(message)}". Proposta: ${itemText}. Upsell bevanda: ${upsellText}.`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5-2-mini',
        input: prompt
      })
    });
    if (!response.ok) return '';

    const payload = await response.json();
    const text = payload?.output_text
      || payload?.output?.[0]?.content?.[0]?.text
      || payload?.choices?.[0]?.message?.content
      || '';
    return String(text || '').trim().slice(0, 240);
  } catch {
    return '';
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return methodNotAllowed();
  }

  try {
    const body = parseJsonBody(event.body);
    if (!body || typeof body.message !== 'string' || !body.message.trim()) return invalidInput();
    const message = body.message.trim();
    const items = chooseItems(message);
    if (!items.length) return invalidInput();
    const people = detectPeople(message);
    const secondarySuggestion = chooseDrinkUpsell(message, people);
    const note = await createCommercialNote(message, items, secondarySuggestion);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        note,
        secondarySuggestion
      })
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
