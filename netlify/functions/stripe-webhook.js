const Stripe = require("stripe");
const supabase = require("./_supabase");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY non configurata");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async function (event) {
  const sig = event.headers["stripe-signature"];

  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Errore firma Stripe:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    if (session.amount_total === null || session.amount_total === undefined) {
      console.error("amount_total mancante nella sessione Stripe:", session.id);
    }
    const total_cents = Number(session.amount_total) || 0;
    const orderValue = total_cents / 100;
    const email = session.customer_details?.email || "Non fornita";
    const order_id = session.metadata?.order_id;

    if (order_id && total_cents > 0) {
      const { error: orderError } = await supabase
        .from("orders")
        .update({
          status: "paid",
          paid_cents: total_cents
        })
        .eq("id", order_id);

      if (orderError) {
        console.error("Errore aggiornamento ordine:", orderError.message);
      } else {
        const { error: paymentError } = await supabase.from("payments").insert([
          {
            order_id,
            amount_cents: total_cents,
            payment_mode: "full",
            stripe_session_id: session.id
          }
        ]);
        if (paymentError) {
          console.error("Errore inserimento pagamento:", paymentError.message);
        }
      }
    }

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const telegramResponse = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: `
✅ ORDINE PAGATO – AL DOGE

💰 Totale: €${orderValue}
📧 Email: ${email}
🕒 ${new Date().toLocaleString("it-IT")}

🍕 Iniziare preparazione.
`
          })
        });

        if (!telegramResponse.ok) {
          console.error("Errore invio Telegram:", telegramResponse.status);
        }
      } catch (err) {
        console.error("Errore invio Telegram:", err.message);
      }
    }
  }

  return { statusCode: 200, body: "Success" };
};
