const Stripe = require("stripe");
const catalog = require("../../data/catalog");
const { handler: createCheckoutHandler } = require("./create-checkout");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY non configurata");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const MAX_INPUT_LENGTH = 500;
const MAX_CHECKOUT_ITEMS = 30;
const MAX_ITEM_QUANTITY = 20;
const MAX_PRODUCT_NAME_LENGTH = 120;

const MENU = {
  "margherita": 6,
  "diavola": 7,
  "capricciosa": 8,
  "quattro stagioni": 8,
  "quattro formaggi": 8,
  "prosciutto": 7,
  "tonno": 7,
  "vegetariana": 7,
  "bufala": 9,
  "boscaiola": 8
};

function containsPhone(text) {
  return /(\+39)?[\s-]?\d{2,4}[\s-]?\d{6,8}/.test(text);
}

function containsOrderIntent(text) {
  const triggers = [
    "ordino", "ordine", "prenoto", "stasera",
    "subito", "asporto", "consegna", "ritiro", "preparami"
  ];
  const lower = text.toLowerCase();
  return triggers.some((word) => lower.includes(word));
}

function detectUrgency(text) {
  return ["subito", "adesso", "prima possibile"]
    .some((word) => text.toLowerCase().includes(word));
}

function extractItems(text) {
  const lower = text.toLowerCase();
  const found = [];

  for (const item of Object.keys(MENU)) {
    if (lower.includes(item)) {
      const escapedItem = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(\\d+)\\s*(x)?\\s*${escapedItem}`);
      const match = lower.match(regex);
      const qty = match ? parseInt(match[1], 10) : 1;

      found.push({
        name: item,
        qty,
        price: MENU[item]
      });
    }
  }

  return found;
}

async function sendTelegramNotification(message) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message
      })
    });

    if (!response.ok) {
      console.error("Errore invio Telegram:", response.status);
    }
  } catch (error) {
    console.error("Errore invio Telegram:", error.message);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  if (!process.env.SITE_URL) {
    return { statusCode: 500, body: "SITE_URL non configurato" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const rawItems = Array.isArray(body.items) ? body.items : null;

    if (rawItems && rawItems.length) {
      if (rawItems.length > MAX_CHECKOUT_ITEMS) {
        return { statusCode: 400, body: "Invalid input" };
      }

      const drinkIds = new Set((catalog.drinks || []).map((drink) => drink.id));
      const normalizedCart = rawItems.map((item) => {
        const quantity = Math.max(1, Math.min(MAX_ITEM_QUANTITY, Number(item?.quantity) || 1));
        const type = item?.type || (drinkIds.has(item?.id) ? "drink" : "pizza");
        if (type === "drink") {
          return {
            type,
            id: String(item?.id || ""),
            quantity
          };
        }

        return {
          type: "pizza",
          id: String(item?.id || ""),
          dough: String(item?.dough || catalog.size_engine.default),
          extras: Array.isArray(item?.extras) ? item.extras : [],
          quantity
        };
      });

      return createCheckoutHandler({
        httpMethod: "POST",
        body: JSON.stringify({ cart: normalizedCart })
      });
    }

    const message = (body.message || "").trim();

    if (!message || message.length > MAX_INPUT_LENGTH) {
      return { statusCode: 400, body: "Invalid input" };
    }

    const hasPhone = containsPhone(message);
    const hasIntent = containsOrderIntent(message);

    if (hasPhone && hasIntent) {
      const items = extractItems(message);
      const urgent = detectUrgency(message);

      if (!items.length) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            reply: "Non ho rilevato correttamente le pizze. Puoi specificare meglio l’ordine?"
          })
        };
      }

      const line_items = items.map((item) => ({
        price_data: {
          currency: "eur",
          product_data: { name: item.name },
          unit_amount: item.price * 100
        },
        quantity: item.qty
      }));

      const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items,
        mode: "payment",
        success_url: `${process.env.SITE_URL}/success.html`,
        cancel_url: `${process.env.SITE_URL}/cancel.html`
      });

      const priorityLabel = urgent
        ? "🚨 PRIORITÀ ALTA – URGENTE"
        : "🟢 PRIORITÀ NORMALE";

      await sendTelegramNotification(`
${priorityLabel}

🍕 NUOVO ORDINE AI – AL DOGE

📝 ${message}

💰 Totale stimato: €${total}
🔗 Pagamento: ${session.url}

🕒 ${new Date().toLocaleString("it-IT")}
`);

      return {
        statusCode: 200,
        body: JSON.stringify({
          reply: `Perfetto. Totale ordine: €${total}.

Puoi completare il pagamento sicuro qui:
${session.url}

Appena confermato, iniziamo la preparazione.`
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: "Posso consigliarti una delle nostre pizze più apprezzate. Cosa preferisci?"
      })
    };
  } catch (error) {
    console.error("Errore ordine AI:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        reply: "Errore tecnico temporaneo. Riprova tra qualche minuto."
      })
    };
  }
};
