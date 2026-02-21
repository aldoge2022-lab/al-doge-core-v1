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
    const { table_id, items } = JSON.parse(event.body || '{}');

    if (!table_id || !Array.isArray(items) || !items.length) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    const catalogPrices = buildCatalogPrices();
    let total_cents = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.id) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid item' })
        };
      }
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty < 1) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid qty' })
        };
      }
      const unitPrice = catalogPrices.get(item.id);
      if (!Number.isInteger(unitPrice)) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid item' })
        };
      }
      total_cents += (unitPrice * qty);
    }

    const { error: upsertTableError } = await supabase.from('restaurant_tables').upsert({
      id: table_id,
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
        table_id,
        total_cents,
        paid: false,
        status: 'pending'
      })
      .select()
      .single();

    if (orderError) throw orderError;

    const { error: rpcError } = await supabase.rpc('increment_table_total', {
      table_id_input: table_id,
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
