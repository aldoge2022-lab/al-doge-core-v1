const supabase = require('./_supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.STAFF_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'STAFF_API_KEY non configurata' }) };
  }

  const apiKey = event.headers?.['x-api-key'] || event.headers?.['X-API-Key'];
  if (apiKey !== process.env.STAFF_API_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!UUID_REGEX.test(id)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid id' }) };
    }

    const patch = {};
    if (typeof body.prezzo !== 'undefined') {
      const prezzo = Number(body.prezzo);
      if (!Number.isFinite(prezzo) || prezzo <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid prezzo' }) };
      }
      patch.prezzo = Number(prezzo.toFixed(2));
    }
    if (typeof body.promozioni !== 'undefined') {
      if (!body.promozioni || typeof body.promozioni !== 'object' || Array.isArray(body.promozioni)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid promozioni' }) };
      }
      patch.promozioni = body.promozioni;
    }
    if (typeof body.disponibile !== 'undefined') {
      if (typeof body.disponibile !== 'boolean') {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid disponibile' }) };
      }
      patch.disponibile = body.disponibile;
    }

    if (!Object.keys(patch).length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No fields to update' }) };
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('menu_items')
      .update(patch)
      .eq('id', id)
      .select('id, prezzo, promozioni, disponibile')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { statusCode: 404, body: JSON.stringify({ error: 'Menu item not found' }) };
      }
      return { statusCode: 500, body: JSON.stringify({ error: 'Database error' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON payload' }) };
  }
};
