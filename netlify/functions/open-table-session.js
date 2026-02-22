const supabase = require('./_supabase');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const table_id = Number(body.table_id);

    if (!Number.isInteger(table_id) || table_id <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid table_id' }) };
    }

    await supabase
      .from('table_sessions')
      .update({ status: 'closed' })
      .eq('table_id', table_id)
      .eq('status', 'open');

    const { data, error } = await supabase
      .from('table_sessions')
      .insert({
        table_id,
        total_cents: 0,
        paid_cents: 0,
        status: 'open'
      })
      .select()
      .single();

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Database error' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, session_id: data.id })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal error' })
    };
  }
};
