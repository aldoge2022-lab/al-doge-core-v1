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
        setResult("Errore di comunicazione con il server.");
        return;
      }

      const hasValidMainItem = data.mainItem && data.mainItem.id;
      const hasValidUpsell = data.upsell && data.upsell.id;
      const isAddToCartAction = data.action === "add_to_cart";
      const canAddToCart = isAddToCartAction && data.ok === true && hasValidMainItem;

      if (canAddToCart) {
        if (typeof addToCart === "function") {
          addToCart(data.mainItem);
        } else {
          console.warn("addToCart non disponibile");
        }
      }

      if (hasValidUpsell && hasValidMainItem) {
        window.aiSessionState = {
          lastMainItemId: data.mainItem.id,
          lastUpsellId: data.upsell.id,
          awaitingUpsellConfirmation: true,
        };
      }

      setResult(data.reply);

    } catch (err) {
      console.error("AI error:", err);
      setResult("Errore durante la richiesta AI.");
    }

  });

});
