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

function activeMenuFromCatalog(inputCatalog) {
  const sourceCatalog = inputCatalog && Array.isArray(inputCatalog.menu) ? inputCatalog : catalogData;
  return (sourceCatalog.menu || []).filter((item) => item && item.active && item.id);
}

function fallbackIdsFromPrompt(prompt, activeItems) {
  const text = String(prompt || '').toLowerCase();
  const ids = new Set();
  const activeById = new Map(activeItems.map((item) => [item.id, item]));

  if (/diavola|piccante|spicy/.test(text) && activeById.has('diavola')) ids.add('diavola');
  if (/margherita|classica/.test(text) && activeById.has('margherita')) ids.add('margherita');
  if (/formaggi|quattro/.test(text) && activeById.has('quattro-formaggi')) ids.add('quattro-formaggi');
  if (/bufala|premium/.test(text) && activeById.has('bufala')) ids.add('bufala');

  if (!ids.size && activeItems[0]) ids.add(activeItems[0].id);
  return Array.from(ids).slice(0, MAX_UNIQUE_ITEMS);
}

function parseIdsFromOpenAIText(text) {
  if (!text || typeof text !== 'string') return [];

  const normalized = text
    .replace(/^```json\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.ids)) return parsed.ids;
  } catch (_) {
    return [];
  }

  return [];
}

async function idsFromOpenAI(prompt, activeItems) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    return { content: '', parsed: { ids: [] } };
  }

  const menuForPrompt = activeItems.map((item) => ({
    id: item.id,
    name: item.name,
    ingredients: item.ingredients || '',
    category: item.category || ''
  }));
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    input: [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: `
Seleziona massimo ${MAX_UNIQUE_ITEMS} ID dal menu attivo.

REGOLE OBBLIGATORIE:
- Se il cliente menziona un ingrediente specifico, dai priorità assoluta a prodotti che lo contengono.
- Non proporre prodotti incoerenti con restrizioni (es: senza carne → no carne).
- Se richiesta generica, proponi un mix bilanciato tra classiche, premium e bestseller.
- Rispondi SOLO con JSON valido nel formato:
{"ids":["id1","id2"]}
`
        }]
      },
      {
        role: 'user',
        content: [{
          type: 'input_text',
          text: `
Prompt cliente: ${prompt}

Menu attivo:
${menuForPrompt.map((item) =>
`ID: ${item.id}
Nome: ${item.name}
Ingredienti: ${item.ingredients}
Categoria: ${item.category}
`).join('\n')}
`
        }]
      }
    ]
  });

  const outputText = typeof response.output_text === 'string'
    ? response.output_text
    : '';

  return {
    content: outputText,
    parsed: { ids: parseIdsFromOpenAIText(outputText) }
  };
}

function sanitizeIds(candidateIds, activeItems) {
  const activeById = new Map(activeItems.map((item) => [item.id, item]));
  const ids = Array.isArray(candidateIds) ? candidateIds : [];

  return Array.from(new Set(ids
    .map((id) => String(id || '').trim())
    .filter((id) => activeById.has(id))))
    .slice(0, MAX_UNIQUE_ITEMS);
}

exports.fallbackIdsFromPrompt = fallbackIdsFromPrompt;

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

    const activeItems = activeMenuFromCatalog(catalog);
    if (!activeItems.length) {
      return jsonResponse(200, {
        ok: true,
        suggestion: { items: [], note: '' }
      });
    }

    const availableIds = activeItems.map((item) => item.id);
    let content = '';
    let parsed = null;
    let validIds = [];
    try {
      const aiResult = await idsFromOpenAI(prompt.trim(), activeItems);
      content = aiResult?.content || '';
      parsed = aiResult?.parsed || null;
      validIds = sanitizeIds(parsed?.ids, activeItems);
    } catch (error) {
      console.error('OpenAI suggestion failed, using fallback:', error.message || error);
    }

    const aiIds = sanitizeIds(validIds, activeItems);

    let guaranteedIds;

    if (aiIds.length > 0) {
      guaranteedIds = aiIds;
    } else {
      guaranteedIds = sanitizeIds(
        fallbackIdsFromPrompt(prompt.trim(), activeItems),
        activeItems
      );
    }

    console.log('=== AI DEBUG START ===');
    console.log('PROMPT:', prompt);
    console.log('AVAILABLE IDS:', availableIds);
    console.log('OPENAI RAW CONTENT:', content);
    console.log('PARSED IDS:', parsed?.ids);
    console.log('VALID IDS AFTER FILTER:', validIds);
    console.log('AI IDS:', aiIds);
    console.log('FINAL IDS USED:', guaranteedIds);
    console.log('=== AI DEBUG END ===');

    const items = guaranteedIds.map((id) => ({ id, qty: 1 }));

    return jsonResponse(200, {
      ok: true,
      suggestion: { items, note: '' }
    });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, {
      ok: false,
      error: err.message || 'Errore interno'
    });
  }
};
