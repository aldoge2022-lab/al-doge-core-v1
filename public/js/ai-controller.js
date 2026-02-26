document.addEventListener("DOMContentLoaded", () => {

  const btn = document.getElementById("aiSuggestBtn");
  const input = document.getElementById("aiPrompt");
  const resultBox = document.getElementById("aiResult");

  if (!btn || !input || !resultBox) {
    console.error("AI elements not found in DOM");
    return;
  }

  btn.addEventListener("click", async () => {

    const prompt = input.value.trim();
    if (!prompt) return;

    // Reset solo al nuovo invio
    resultBox.textContent = "";

    resultBox.textContent = "Sto pensando...";

    try {
      window.aiSessionState = window.aiSessionState || {};

      const response = await fetch("/.netlify/functions/orchestrator-v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt, sessionState: window.aiSessionState })
      });

      if (!response.ok) {
        throw new Error("Errore server: " + response.status);
      }

      const data = await response.json();
      let replyText = null;
      if (typeof data?.reply === "string") {
        replyText = data.reply;
      } else if (typeof data?.response === "string") {
        replyText = data.response;
      }

      if (!data || !replyText) {
        resultBox.textContent = "Errore durante la richiesta AI.";
        return;
      }

      resultBox.textContent = replyText;

      if (data.ok === false) {
        return;
      }

      if (data.ok === true && data.action === null && data.mainItem && data.mainItem.id) {
        try {
          window.aiSessionState.lastMainItemId = data.mainItem.id;
        } catch (storageError) {
          console.warn("Impossibile salvare lo stato AI", storageError);
        }
      }

      if (data.ok === true && data.action === "add_to_cart" && data.mainItem && data.mainItem.id) {
        if (typeof window.addToCart === "function") {
          window.addToCart(data.mainItem);
        } else {
          console.warn("Impossibile aggiungere al carrello", { hasHandler: typeof window.addToCart === "function", mainItem: data.mainItem });
        }
        try {
          window.aiSessionState.lastMainItemId = null;
        } catch (storageError) {
          console.warn("Impossibile aggiornare lo stato AI", storageError);
        }
      }

      if (data.upsell) {
        try {
          sessionStorage.setItem("aldoge_ai_conversation", JSON.stringify({ reply: replyText, upsell: data.upsell }));
        } catch (storageError) {
          console.warn("Impossibile salvare lo stato conversazione", storageError);
        }
      }

    } catch (err) {
      console.error("AI error:", err);
      resultBox.textContent = "Errore durante la richiesta AI.";
    }

  });

});
