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
      const response = await fetch("/.netlify/functions/orchestrator-v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt })
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

      if (data.action === "add_to_cart") {
        if (typeof window.addToCart === "function" && data.mainItem) {
          window.addToCart(data.mainItem);
        } else {
          console.warn("Impossibile aggiungere al carrello", { hasHandler: typeof window.addToCart === "function", mainItem: data.mainItem });
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
