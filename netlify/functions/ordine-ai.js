const Stripe = require("stripe");
const catalog = require("../../data/catalog");
const supabase = require("./_supabase");
const { generatePizza, generatePanino } = require("./ordine-ai/engine");

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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function inferDomain(item) {
  const fullText = [
    item?.name,
    item?.displayName,
    ...(Array.isArray(item?.tag) ? item.tag : [])
  ]
    .map((value) => normalizeText(value))
    .join(" ");

  if (fullText.includes("panino") || fullText.includes("sandwich")) {
    return "panino";
  }

  return "pizza";
}

function intentResolver(message, menuItems) {
  const normalized = normalizeText(message);
  const domain = normalized.includes("panino")
    ? "panino"
    : normalized.includes("pizza")
      ? "pizza"
      : "pizza";
  const withoutMeat = normalized.includes("senza carne");
  const knownIngredients = new Set(
    menuItems
      .flatMap((item) => (Array.isArray(item?.ingredienti) ? item.ingredienti : []))
      .map((ingredient) => normalizeText(ingredient))
      .filter(Boolean)
  );
  const requiredIngredients = [];

  knownIngredients.forEach((ingredient) => {
    if (normalized.includes(ingredient)) {
      requiredIngredients.push(ingredient);
      return;
    }

    if (ingredient.includes("bufala") && normalized.includes("bufala")) {
      requiredIngredients.push(ingredient);
    }
  });

  if (normalized.includes("bufala") && !requiredIngredients.some((ingredient) => ingredient.includes("bufala"))) {
    requiredIngredients.push("bufala");
  }

  return {
    domain,
    withoutMeat,
    requiredIngredients: [...new Set(requiredIngredients)],
    hasExplicitIngredient: normalized.includes(" con ") || requiredIngredients.length > 0
  };
}

function candidateHasMeat(item) {
  const meatTokens = ["salame", "prosciutto", "salsiccia", "pollo", "manzo", "bacon", "speck", "carne"];
  const ingredienti = Array.isArray(item?.ingredienti) ? item.ingredienti.map((ingredient) => normalizeText(ingredient)) : [];
  return ingredienti.some((ingredient) => meatTokens.some((token) => ingredient.includes(token)));
}

function scoreCandidate(item, intent) {
  const lowerTags = Array.isArray(item?.tag) ? item.tag.map((tag) => normalizeText(tag)) : [];
  const lowerIngredients = Array.isArray(item?.ingredienti) ? item.ingredienti.map((ingredient) => normalizeText(ingredient)) : [];
  let score = 0;

  if (intent.withoutMeat && !candidateHasMeat(item)) {
    score += 3;
  }

  for (const requested of intent.requiredIngredients) {
    const matches = lowerIngredients.some((ingredient) => ingredient.includes(requested) || requested.includes(ingredient));
    if (matches) {
      score += 4;
    }
  }

  if (lowerTags.some((tag) => tag.includes("vegetar")) && intent.withoutMeat) {
    score += 2;
  }

  return score + (item.ingredienti.length * 0.05);
}

function scoringEngine(message, menuItems) {
  if (!menuItems.length) {
    return {
      type: "empty",
      message: "Posso consigliarti una delle nostre pizze più apprezzate. Cosa preferisci?"
    };
  }

  const intent = intentResolver(message, menuItems);
  const domainCandidates = menuItems.filter((item) => inferDomain(item) === intent.domain);

  if (!domainCandidates.length) {
    if (intent.domain === "panino") {
      return {
        type: "no_match",
        ok: true,
        message: "Non ho panini con bufala. Vuoi crearne uno personalizzato?"
      };
    }
    return {
      type: "empty",
      message: "Posso consigliarti una delle nostre pizze più apprezzate. Cosa preferisci?"
    };
  }

  const filteredByExclusions = intent.withoutMeat
    ? domainCandidates.filter((item) => !candidateHasMeat(item))
    : domainCandidates;

  const constrainedCandidates = intent.requiredIngredients.length
    ? filteredByExclusions.filter((item) => {
      const ingredients = Array.isArray(item?.ingredienti) ? item.ingredienti.map((ingredient) => normalizeText(ingredient)) : [];
      return intent.requiredIngredients.every((required) =>
        ingredients.some((ingredient) => ingredient.includes(required) || required.includes(ingredient))
      );
    })
    : filteredByExclusions;

  if (intent.hasExplicitIngredient && intent.requiredIngredients.length > 0 && constrainedCandidates.length === 0) {
    return {
      type: "no_match",
      ok: true,
      message: "Non ho panini con bufala. Vuoi crearne uno personalizzato?"
    };
  }

  const pool = constrainedCandidates.length ? constrainedCandidates : filteredByExclusions;
  if (!pool.length) {
    return {
      type: "no_match",
      ok: true,
      message: "Non ho panini con bufala. Vuoi crearne uno personalizzato?"
    };
  }

  const scored = pool
    .map((item) => ({
      item,
      score: scoreCandidate(item, intent)
    }))
    .sort((a, b) => b.score - a.score || a.item.price - b.item.price);

  return {
    type: "pick",
    item: scored[0].item
  };
}

function buildSuggestionReply(message, menuItems) {
  const scored = scoringEngine(message, menuItems);
  if (scored.type === "empty") {
    return { reply: scored.message };
  }
  if (scored.type === "no_match") {
    return {
      ok: true,
      type: "no_match",
      message: scored.message,
      reply: scored.message
    };
  }

  const pick = scored.item;
  const ingredienti = pick.ingredienti.length ? ` Ingredienti: ${pick.ingredienti.join(", ")}.` : "";
  const varianti = Object.keys(pick.varianti).length ? ` Varianti: ${Object.keys(pick.varianti).join(", ")}.` : "";
  return {
    reply: `Ti consiglio ${pick.displayName} (€${pick.price}).${ingredienti}${varianti}`.trim()
  };
}

function pizzaUnitAmount(item, pizzasById) {
  const pizza = pizzasById.get(item.id);
  if (!pizza) return null;
  const dough = catalog.doughs[item.dough] || catalog.doughs.normale;
  const extras = Array.isArray(item.extras) ? item.extras : [];
  const extrasTotal = extras.reduce((sum, extraId) => {
    const fromListById = Array.isArray(catalog.extras)
      ? catalog.extras.find((extra) => extra && extra.id === extraId)
      : null;
    const fromListByName = !fromListById && Array.isArray(catalog.extras)
      ? catalog.extras.find((extra) => extra && extra.name === extraId)
      : null;
    const fromMap = !Array.isArray(catalog.extras) && catalog.extras ? catalog.extras[extraId] : null;
    const extra = fromListById || fromListByName || fromMap;
    const cents = Number(extra?.price_cents ?? extra?.price);
    return sum + (Number.isFinite(cents) ? cents : 0);
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
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  if (!process.env.SITE_URL) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "SITE_URL non configurato" })
    };
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "STRIPE_SECRET_KEY non configurata" })
    };
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const body = JSON.parse(event.body || "{}");
    const rawItems = Array.isArray(body.items) ? body.items : null;

    if (rawItems && rawItems.length) {
      if (rawItems.length > MAX_CHECKOUT_ITEMS) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid input" })
        };
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
            return {
              statusCode: 400,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "Invalid input" })
            };
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
          return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Invalid input" })
          };
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
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid input" })
      };
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
    const includesCustomIntent = ["personal", "invent", "inventa", "crea"].some((word) => lowerMessage.includes(word));

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
      body: JSON.stringify(buildSuggestionReply(message, dynamicMenuItems))
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

exports.intentResolver = intentResolver;
exports.scoringEngine = scoringEngine;
