const Stripe = require('stripe');
const supabase = require('./_supabase');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY non configurata');
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.SITE_URL) {
    return { statusCode: 500, body: 'SITE_URL non configurato' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const session_id = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    const mode = body.mode;

    if (!UUID_V4_REGEX.test(session_id) || (mode !== 'full' && mode !== 'split')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid input' }) };
    }

    const { data: tableSession, error: sessionError } = await supabase
      .from('table_sessions')
      .select('id, table_id, total_cents, paid_cents, status')
      .eq('id', session_id)
      .single();
    if (sessionError || !tableSession) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
    }

    const totalCents = Number(tableSession.total_cents);
    const paidCents = Number(tableSession.paid_cents || 0);
    const residuo = totalCents - paidCents;

    if (tableSession.status !== 'open') {
      return { statusCode: 409, body: JSON.stringify({ error: 'Session not open' }) };
    }
    if (!Number.isInteger(totalCents) || !Number.isInteger(paidCents) || paidCents >= totalCents || residuo <= 0) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Nothing left to pay' }) };
    }

    let amount = residuo;
    let splitCountForMetadata;
    if (mode === 'split') {
      const splitCount = body.split_count;
      if (!Number.isInteger(splitCount) || splitCount < 2 || splitCount > 20) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid split_count' }) };
      }
      splitCountForMetadata = splitCount;
      amount = Math.floor(residuo / splitCount);
      if (amount <= 0) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid split amount' }) };
      }
    }

    if (amount > residuo) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Conto tavolo ${tableSession.table_id}` },
          unit_amount: amount
        },
        quantity: 1
      }],
      mode: 'payment',
      metadata: {
        session_id: String(tableSession.id),
        mode: String(mode),
        ...(splitCountForMetadata ? { split_count: String(splitCountForMetadata) } : {})
      },
      success_url: `${process.env.SITE_URL}/success.html`,
      cancel_url: `${process.env.SITE_URL}/cancel.html`
    });
    return { statusCode: 200, body: JSON.stringify({ checkout_url: session.url, amount, residuo_attuale: residuo }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Errore tecnico temporaneo.' }) };
  }
};
