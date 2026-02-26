document.addEventListener("DOMContentLoaded", () => {

  const btn = document.getElementById("aiSuggestBtn");
  const input = document.getElementById("aiPrompt");
  const resultBox = document.getElementById("aiResult");

  if (!btn || !input || !resultBox) {
    console.error("AI elements not found in DOM");
    return;
  }

  function setResult(message) {
    resultBox.textContent = message;
  }

  function showError(message) {
    setResult(message);
  }

  function showBotMessage(message) {
    setResult(message);
  }

  btn.addEventListener("click", async () => {

    const prompt = input.value.trim();
    if (!prompt) return;

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
      if (!data || typeof data.reply !== "string") {
        showError("Errore di comunicazione con il server.");
        return;
      }

      showBotMessage(data.reply);

      if (data.ok && data.action === "add_to_cart" && data.mainItem && data.mainItem.id && typeof addToCart === "function") {
        addToCart(data.mainItem);
      }

      if (data.upsell && data.upsell.id) {
        window.aiSessionState = {
          lastMainItemId: data.mainItem?.id || null,
          lastUpsellId: data.upsell.id,
          awaitingUpsellConfirmation: true,
        };
      }

    } catch (err) {
      console.error("AI error:", err);
      showError("Errore durante la richiesta AI.");
    }

  });

});
