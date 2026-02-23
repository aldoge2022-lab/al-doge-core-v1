(function () {
  const promptEl = document.getElementById('aiPrompt');
  const suggestBtn = document.getElementById('aiSuggestBtn');
  const resultEl = document.getElementById('aiResult');
  const addBtn = document.getElementById('aiAddBtn');
  const drinkSuggestionBox = document.getElementById('drinkSuggestionBox');
  const drinkSuggestionTitle = document.getElementById('drinkSuggestionTitle');
  const drinkSuggestionReason = document.getElementById('drinkSuggestionReason');
  const drinkSuggestionAddBtn = document.getElementById('drinkSuggestionAddBtn');
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
    const items = payload.items;
    return {
      items: items
        .map((it) => ({
          id: it.id,
          qty: 1
        }))
        .filter((it) => it.id && activeById.has(it.id)),
      note: typeof payload.note === 'string' ? payload.note : ''
    };
  }

  function renderSuggestion(data) {
    const names = new Map((menuData.menu || []).map((item) => [item.id, item.name]));
    const lines = data.items.map((it) => `- ${names.get(it.id) || it.id}`).join('\n');
    resultEl.textContent = `Proposta:\n${lines}${data.note ? `\n${data.note}` : ''}`;
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

  async function parseJsonSafely(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // Ignore non-JSON responses from error paths (e.g. 405 plain text body).
      return null;
    }
  }

  async function updateDrinkSuggestionBox() {
    if (!drinkSuggestionBox || !drinkSuggestionTitle || !drinkSuggestionReason || !drinkSuggestionAddBtn || !window.Cart) return;
    drinkSuggestionBox.hidden = true;
  }

  window.addEventListener('product-added', updateDrinkSuggestionBox);

  function showError(message) {
    resultEl.textContent = message;
  }

  async function handleSuggestClick() {
    const currentPromptEl = document.getElementById('aiPrompt');
    if (!currentPromptEl) return;

    const message = currentPromptEl.value.trim();
    addBtn.disabled = true;
    resultEl.textContent = 'Generazione in corso...';
    lastSuggestion = null;

    if (!menuData) {
      resultEl.textContent = 'Menu non disponibile.';
      return;
    }

    const promptText = message;

    fetch('/.netlify/functions/openai-suggestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptText,
        catalog: window.ALDOGE_CATALOG
      })
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'AI error');
        if (!data.suggestion || !Array.isArray(data.suggestion.items) || data.suggestion.items.length === 0) {
          throw new Error('AI error');
        }
        const validated = validateSuggestion(data.suggestion);
        if (!validated.items.length) throw new Error('AI error');
        lastSuggestion = validated;
        renderSuggestion(validated);
      })
      .catch((err) => {
        console.error(err);
        showError('Errore nella generazione.');
      });
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
