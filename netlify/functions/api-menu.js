const supabase = require('./_supabase');

function normalizeItem(item) {
  return {
    id: item.id,
    nome: item.nome,
    categoria: item.categoria,
    prezzo: Number(item.prezzo),
    ingredienti: Array.isArray(item.ingredienti) ? item.ingredienti : [],
    allergeni: Array.isArray(item.allergeni) ? item.allergeni : [],
    tag: Array.isArray(item.tag) ? item.tag : [],
    varianti: item.varianti && typeof item.varianti === 'object' ? item.varianti : {},
    promozioni: item.promozioni && typeof item.promozioni === 'object' ? item.promozioni : {}
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, nome, categoria, prezzo, ingredienti, allergeni, tag, varianti, promozioni')
      .eq('disponibile', true)
      .order('nome', { ascending: true });

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Database error' }) };
    }

    const response = {
      pizze: [],
      panini: [],
      bevande: [],
      tag: [],
      varianti: {},
      promozioni: {}
    };
    const tags = new Set();

    for (const row of data || []) {
      const item = normalizeItem(row);
      if (item.categoria === 'pizza') response.pizze.push(item);
      if (item.categoria === 'panino') response.panini.push(item);
      if (item.categoria === 'bevanda') response.bevande.push(item);
      for (const t of item.tag) tags.add(String(t));
      if (Object.keys(item.varianti).length) response.varianti[item.id] = item.varianti;
      if (Object.keys(item.promozioni).length) response.promozioni[item.id] = item.promozioni;
    }

    response.tag = Array.from(tags).sort((a, b) => a.localeCompare(b));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
