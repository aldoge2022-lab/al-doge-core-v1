const OpenAI = require('openai');
const catalogData = require('../../data/catalog');

const MAX_UNIQUE_ITEMS = 3;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function getActiveCatalog(catalog) {
  const sourceCatalog = catalog && Array.isArray(catalog.menu) ? catalog : catalogData;
  return (sourceCatalog.menu || []).filter((item) => item && item.active);
}

function pickFirstAvailable(byId, candidates) {
  return candidates.find((id) => byId.has(id));
}

function fallbackIdsFromPrompt(message, byId) {
  const text = String(message || '').toLowerCase();
  const ids = [];

  if (/piccante|spicy|diavola|pepper/i.test(text)) {
    const spicy = pickFirstAvailable(byId, ['diavola']);
    if (spicy) ids.push(spicy);
  }

  if (/bianca|formaggi|quattro/i.test(text)) {
    const white = pickFirstAvailable(byId, ['quattro-formaggi', 'bufala']);
    if (white) ids.push(white);
  }

  if (/verdur|vegetarian|legger|ortolana/i.test(text)) {
    const veggie = pickFirstAvailable(byId, ['margherita', 'bufala']);
    if (veggie) ids.push(veggie);
  }

  if (/4 persone|quattro persone|famiglia|gruppo|condividere|party/i.test(text)) {
    const groupSet = ['margherita', 'diavola', 'quattro-formaggi'];
    groupSet.forEach((id) => {
      if (byId.has(id)) ids.push(id);
    });
  }

  if (/classica|semplice|tradizionale|margherita/i.test(text) && byId.has('margherita')) {
    ids.push('margherita');
  }

  if (!ids.length) {
    const first = [...byId.keys()][0];
    if (first) ids.push(first);
  }

  return Array.from(new Set(ids)).slice(0, MAX_UNIQUE_ITEMS);
}

async function chooseIdsWithOpenAI(prompt, availableIds) {
  const hasOpenAI = typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.trim();
  if (!hasOpenAI) return null;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Sei un assistente di una pizzeria.\nDevi rispondere SOLO con JSON valido nel formato:\n{ "ids": ["id1","id2"] }\nScegli massimo 3 ID dal catalogo fornito.\nNon inventare ID.\nNon scrivere testo extra.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          user_prompt: prompt,
          available_ids: availableIds
        })
      }
    ]
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') return null;

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!parsed || !Array.isArray(parsed.ids)) return null;

  return parsed.ids.filter((id) => typeof id === 'string').slice(0, MAX_UNIQUE_ITEMS);
}

function hydrateItems(ids, byId) {
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      name: item.name,
      price_cents: item.price_cents
    }));
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

    const activePizzas = getActiveCatalog(catalog);
    const byId = new Map(activePizzas.map((item) => [item.id, item]));
    const availableIds = [...byId.keys()];

    let aiIds = null;
    try {
      aiIds = await chooseIdsWithOpenAI(prompt.trim(), availableIds);
    } catch (error) {
      console.error('OpenAI error:', error);
      aiIds = null;
    }

    const fallbackIds = fallbackIdsFromPrompt(prompt.trim(), byId);
    const candidateIds = Array.isArray(aiIds) ? aiIds : fallbackIds;
    const validIds = candidateIds.filter((id) => byId.has(id));
    const finalIds = Array.from(new Set(validIds)).slice(0, MAX_UNIQUE_ITEMS);
    const guaranteedIds = finalIds.length ? finalIds : fallbackIds;

    return jsonResponse(200, {
      ok: true,
      suggestion: {
        items: hydrateItems(guaranteedIds, byId),
        note: ''
      }
    });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, {
      ok: false,
      error: err.message || 'Errore interno'
    });
  }
};
