import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    const { message } = JSON.parse(event.body || "{}");

    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing message" })
      };
    }

    // 1️⃣ Recupero menu dal database
    const { data: pizze, error } = await supabase
      .from("menu_items")
      .select("*");

    if (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: error.message
        })
      };
    }

    if (!pizze || pizze.length === 0) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Menu vuoto o non trovato"
        })
      };
    }

    // 2️⃣ Estrai ingredienti richiesti con OpenAI
    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
Estrai solo gli ingredienti richiesti dall'utente.
Rispondi SOLO in JSON:
{ "ingredients": ["ingrediente1","ingrediente2"] }
`
        },
        { role: "user", content: message }
      ]
    });

    let richiesto = [];

    try {
      richiesto = JSON.parse(ai.choices[0].message.content).ingredients || [];
    } catch {
      richiesto = [];
    }

    richiesto = richiesto.map(i => String(i).toLowerCase());

    // 3️⃣ Scoring deterministico
    let bestPizza = null;
    let bestScore = -1;

    for (const pizza of pizze) {
      const ingredienti = (pizza.ingredienti || []).map(i =>
        String(i).toLowerCase()
      );

      let punteggio = 0;

      for (const r of richiesto) {
        if (ingredienti.includes(r)) punteggio += 3;
      }

      punteggio += ingredienti.length * 0.05;

      if (punteggio > bestScore) {
        bestScore = punteggio;
        bestPizza = pizza;
      }
    }

    if (!bestPizza) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          reply: "Ti consiglio una delle nostre pizze classiche come la Margherita.",
          pizza: null
        })
      };
    }

    // 🔎 Supporto sia camelCase che uppercase colonne
    const nome =
      bestPizza.nome ||
      bestPizza.Nome ||
      bestPizza.name ||
      "Pizza";

    const prezzo =
      bestPizza.prezzo ||
      bestPizza.Prezzo ||
      bestPizza.price ||
      0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: `Ti consiglio la ${nome} a €${prezzo}.`,
        pizza: {
          id: bestPizza.id,
          nome,
          prezzo
        }
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Errore interno",
        details: err.message
      })
    };
  }
};
