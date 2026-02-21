(function () {
  const promptEl = document.getElementById('aiPrompt');
  const suggestBtn = document.getElementById('aiSuggestBtn');
  const resultEl = document.getElementById('aiResult');
  const addBtn = document.getElementById('aiAddBtn');

  if (!promptEl || !suggestBtn || !resultEl || !addBtn) return;

  let menuData = null;
  let lastSuggestion = null;

  function currentSize() {
    const select = document.getElementById('size-select');
    if (!select || !select.value) return 'normale';
    return select.value;
  }

  function getUnitPrice(product) {
    const size = currentSize();
    const surcharge = menuData.size_engine.options[size]
      ? menuData.size_engine.options[size].surcharge_cents
      : 0;
    return Number(product.base_price_cents) + Number(surcharge);
  }

  function validateSuggestion(payload) {
    const activeById = new Map(
      (menuData.menu || [])
        .filter((item) => item.active && item.id)
        .map((item) => [item.id, item])
    );

    const items = Array.isArray(payload.items) ? payload.items : [];
    return {
      note: String(payload.note || ''),
      items: items
        .filter((it) => activeById.has(it.id))
        .map((it) => ({
          id: it.id,
          qty: Math.max(1, Math.min(5, Number(it.qty) || 1))
        }))
    };
  }

  function renderSuggestion(data) {
    if (!data.items.length) {
      resultEl.textContent = 'Nessuna proposta valida.';
      addBtn.disabled = true;
      return;
    }

    const lines = data.items.map((it) => `- ${it.id} × ${it.qty}`).join('\n');
    resultEl.textContent = `Proposta:\n${lines}\n${data.note ? `\n${data.note}` : ''}`;
    addBtn.disabled = false;
  }

  suggestBtn.addEventListener('click', async function () {
    const message = promptEl.value.trim();
    addBtn.disabled = true;
    resultEl.textContent = 'Generazione in corso...';
    lastSuggestion = null;

    try {
      const response = await fetch('/.netlify/functions/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message })
      });

      const payload = await response.json();
      if (!response.ok) {
        resultEl.textContent = payload.error || 'Errore nella generazione.';
        return;
      }

      const validated = validateSuggestion(payload);
      lastSuggestion = validated;
      renderSuggestion(validated);
    } catch (error) {
      console.error(error);
      resultEl.textContent = 'Errore tecnico temporaneo.';
    }
  });

  addBtn.addEventListener('click', function () {
    if (!lastSuggestion || !lastSuggestion.items.length || !window.Cart || typeof window.Cart.addItem !== 'function') {
      return;
    }

    const size = currentSize();
    const productsById = new Map((menuData.menu || []).map((item) => [item.id, item]));

    lastSuggestion.items.forEach((entry) => {
      const product = productsById.get(entry.id);
      if (!product) return;
      for (let i = 0; i < entry.qty; i += 1) {
        window.Cart.addItem({
          id: product.id,
          name: product.name,
          size: size,
          unit_price_cents: getUnitPrice(product)
        });
      }
    });

    window.dispatchEvent(new Event('cart-updated'));
    if (typeof window.alDogeOpenDrawer === 'function') {
      window.alDogeOpenDrawer();
    }
  });

  fetch('/data/menu.json')
    .then((response) => response.json())
    .then((data) => {
      menuData = data;
    })
    .catch((error) => {
      console.error(error);
    });
})();
