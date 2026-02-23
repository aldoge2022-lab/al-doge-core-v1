const catalog = require('../../data/catalog');
const MAX_UNIQUE_ITEMS = 3;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function errorResponse(statusCode, code, error) {
  return jsonResponse(statusCode, { ok: false, code, error });
}

function successResponse(items, note) {
  const payload = { ok: true, items };
  if (note) payload.note = note;
  return jsonResponse(200, payload);
}

function parseJsonBody(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function chooseItems(message) {
  const text = String(message || '').toLowerCase();
  const activePizzas = (catalog.menu || []).filter((item) => item && item.active);
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
  try {
    if (event.httpMethod !== 'POST') {
      return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Metodo non consentito');
    }

    if (!event || typeof event.body !== 'string') {
      return errorResponse(400, 'INVALID_INPUT', 'Payload non valido');
    }

    const body = parseJsonBody(event.body);
    if (!body) {
      return errorResponse(400, 'INVALID_INPUT', 'JSON non valido');
    }

    const prompt = typeof body.prompt === 'string' && body.prompt.trim()
      ? body.prompt.trim()
      : (typeof body.message === 'string' ? body.message.trim() : '');
    if (!prompt) {
      return errorResponse(400, 'INVALID_INPUT', 'Il campo prompt è obbligatorio');
    }

    const hasOpenAiKey = typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim().length > 0;
    let note = '';
    if (!hasOpenAiKey) {
      console.error('OPENAI_API_KEY mancante: uso fallback deterministico locale');
      note = 'Motore AI in fallback locale';
    }

    const items = chooseItems(prompt);
    return successResponse(Array.isArray(items) ? items : [], note);
  } catch (error) {
    console.error('ai-suggest handler error:', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'Errore tecnico temporaneo');
  }
};
