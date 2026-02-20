const Stripe = require("stripe");

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
    const orderValue = session.amount_total / 100;
    const email = session.customer_details?.email || "Non fornita";

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
