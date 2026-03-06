document.addEventListener("DOMContentLoaded", () => {

  const btn = document.getElementById("aiSuggestBtn");
  const input = document.getElementById("aiPrompt");
  const resultBox = document.getElementById("aiResult");

  if (!btn || !input || !resultBox) {
    console.error("AI elements not found in DOM");
    return;
  }

  btn.addEventListener("click", async () => {

    const message = input.value.trim();
    if (!message) return;

    resultBox.textContent = "Sto pensando...";

    try {

      const response = await fetch("/.netlify/functions/ai-orchestrator", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message })
      });

      if (!response.ok) {
        throw new Error("Errore server: " + response.status);
      }

      const data = await response.json();

      if (!data) {
        resultBox.textContent = "Errore durante la richiesta AI.";
        return;
      }

      // Messaggio principale
      if (data.reply) {
        resultBox.textContent = data.reply;
      } else {
        resultBox.textContent = "Nessuna risposta disponibile.";
      }

      // Auto-add al carrello se presente item valido
      if (
        data.ok === true &&
        data.item &&
        typeof window.addToCart === "function"
      ) {
        window.addToCart(data.item);
      }

    } catch (err) {
      console.error("AI error:", err);
      resultBox.textContent = "Errore durante la richiesta AI.";
    }

  });

});
