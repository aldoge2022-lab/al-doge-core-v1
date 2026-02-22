const Stripe = require('stripe');
const supabase = require('./_supabase');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY non configurata');
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async function (event) {
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
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored' };
  }

  try {
    const session = stripeEvent.data.object || {};
    const session_id = session.metadata?.session_id;
    const amount_cents = Number(session.metadata?.amount_cents);
    const payment_intent = session.payment_intent;

    if (!session_id || !Number.isInteger(amount_cents) || amount_cents <= 0 || !payment_intent) {
      return { statusCode: 200, body: 'Invalid metadata' };
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
        return { statusCode: 200, body: 'Already processed' };
      }
      return { statusCode: 200, body: 'Payment insert failed' };
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
      return { statusCode: 200, body: 'Session not updated' };
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

  return { statusCode: 200, body: 'Success' };
};
