const supabase = require('./_supabase');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { data, error } = await supabase
      .from('table_sessions')
      .select('id, table_id, total_cents, paid_cents, status')
      .order('table_id', { ascending: true });

    if (error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Database error' })
      };
    }

    const result = data.map((row) => ({
      id: row.id,
      table_id: row.table_id,
      total_cents: row.total_cents,
      paid_cents: row.paid_cents,
      residual_cents: Math.max(0, row.total_cents - row.paid_cents),
      status: row.status
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal error' })
    };
  }
};
