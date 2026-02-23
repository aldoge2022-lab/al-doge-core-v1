const supabase = require('./_supabase');

function toIntegerCents(value, alreadyInCents) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return alreadyInCents ? Math.round(numeric) : Math.round(numeric * 100);
}

function normalizeItem(item) {
  return {
    id: String(item.id),
    nome: String(item.nome),
    categoria: String(item.categoria || '').toLowerCase(),
    prezzo_cents: item.prezzo_cents != null
      ? toIntegerCents(item.prezzo_cents, true)
      : toIntegerCents(item.prezzo, false),
    ingredienti: Array.isArray(item.ingredienti) ? item.ingredienti : [],
    disponibile: item.disponibile !== false,
    tag: Array.isArray(item.tag) ? item.tag : []
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, nome, categoria, prezzo, prezzo_cents, ingredienti, disponibile, tag')
      .eq('disponibile', true)
      .order('nome', { ascending: true });

    if (error) {
      console.error('SUPABASE ERROR:', error);

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: error.message,
          code: error.code,
          details: error.details || null
        })
      };
    }

    const response = {
      pizze: (data || []).map(normalizeItem),
      panini: [],
      bevande: []
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  } catch (err) {
    console.error('UNCAUGHT ERROR:', err);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: err.message || 'Internal error'
      })
    };
  }
};
