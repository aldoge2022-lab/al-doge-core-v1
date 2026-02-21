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

  const session = stripeEvent.data.object;
  const order_id = session.metadata?.order_id;
  if (!order_id) {
    return { statusCode: 200, body: 'Missing order metadata' };
  }

  const { data: order, error: orderError } = await supabase
    .from('table_orders')
    .select('id, table_id, paid')
    .eq('id', order_id)
    .single();
  if (orderError || !order) {
    return { statusCode: 200, body: 'Order not found' };
  }

  if (order.paid === true) {
    return { statusCode: 200, body: 'Already paid' };
  }

  const { error: updateError } = await supabase
    .from('table_orders')
    .update({
      paid: true,
      status: 'paid'
    })
    .eq('id', order.id)
    .eq('paid', false);
  if (updateError) {
    return { statusCode: 500, body: 'Order update failed' };
  }

  const { data: tableOrders, error: tableOrdersError } = await supabase
    .from('table_orders')
    .select('total_cents, paid')
    .eq('table_id', order.table_id);
  if (tableOrdersError) {
    return { statusCode: 500, body: 'Table total recalculation failed' };
  }

  const remainingTotal = (tableOrders || []).reduce((sum, tableOrder) => {
    return tableOrder.paid ? sum : sum + (Number(tableOrder.total_cents) || 0);
  }, 0);

  const { error: tableUpdateError } = await supabase
    .from('restaurant_tables')
    .update({
      total_cents: remainingTotal,
      status: remainingTotal === 0 ? 'closed' : 'open'
    })
    .eq('id', order.table_id);
  if (tableUpdateError) {
    return { statusCode: 500, body: 'Table update failed' };
  }

  return { statusCode: 200, body: 'Success' };
};
