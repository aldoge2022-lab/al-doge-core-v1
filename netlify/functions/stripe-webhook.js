const Stripe = require('stripe');
const supabase = require('./_supabase');


exports.handler = async function (event) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'STRIPE_SECRET_KEY non configurata' }) };
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'STRIPE_WEBHOOK_SECRET non configurata' }) };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Errore firma Stripe:', err.message);
    return { statusCode: 400, body: JSON.stringify({ error: `Webhook Error: ${err.message}` }) };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ message: 'Ignored' }) };
  }

  try {
    const session = stripeEvent.data.object || {};
    const session_id = typeof session.metadata?.session_id === 'string' ? session.metadata.session_id.trim() : '';
    const amount_cents = Number(session.metadata?.amount_cents);
    const payment_intent = session.payment_intent;
    const MAX_INT32 = 2147483647;

    if (!session_id || !Number.isSafeInteger(amount_cents) || amount_cents <= 0 || amount_cents > MAX_INT32 || !payment_intent) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Invalid metadata' }) };
    }

    const { error: paymentError } = await supabase
      .from('stripe_payments')
      .insert({
        payment_intent: String(payment_intent),
        session_id,
        amount_cents
      });
    if (paymentError) {
      if (paymentError.code === '23505') {
        return { statusCode: 200, body: JSON.stringify({ message: 'Already processed' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ message: 'Payment insert failed' }) };
    }

    const incrementValue = typeof supabase.raw === 'function'
      ? supabase.raw(`paid_cents + ${amount_cents}`)
      : `paid_cents + ${amount_cents}`;

    const { data, error } = await supabase
      .from('table_sessions')
      .update({
        paid_cents: incrementValue
      })
      .eq('id', session_id)
      .eq('status', 'open')
      .lt('paid_cents', 'total_cents')
      .select()
      .single();
    if (error || !data) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Session not updated' }) };
    }

    if (Number(data.paid_cents) >= Number(data.total_cents)) {
      await supabase
        .from('table_sessions')
        .update({ status: 'closed' })
        .eq('id', session_id)
        .eq('status', 'open');
    }
  } catch (err) {
    console.error('Errore stripe-webhook:', err.message);
  }

  return { statusCode: 200, body: JSON.stringify({ message: 'Success' }) };
};
