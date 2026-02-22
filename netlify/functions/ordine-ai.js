const Stripe = require("stripe");
const catalog = require("../../data/catalog");
const supabase = require("./_supabase");
const { generatePizza, generatePanino } = require("./ordine-ai/engine");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY non configurata");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const MAX_INPUT_LENGTH = 500;
const MAX_CHECKOUT_ITEMS = 30;
const MAX_ITEM_QUANTITY = 20;
const MAX_PRODUCT_NAME_LENGTH = 120;
const MIN_PAYMENT_CENTS = 1;

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

function normalizeMenuItem(rawItem) {
  if (!rawItem || typeof rawItem !== "object") return null;
  const nome = String(rawItem.nome || "").trim();
  const prezzo = Number(rawItem.promozioni?.prezzo_scontato ?? rawItem.prezzo);
  if (!nome || !Number.isFinite(prezzo) || prezzo <= 0) return null;
  return {
    name: nome.toLowerCase(),
    displayName: nome,
    price: Number(prezzo.toFixed(2)),
    ingredienti: Array.isArray(rawItem.ingredienti) ? rawItem.ingredienti : [],
    tag: Array.isArray(rawItem.tag) ? rawItem.tag : [],
    varianti: rawItem.varianti && typeof rawItem.varianti === "object" ? rawItem.varianti : {}
  };
}

async function loadMenuItems() {
  try {
    const { data, error } = await supabase
      .from("menu_items")
      .select("nome, prezzo, ingredienti, tag, varianti, promozioni")
      .eq("disponibile", true);
    if (error || !Array.isArray(data)) return [];
    return data.map(normalizeMenuItem).filter(Boolean);
  } catch {
    return [];
  }
}

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

function extractItems(text, menuItemsByName) {
  const lower = text.toLowerCase();
  const found = [];
  const entries = menuItemsByName
    ? Array.from(menuItemsByName.entries())
    : Object.entries(MENU).map(([name, price]) => [name, { displayName: name, price }]);

  for (const [name, menuItem] of entries) {
    if (lower.includes(name)) {
      const escapedItem = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(\\d+)\\s*(x)?\\s*${escapedItem}`);
      const match = lower.match(regex);
      const qty = match ? parseInt(match[1], 10) : 1;

      found.push({
        name: menuItem.displayName,
        qty,
        price: menuItem.price
      });
    }
  }

  return found;
}

function buildSuggestionReply(message, menuItems) {
  if (!menuItems.length) {
    return "Posso consigliarti una delle nostre pizze più apprezzate. Cosa preferisci?";
  }
  const lower = message.toLowerCase();
  let pick = menuItems[0];
  if (lower.includes("vegetar")) {
    pick = menuItems.find((item) => item.tag.some((tag) => String(tag).toLowerCase().includes("vegetar"))) || pick;
  } else if (lower.includes("piccant") || lower.includes("forte")) {
    pick = menuItems.find((item) => item.tag.some((tag) => ["forte", "piccante"].includes(String(tag).toLowerCase()))) || pick;
  }
  const ingredienti = pick.ingredienti.length ? ` Ingredienti: ${pick.ingredienti.join(", ")}.` : "";
  const varianti = Object.keys(pick.varianti).length ? ` Varianti: ${Object.keys(pick.varianti).join(", ")}.` : "";
  return `Ti consiglio ${pick.displayName} (€${pick.price}).${ingredienti}${varianti}`.trim();
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

      const pizzasById = new Map((catalog.menu || []).filter((p) => p.active).map((p) => [p.id, p]));
      const drinksById = new Map((catalog.drinks || []).filter((d) => d.active).map((d) => [d.id, d]));
      const line_items = [];
      for (const item of normalizedCart) {
        if (item.type === "pizza") {
          const unitAmount = pizzaUnitAmount(item, pizzasById);
          if (unitAmount === null || unitAmount < MIN_PAYMENT_CENTS) {
            return { statusCode: 400, body: "Invalid input" };
          }
          const pizza = pizzasById.get(item.id);
          line_items.push({
            price_data: {
              currency: "eur",
              product_data: { name: String(pizza.name).slice(0, MAX_PRODUCT_NAME_LENGTH) },
              unit_amount: unitAmount
            },
            quantity: item.quantity
          });
          continue;
        }
        const drink = drinksById.get(item.id);
        if (!drink) {
          return { statusCode: 400, body: "Invalid input" };
        }
        line_items.push({
          price_data: {
            currency: "eur",
            product_data: { name: String(drink.name).slice(0, MAX_PRODUCT_NAME_LENGTH) },
            unit_amount: drink.price_cents
          },
          quantity: item.quantity
        });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items,
        mode: "payment",
        success_url: `${process.env.SITE_URL}/success.html`,
        cancel_url: `${process.env.SITE_URL}/cancel.html`
      });

      return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
    }

    const message = (body.message || "").trim();
    const dynamicMenuItems = await loadMenuItems();
    const dynamicMenuByName = new Map(dynamicMenuItems.map((item) => [item.name, item]));

    if (!message || message.length > MAX_INPUT_LENGTH) {
      return { statusCode: 400, body: "Invalid input" };
    }

    const hasPhone = containsPhone(message);
    const hasIntent = containsOrderIntent(message);

    if (hasPhone && hasIntent) {
      const items = extractItems(message, dynamicMenuByName.size ? dynamicMenuByName : null);
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
          unit_amount: Math.round(item.price * 100)
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

    const lowerMessage = message.toLowerCase();
    const includesCustomIntent = ["personal", "invent", "crea"].some((word) => lowerMessage.includes(word));

    if (lowerMessage.includes("pizza") && includesCustomIntent) {
      const custom = generatePizza({ richiesta: message, menu: dynamicMenuItems });
      return {
        statusCode: 200,
        body: JSON.stringify({
          reply: `Ecco la tua pizza personalizzata: ${custom.nome} — Ingredienti: ${custom.ingredienti.join(", ")} — Prezzo: €${custom.prezzo}`
        })
      };
    }

    if (lowerMessage.includes("panino") && includesCustomIntent) {
      const custom = generatePanino({ richiesta: message, menu: dynamicMenuItems });
      return {
        statusCode: 200,
        body: JSON.stringify({
          reply: `Ecco il tuo panino personalizzato: ${custom.nome} — Ingredienti: ${custom.ingredienti.join(", ")} — Prezzo: €${custom.prezzo}`
        })
      };
    }

    if (lowerMessage.includes("pizza") && (lowerMessage.includes("forte") || lowerMessage.includes("piccante"))) {
      const custom = generatePizza({ richiesta: message, menu: dynamicMenuItems });
      return {
        statusCode: 200,
        body: JSON.stringify({
          reply: `Pizza forte in arrivo: ${custom.nome} — Ingredienti: ${custom.ingredienti.join(", ")} — Prezzo: €${custom.prezzo}`
        })
      };
    }

    if (lowerMessage.includes("pizza") && lowerMessage.includes("leggera")) {
      const custom = generatePizza({ richiesta: message, menu: dynamicMenuItems });
      return {
        statusCode: 200,
        body: JSON.stringify({
          reply: `Pizza leggera creata per te: ${custom.nome} — Ingredienti: ${custom.ingredienti.join(", ")} — Prezzo: €${custom.prezzo}`
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: buildSuggestionReply(message, dynamicMenuItems)
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
