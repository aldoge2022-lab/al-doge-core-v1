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

      const response = await fetch("/.netlify/functions/ai-engine", {
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

      if (!data || !data.reply) {
        resultBox.textContent = "Errore durante la richiesta AI.";
        return;
      }

      resultBox.textContent = data.reply;

      // Se l'AI restituisce un item valido → auto add
      if (data.ok && data.item && typeof window.addToCart === "function") {
        window.addToCart(data.item);
      }

    } catch (err) {
      console.error("AI error:", err);
      resultBox.textContent = "Errore durante la richiesta AI.";
    }

  });

});
