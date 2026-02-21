const Stripe = require('stripe');
const supabase = require('./_supabase');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY non configurata');
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const MIN_PAYMENT_CENTS = 1;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.SITE_URL) {
    return { statusCode: 500, body: 'SITE_URL non configurato' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const order_id = body.order_id;
    if (!order_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid input' }) };
    }

    const { data: order, error: orderError } = await supabase
      .from('table_orders')
      .select('id, table_id, total_cents, paid, status, stripe_session_id')
      .eq('id', order_id)
      .single();
    if (orderError || !order) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Order not found' }) };
    }

    if (order.paid || order.status !== 'pending') {
      return { statusCode: 409, body: JSON.stringify({ error: 'Order already processed' }) };
    }
    if (order.stripe_session_id) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Checkout already created' }) };
    }

    const amount = Number(order.total_cents);
    if (!Number.isInteger(amount) || amount < MIN_PAYMENT_CENTS) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Order total invalid' }) };
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Conto tavolo ${order.table_id}` },
          unit_amount: amount
        },
        quantity: 1
      }],
      mode: 'payment',
      metadata: {
        order_id: String(order.id),
        table_id: String(order.table_id)
      },
      success_url: `${process.env.SITE_URL}/success.html`,
      cancel_url: `${process.env.SITE_URL}/cancel.html`
    });

    const { data: updatedOrder, error: updateError } = await supabase
      .from('table_orders')
      .update({ stripe_session_id: session.id })
      .eq('id', order.id)
      .eq('paid', false)
      .eq('status', 'pending')
      .is('stripe_session_id', null)
      .select('id')
      .single();

    if (updateError || !updatedOrder) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Checkout already created' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Errore tecnico temporaneo.' }) };
  }
};
