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

    // 1️⃣ Recupera menu dal database
const { data: pizzas, error } = await supabase
  .from("menu_items")
  .select("*");

if (error) {
  return {
    statusCode: 500,
    body: JSON.stringify({
      error: error.message,
      details: error
    })
  };
}

    if (error || !pizzas) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Errore lettura menu" })
      };
    }

    // 2️⃣ Estrai ingredienti richiesti dall’utente con OpenAI
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

    let requested = [];

    try {
      requested = JSON.parse(ai.choices[0].message.content).ingredients || [];
    } catch {
      requested = [];
    }

    requested = requested.map(i => i.toLowerCase());

    // 3️⃣ Scoring deterministico
    let bestPizza = null;
    let bestScore = -1;

    for (const pizza of pizzas) {
      const ingredients = (pizza.ingredienti || []).map(i =>
        String(i).toLowerCase()
      );

      let score = 0;

      for (const r of requested) {
        if (ingredients.includes(r)) score += 3;
      }

      // bonus varietà
      score += ingredients.length * 0.05;

      if (score > bestScore) {
        bestScore = score;
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

    // 4️⃣ Risposta finale pulita
    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: `Ti consiglio la ${bestPizza.Nome} a €${bestPizza.Prezzo}.`,
        pizza: {
          id: bestPizza.id,
          nome: bestPizza.Nome,
          prezzo: bestPizza.Prezzo
        }
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Errore interno", details: err.message })
    };
  }
};
