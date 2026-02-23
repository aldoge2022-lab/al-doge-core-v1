const catalogData = require('../../data/catalog');

const MAX_UNIQUE_ITEMS = 3;

function chooseItems(message) {
  const text = String(message || '').toLowerCase();
  const activePizzas = (catalogData.menu || []).filter((item) => item && item.active);
  const byId = new Map(activePizzas.map((item) => [item.id, item]));
  const fallback = activePizzas[0];
  if (!fallback) return [];

  const ids = [];
  if (/diavola|piccante|spicy/.test(text) && byId.has('diavola')) ids.push('diavola');
  if (/margherita|classica/.test(text) && byId.has('margherita')) ids.push('margherita');
  if (/mix|assortit|varia|metà|meta/.test(text) && byId.has('margherita')) ids.push('margherita');
  if (!ids.length) ids.push(fallback.id);

  return Array.from(new Set(ids))
    .slice(0, MAX_UNIQUE_ITEMS)
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      name: item.name,
      price_cents: Number(item.base_price_cents ?? item.price_cents ?? item.price) || 0
    }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        error: 'Metodo non consentito'
      })
    };
  }

  try {
    const { prompt } = JSON.parse(event.body || '{}');

    if (!prompt) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: 'Prompt mancante'
        })
      };
    }

    const result = {
      items: chooseItems(prompt),
      note: typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim()
        ? ''
        : 'Motore AI in fallback locale'
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        suggestion: result
      })
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: err.message || 'Errore interno'
      })
    };
  }
};
