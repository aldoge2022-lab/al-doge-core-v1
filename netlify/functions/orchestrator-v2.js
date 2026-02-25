const { createCustomPanino } = require('../../core/menu/panino-engine');
const { validateIngredientIds } = require('../../core/menu/food-engine');

const MAX_TOOL_CALLS = 3;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function tryParseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function parseArgs(args) {
  if (!args) return {};
  if (typeof args === "string") {
    try { return JSON.parse(args); } catch { return {}; }
  }
  return args;
}

async function createOpenAIClient() {
  const OpenAI = require("openai");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function toCartUpdate(toolName, output) {
  if (toolName !== "add_menu_item_to_cart") return null;

  return {
    type: "add",
    menuItemId: String(output.itemId),
    qty: Math.max(1, Number(output.qty) || 1)
  };
}

async function runTool(toolCall, cart) {
  const args = parseArgs(toolCall.arguments);

  if (toolCall.name === "create_custom_panino") {
    const ids = Array.isArray(args.ingredientIds) ? args.ingredientIds : [];
    if (!validateIngredientIds(ids)) {
      throw new Error("Invalid ingredientIds");
    }
    return createCustomPanino({ ingredientIds: ids });
  }

  if (toolCall.name === "add_menu_item_to_cart") {
    return {
      itemId: String(args.itemId),
      qty: Number(args.qty) || 1
    };
  }

  return {};
}

exports.handler = async (event) => {

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Metodo non consentito" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(500, { error: "OPENAI_API_KEY non configurata" });
  }

  const body = tryParseJson(event.body);
  const prompt = body.prompt || "";
  const cart = Array.isArray(body.cart) ? body.cart : [];

  if (!prompt) {
    return jsonResponse(400, { error: "Prompt mancante" });
  }

  try {

    const client = await createOpenAIClient();

    const tools = [
      {
        type: "function",
        name: "create_custom_panino",
        description: "Crea panino custom con ingredientIds validi",
        parameters: {
          type: "object",
          properties: {
            ingredientIds: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["ingredientIds"]
        }
      },
      {
        type: "function",
        name: "add_menu_item_to_cart",
        description: "Aggiunge item al carrello",
        parameters: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            qty: { type: "number" }
          },
          required: ["itemId"]
        }
      }
    ];

    let response = await client.responses.create({
      model: "gpt-4o-mini-2024-07-18",
      input: [
        { role: "system", content: "Usa solo ID reali del menu." },
        { role: "user", content: prompt }
      ],
      tools
    });

    const cartUpdates = [];
    const toolsCalled = [];
    let assistantMessage = null;

    for (let i = 0; i < MAX_TOOL_CALLS; i++) {

      const outputs = Array.isArray(response.output) ? response.output : [];
      const toolCall = outputs.find(o => o.type === "tool_call");
      const message = outputs.find(o => o.type === "message");

      if (toolCall) {

        const result = await runTool(toolCall, cart);

        toolsCalled.push(toolCall.name);

        const cartUpdate = toCartUpdate(toolCall.name, result);
        if (cartUpdate) cartUpdates.push(cartUpdate);

        response = await client.responses.create({
          model: "gpt-4o-mini-2024-07-18",
          previous_response_id: response.id,
          input: [{
            type: "function_call_output",
            call_id: toolCall.call_id,
            output: JSON.stringify(result)
          }]
        });

        continue;
      }

      if (message) {
        assistantMessage = message.content?.[0]?.text || null;
      }

      break;
    }

    return jsonResponse(200, {
      ok: true,
      reply: assistantMessage || "Ordine elaborato.",
      cartUpdates,
      toolsCalled
    });

  } catch (error) {

    console.error("AI ERROR V2:", error);

    return jsonResponse(500, {
      error: error.message || "Errore AI"
    });
  }
};
