const MAX_MESSAGE_LENGTH = 1000;

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return { statusCode: 500, body: "Telegram non configurato" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const itemsList = String(body.itemsList || "").trim();
    const total = Number(body.total);
    const order = body.order && typeof body.order === "object" ? body.order : null;
    const text = String(
      body.message
      || (order
        ? `
🍕 NUOVO ORDINE ${order.table ? "TAVOLO " + order.table : "ASPORTO"}

${itemsList}

Pagamento: ${String(order.payment_mode || "full").toUpperCase()}
Totale: €${Number.isFinite(total) ? total.toFixed(2) : "0.00"}
`.trim()
        : "")
    ).trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) {
      return { statusCode: 400, body: "Invalid input" };
    }

    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text
      })
    });

    if (!response.ok) {
      return { statusCode: 502, body: "Telegram request failed" };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    console.error("Errore telegram-notify:", error.message);
    return { statusCode: 500, body: "Errore tecnico temporaneo" };
  }
};
