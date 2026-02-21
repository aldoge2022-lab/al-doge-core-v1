(function () {
  const promptEl = document.getElementById('aiPrompt');
  const suggestBtn = document.getElementById('aiSuggestBtn');
  const resultEl = document.getElementById('aiResult');
  const addBtn = document.getElementById('aiAddBtn');
  const quickActionButtons = document.querySelectorAll('[data-ai-quick]');

  if (!promptEl || !suggestBtn || !resultEl || !addBtn) return;

  let menuData = null;
  let lastSuggestion = null;

  function currentSize() {
    const select = document.getElementById('size-select');
    if (!select || !select.value) return 'normale';
    return select.value;
  }

  function getUnitPrice(product) {
    if (!menuData || !menuData.size_engine || !menuData.size_engine.options) return Number(product.base_price_cents);
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

    const names = new Map((menuData.menu || []).map((item) => [item.id, item.name]));
    const lines = data.items.map((it) => `- ${names.get(it.id) || it.id} × ${it.qty}`).join('\n');
    const secondaryLine = data.secondarySuggestion && data.secondarySuggestion.item
      ? `\nSuggerimento extra (${data.secondarySuggestion.kind}): ${(names.get(data.secondarySuggestion.item.id) || data.secondarySuggestion.item.id)} × ${data.secondarySuggestion.item.qty} — ${data.secondarySuggestion.cta || 'Aggiungi'}`
      : '';
    resultEl.textContent = `Proposta:\n${lines}${secondaryLine}\n${data.note ? `\n${data.note}` : ''}`;
    addBtn.disabled = false;
  }

  function getPeopleCount(message) {
    const lower = String(message || '').toLowerCase();
    const match = lower.match(/(?:siamo|in|per)\s+(\d{1,2})/) || lower.match(/(\d{1,2})\s+persone?/);
    const value = match ? Number(match[1]) : 1;
    return Math.max(1, Math.min(5, Number.isFinite(value) ? value : 1));
  }

  function applyPostSuggestionConversionFlow(suggestion, message) {
    if (!suggestion || !suggestion.secondarySuggestion || !suggestion.secondarySuggestion.item) return suggestion;
    const secondary = suggestion.secondarySuggestion;
    if (secondary.kind !== 'beverage' && secondary.kind !== 'premium') return suggestion;

    if (secondary.kind === 'beverage') {
      secondary.item.qty = Math.max(1, Math.min(5, Math.ceil(getPeopleCount(message) / 2)));
      secondary.cta = secondary.cta || 'Completa con bevande';
    } else {
      secondary.item.qty = 1;
      secondary.cta = secondary.cta || 'Sblocca upgrade premium';
    }

    suggestion.note = [suggestion.note, `Conferma rapida: ${secondary.cta}.`].filter(Boolean).join(' ').trim();
    return suggestion;
  }


  quickActionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      promptEl.value = button.getAttribute('data-ai-quick') || '';
      suggestBtn.click();
    });
  });

  suggestBtn.addEventListener('click', async function () {
    const message = promptEl.value.trim();
    addBtn.disabled = true;
    resultEl.textContent = 'Generazione in corso...';
    lastSuggestion = null;

    if (!menuData) {
      resultEl.textContent = 'Menu non disponibile.';
      return;
    }

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
      validated.secondarySuggestion = payload.secondarySuggestion || null;
      lastSuggestion = validated;
      renderSuggestion(applyPostSuggestionConversionFlow(validated, message));
    } catch (error) {
      console.error(error);
      resultEl.textContent = 'Errore tecnico temporaneo.';
    }
  });

  addBtn.addEventListener('click', function () {
    if (!lastSuggestion || !lastSuggestion.items.length) {
      return;
    }
    if (!menuData || !window.Cart || typeof window.Cart.addItem !== 'function') {
      resultEl.textContent = 'Carrello non disponibile.';
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

    const secondary = lastSuggestion.secondarySuggestion;
    if (secondary && secondary.item && (secondary.kind === 'beverage' || secondary.kind === 'premium')) {
      const product = productsById.get(secondary.item.id);
      if (product) {
        for (let i = 0; i < secondary.item.qty; i += 1) {
          window.Cart.addItem({
            id: product.id,
            name: product.name,
            size: size,
            unit_price_cents: getUnitPrice(product)
          });
        }
        resultEl.textContent = `${resultEl.textContent}\n✓ ${secondary.cta || 'Suggerimento extra applicato'}`;
      }
    }

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
