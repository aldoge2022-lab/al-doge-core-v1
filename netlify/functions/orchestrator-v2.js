const { buildPanino } = require('../../core/panino');

const MAX_TOOL_CALLS = 3;

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function buildResponse({ ok, action = null, mainItem = null, upsell = null, reply }) {
  return {
    ok,
    action,
    mainItem,
    upsell,
    reply
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

async function runTool(toolCall, cart) {
  const args = parseArgs(toolCall.arguments);

  if (toolCall.name === "create_custom_panino") {
    const ids = Array.isArray(args.ingredientIds) ? args.ingredientIds : [];
    const result = buildPanino(ids);

    if (!result.ok) {
      return {
        ok: false,
        action: null,
        mainItem: null,
        upsell: null,
        reply: result.error
      };
    }

    return {
      ok: true,
      action: "ADD",
      mainItem: {
        type: "panino",
        ingredientIds: result.ingredientIds,
        pricing: result.pricing
      },
      upsell: null,
      reply: "Panino configurato correttamente."
    };
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
    return jsonResponse(200, buildResponse({
      ok: false,
      action: null,
      mainItem: null,
      upsell: null,
      reply: "Metodo non consentito"
    }));
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonResponse(200, buildResponse({
      ok: false,
      action: null,
      mainItem: null,
      upsell: null,
      reply: "OPENAI_API_KEY non configurata"
    }));
  }

  const body = tryParseJson(event.body);
  const prompt = body.prompt || "";
  const cart = Array.isArray(body.cart) ? body.cart : [];

  if (!prompt) {
    return jsonResponse(200, buildResponse({
      ok: false,
      action: null,
      mainItem: null,
      upsell: null,
      reply: "Prompt mancante"
    }));
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

    let assistantMessage = null;
    let operationOk = true;
    let action = null;
    let mainItem = null;
    let upsell = null;

    for (let i = 0; i < MAX_TOOL_CALLS; i++) {

      const outputs = Array.isArray(response.output) ? response.output : [];
      const toolCall = outputs.find(o => o.type === "tool_call");
      const message = outputs.find(o => o.type === "message");

      if (toolCall) {

        const result = await runTool(toolCall, cart);

        if (toolCall.name === "add_menu_item_to_cart") {
          action = "ADD";
          mainItem = {
            itemId: String(result.itemId),
            qty: Math.max(1, Number(result.qty) || 1)
          };
        }

        if (toolCall.name === "create_custom_panino") {
          operationOk = Boolean(result?.ok);
          action = result?.action ?? null;
          mainItem = result?.mainItem ?? null;
          upsell = result?.upsell ?? null;
          assistantMessage = result?.reply ?? assistantMessage;
          break;
        }

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

    return jsonResponse(200, buildResponse({
      ok: operationOk,
      action,
      mainItem,
      upsell,
      reply: assistantMessage || "Ordine elaborato."
    }));

  } catch (error) {

    console.error("AI ERROR V2:", error);

    return jsonResponse(200, buildResponse({
      ok: false,
      action: null,
      mainItem: null,
      upsell: null,
      reply: error.message || "Errore AI"
    }));
  }
};
