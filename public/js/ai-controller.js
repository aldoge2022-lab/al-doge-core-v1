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

    resultBox.innerHTML = "Sto pensando...";

    try {
      const response = await fetch("/.netlify/functions/ai-orchestrator", {
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

      resultBox.innerHTML = data.result || JSON.stringify(data);

    } catch (err) {
      console.error("AI error:", err);
      resultBox.innerHTML = "Errore durante la richiesta AI.";
    }

  });

});
