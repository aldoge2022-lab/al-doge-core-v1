const supabase = require('./_supabase');
const catalog = require('../../data/catalog');

function buildCatalogPrices() {
  const prices = new Map();
  for (const pizza of (catalog.menu || [])) {
    if (pizza && pizza.active && pizza.id && Number.isInteger(pizza.base_price_cents) && pizza.base_price_cents > 0) {
      prices.set(pizza.id, pizza.base_price_cents);
    }
  }
  for (const drink of (catalog.drinks || [])) {
    if (drink && drink.active && drink.id && Number.isInteger(drink.price_cents) && drink.price_cents > 0) {
      prices.set(drink.id, drink.price_cents);
    }
  }
  return prices;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('Payload ricevuto:', event.body);

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON payload' })
      };
    }

    const { table_id, items } = payload;

    if (typeof table_id === 'undefined' || table_id === null) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing table_id' })
      };
    }
    const normalizedTableId = typeof table_id === 'string' ? Number(table_id) : table_id;
    if (typeof normalizedTableId !== 'number' || !Number.isFinite(normalizedTableId)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid table_id: must be a number' })
      };
    }
    if (!Array.isArray(items)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing items array' })
      };
    }
    if (!items.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Items array empty' })
      };
    }

    const catalogPrices = buildCatalogPrices();
    let total_cents = 0;
    for (const [index, item] of items.entries()) {
      if (!item || typeof item !== 'object') {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Invalid item at index ${index}` })
        };
      }
      if (!item.id || typeof item.id !== 'string') {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Missing item id at index ${index}` })
        };
      }
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty < 1) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Invalid quantity for item ${item.id}` })
        };
      }
      const unitPrice = catalogPrices.get(item.id);
      if (!Number.isInteger(unitPrice)) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Item not found in catalog: ${item.id}` })
        };
      }
      total_cents += (unitPrice * qty);
    }

    const { error: upsertTableError } = await supabase.from('restaurant_tables').upsert({
      id: normalizedTableId,
      status: 'open',
      total_cents: 0
    }, {
      onConflict: 'id',
      ignoreDuplicates: true
    });
    if (upsertTableError) throw upsertTableError;

    const { data: order, error: orderError } = await supabase
      .from('table_orders')
      .insert({
        table_id: normalizedTableId,
        total_cents,
        paid: false,
        status: 'pending'
      })
      .select()
      .single();

    if (orderError) throw orderError;

    const { error: rpcError } = await supabase.rpc('increment_table_total', {
      table_id_input: normalizedTableId,
      amount_input: total_cents
    });
    if (rpcError) throw rpcError;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        order_id: order.id
      })
    };
  } catch (error) {
    console.error('Create table order error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
