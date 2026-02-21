exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return { statusCode: 500, body: "Telegram non configurato" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const text = String(body.message || "").trim();
    if (!text || text.length > 1000) {
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
