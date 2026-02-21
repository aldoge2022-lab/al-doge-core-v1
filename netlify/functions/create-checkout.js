const Stripe = require('stripe');
const catalog = require('../../data/catalog');
const supabase = require('./_supabase');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY non configurata');
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const MAX_ITEMS = 30;
const MAX_QTY = 20;
const MAX_SPLIT_PERSONS = 50;
const MIN_PAYMENT_CENTS = 1;

function invalid() {
  return { statusCode: 400, body: 'Invalid input' };
}

function toQty(value) {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return null;
  return qty;
}

function normalizeTableNumber(value) {
  const tableNumber = String(value || '').trim();
  if (!tableNumber) return null;
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(tableNumber)) return null;
  return tableNumber;
}

function pizzaUnitAmount(item, pizzasById) {
  const pizza = pizzasById.get(item.id);
  if (!pizza) return null;
  const dough = catalog.doughs[item.dough] || catalog.doughs.normale;
  const extras = Array.isArray(item.extras) ? item.extras : [];
  const extrasTotal = extras.reduce((sum, extraId) => {
    const extra = catalog.extras[extraId];
    return sum + (extra ? extra.price_cents : 0);
  }, 0);
  return pizza.base_price_cents + dough.surcharge_cents + extrasTotal;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.SITE_URL) {
    return { statusCode: 500, body: 'SITE_URL non configurato' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const table_number = normalizeTableNumber(body.table_number || event.queryStringParameters?.table_number);
    const split_mode = body.split_mode === true;
    const split_persons = Number(body.split_persons);
    const amount_override_cents = body.amount_override_cents === undefined ? null : Number(body.amount_override_cents);
    const cart = Array.isArray(body.cart) ? body.cart : null;
    if (!cart || !cart.length || cart.length > MAX_ITEMS) return invalid();

    const pizzasById = new Map((catalog.menu || []).filter((p) => p.active).map((p) => [p.id, p]));
    const drinksById = new Map((catalog.drinks || []).filter((d) => d.active).map((d) => [d.id, d]));
    const line_items = [];
    const orderItems = [];

    for (const rawItem of cart) {
      if (!rawItem || typeof rawItem !== 'object') return invalid();
      const quantity = toQty(rawItem.quantity);
      if (!quantity) return invalid();

      if (rawItem.type === 'pizza') {
        if (!rawItem.id || !rawItem.dough) return invalid();
        const unitAmount = pizzaUnitAmount(rawItem, pizzasById);
        if (!unitAmount || unitAmount <= 0) return invalid();
        const pizza = pizzasById.get(rawItem.id);
        line_items.push({
          price_data: {
            currency: 'eur',
            product_data: { name: pizza.name },
            unit_amount: unitAmount
          },
          quantity
        });
        orderItems.push({
          product_type: rawItem.type,
          product_id: rawItem.id,
          quantity,
          paid_quantity: 0
        });
        continue;
      }

      if (rawItem.type === 'drink') {
        const drink = drinksById.get(rawItem.id);
        if (!drink) return invalid();
        line_items.push({
          price_data: {
            currency: 'eur',
            product_data: { name: drink.name },
            unit_amount: drink.price_cents
          },
          quantity
        });
        orderItems.push({
          product_type: rawItem.type,
          product_id: rawItem.id,
          quantity,
          paid_quantity: 0
        });
        continue;
      }

      return invalid();
    }

    if (body.service === 'sala') {
      const people = toQty(body.people || cart.reduce((sum, it) => sum + toQty(it.quantity), 0) || 1);
      if (!people) return invalid();
      line_items.push({
        price_data: {
          currency: 'eur',
          product_data: { name: 'Coperto' },
          unit_amount: Number(catalog.cover_charge_cents) || 0
        },
        quantity: people
      });
    }

    if (!line_items.length) return invalid();
    const total_cents = line_items.reduce((sum, item) => sum + (item.price_data.unit_amount * item.quantity), 0);
    if (total_cents < MIN_PAYMENT_CENTS) return invalid();
    if (amount_override_cents !== null && (!Number.isInteger(amount_override_cents) || amount_override_cents < MIN_PAYMENT_CENTS)) return invalid();
    if (amount_override_cents !== null && !split_mode) return invalid();
    if (split_mode && (!Number.isInteger(split_persons) || split_persons < 1 || split_persons > MAX_SPLIT_PERSONS)) return invalid();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([
        {
          type: table_number ? 'table' : 'takeaway',
          table_number,
          total_cents,
          paid_cents: 0,
          status: 'open'
        }
      ])
      .select()
      .single();
    if (orderError || !order) {
      console.error('Errore creazione ordine:', orderError?.message || 'ORDER_NOT_CREATED');
      return { statusCode: 500, body: JSON.stringify({ error: 'Errore tecnico temporaneo.' }) };
    }

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems.map((item) => ({ ...item, order_id: order.id })));
    if (itemsError) {
      console.error('Errore creazione righe ordine:', itemsError.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Errore tecnico temporaneo.' }) };
    }

    const charge_cents = amount_override_cents !== null ? amount_override_cents : total_cents;
    const order_total_cents = Number(order.total_cents);
    const order_paid_cents = Number(order.paid_cents) || 0;
    if (!Number.isInteger(order_total_cents) || order_total_cents < MIN_PAYMENT_CENTS) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Errore tecnico temporaneo.' }) };
    }
    if (order_paid_cents + charge_cents > order_total_cents) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Importo superiore al totale residuo.' }) };
    }

    const stripeLineItems = amount_override_cents !== null
      ? [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'Quota conto tavolo' },
          unit_amount: charge_cents
        },
        quantity: 1
      }]
      : line_items;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: stripeLineItems,
      mode: 'payment',
      metadata: {
        order_id: String(order.id),
        ...(split_mode ? { payment_mode: 'split', split_persons: String(split_persons) } : {}),
        ...(table_number ? { table_number } : {})
      },
      success_url: `${process.env.SITE_URL}/success.html`,
      cancel_url: `${process.env.SITE_URL}/cancel.html`
    });

    if (split_mode && amount_override_cents !== null) {
      const { error: paymentError } = await supabase.from('payments').insert([{
        order_id: order.id,
        amount_cents: charge_cents,
        payment_mode: 'split',
        stripe_session_id: session.id
      }]);
      if (paymentError) {
        console.error('Errore inserimento pagamento split:', paymentError.message);
        return { statusCode: 500, body: JSON.stringify({ error: 'Errore tecnico temporaneo.' }) };
      }
    }

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Errore tecnico temporaneo.' }) };
  }
};
