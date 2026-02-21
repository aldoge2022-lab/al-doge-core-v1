const supabase = require('./_supabase');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { table_id, items, total_cents, payment_mode } = JSON.parse(event.body || '{}');

    if (!table_id || !items || !total_cents) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    const { data: existingTable, error: tableError } = await supabase
      .from('restaurant_tables')
      .select('*')
      .eq('id', table_id)
      .single();

    if (tableError && tableError.code !== 'PGRST116') throw tableError;

    if (!existingTable) {
      const { error: insertTableError } = await supabase.from('restaurant_tables').insert({
        id: table_id,
        status: 'open',
        total_cents: 0
      });
      if (insertTableError) throw insertTableError;
    }

    const { data: order, error: orderError } = await supabase
      .from('table_orders')
      .insert({
        table_id,
        items,
        total_cents,
        payment_mode,
        paid: false
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
