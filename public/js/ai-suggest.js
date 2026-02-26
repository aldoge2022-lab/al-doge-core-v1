(function () {
  const promptEl = document.getElementById('aiPrompt');
  const suggestBtn = document.getElementById('aiSuggestBtn');
  const resultEl = document.getElementById('aiResult');
  const addBtn = document.getElementById('aiAddBtn');
  const quickActionButtons = document.querySelectorAll('[data-ai-quick]');

  if (!promptEl || !suggestBtn || !resultEl || !addBtn) return;

  let menuData = window.ALDOGE_CATALOG || null;
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
    const activeById = new Map((menuData.menu || []).filter((item) => item.active && item.id).map((item) => [item.id, item]));
    return {
      items: (payload.items || [])
        .map((it) => ({ id: it.id, qty: 1 }))
        .filter((it) => it.id && activeById.has(it.id)),
      note: typeof payload.note === 'string' ? payload.note : ''
    };
  }

  function showError(message) {
    resultEl.textContent = message;
  }

  function renderSuggestion(data) {
    const names = new Map((menuData.menu || []).map((item) => [item.id, item.name]));
    const lines = data.items.map((it) => `- ${names.get(it.id) || it.id}`).join('\n');
    resultEl.textContent = `Proposta:\n${lines}${data.note ? `\n${data.note}` : ''}`;
    addBtn.disabled = false;
  }

  quickActionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      promptEl.value = button.getAttribute('data-ai-quick') || '';
      suggestBtn.click();
    });
  });

  async function handleSuggestClick() {
    const message = promptEl.value.trim();
    addBtn.disabled = true;
    resultEl.textContent = 'Generazione in corso...';
    lastSuggestion = null;

    if (!menuData) {
      resultEl.textContent = 'Menu non disponibile.';
      return;
    }

    try {
      const response = await fetch('/.netlify/functions/orchestrator-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: message,
          catalog: window.ALDOGE_CATALOG
        })
      });
      const data = await response.json();
      if (!response.ok || !data || !data.ok || !data.suggestion) {
        throw new Error('Errore nella generazione.');
      }

      const payload = data.suggestion;
      if (!Array.isArray(payload.items)) {
        showError('Errore nella generazione.');
        return;
      }
      if (payload.items.length === 0) {
        showError('Nessuna proposta valida.');
        return;
      }

      const validated = validateSuggestion(payload);
      if (!validated.items.length) {
        showError('Errore nella generazione.');
        return;
      }
      lastSuggestion = validated;
      renderSuggestion(validated);
    } catch (error) {
      console.error(error);
      showError('Errore nella generazione.');
    }
  }

  document.addEventListener('click', async function (e) {
    if (e.target.id !== 'aiSuggestBtn') return;
    await handleSuggestClick();
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

    window.dispatchEvent(new Event('cart-updated'));
    if (typeof window.alDogeOpenDrawer === 'function') {
      window.alDogeOpenDrawer();
    }
  });
})();
