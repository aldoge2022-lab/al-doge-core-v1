const catalogData = require('../../data/catalog');

const MAX_UNIQUE_ITEMS = 3;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function chooseItems(message, catalog) {
  const text = String(message || '').toLowerCase();
  const sourceCatalog = catalog && Array.isArray(catalog.menu) ? catalog : catalogData;
  const activePizzas = (sourceCatalog.menu || []).filter((item) => item && item.active);
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
    .map((item) => ({ id: item.id, qty: 1 }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      error: 'Metodo non consentito'
    });
  }

  try {
    const { prompt, catalog } = JSON.parse(event.body || '{}');

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return jsonResponse(400, {
        ok: false,
        error: 'Prompt mancante'
      });
    }

    const result = {
      items: chooseItems(prompt.trim(), catalog),
      note: typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim()
        ? ''
        : 'Motore AI in fallback locale'
    };

    return jsonResponse(200, {
      ok: true,
      suggestion: result
    });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, {
      ok: false,
      error: err.message || 'Errore interno'
    });
  }
};
