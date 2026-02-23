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
    const activeById = new Map(
      (menuData.menu || [])
        .filter((item) => item.active && item.id)
        .map((item) => [item.id, item])
    );

    if (payload && payload.action === 'answer') {
      return {
        action: 'answer',
        message: String(payload.message || 'Posso aiutarti a scegliere tra pizza o panino?'),
        items: []
      };
    }

    if (payload && payload.action === 'build_custom_item') {
      return {
        action: 'build_custom_item',
        categoria: String(payload.categoria || ''),
        ingredienti: Array.isArray(payload.ingredienti) ? payload.ingredienti : [],
        items: []
      };
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    return {
      action: 'add_recommended_items',
      items: items
        .filter((it) => activeById.has(it.id))
        .map((it) => ({
          id: it.id,
          qty: Math.max(1, Math.min(5, Number(it.qty) || 1))
        }))
    };
  }

  function renderSuggestion(data) {
    if (data.action === 'answer') {
      resultEl.textContent = data.message;
      addBtn.disabled = true;
      return;
    }

    if (data.action === 'build_custom_item') {
      resultEl.textContent = `Azione: crea ${data.categoria} personalizzata con ingredienti: ${(data.ingredienti || []).join(', ') || 'nessuno specificato'}`;
      addBtn.disabled = true;
      return;
    }

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
    resultEl.textContent = `Proposta:\n${lines}${secondaryLine}`;
    addBtn.disabled = false;
  }


  function showSuccessMessage(message) {
    resultEl.textContent = String(message || 'Operazione completata.');
  }

  function showErrorMessage(message) {
    resultEl.textContent = String(message || 'Errore tecnico temporaneo.');
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
    try {
      const response = await fetch('/.netlify/functions/openai-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: window.Cart.getCart() })
      });
      const data = await parseJsonSafely(response);
      if (!response.ok || !data || !data.suggested_drink) {
        drinkSuggestionBox.hidden = true;
        return;
      }

      const catalog = window.ALDOGE_CATALOG || { drinks: [] };
      const drink = (catalog.drinks || []).find((entry) => entry.name === data.suggested_drink);
      if (!drink) {
        drinkSuggestionBox.hidden = true;
        return;
      }

      drinkSuggestionTitle.textContent = `🥤 Abbinalo così: ${data.suggested_drink}`;
      drinkSuggestionReason.textContent = data.reason || '';
      drinkSuggestionAddBtn.onclick = function () {
        window.Cart.addItem({ type: 'drink', id: drink.id, quantity: 1 });
      };
      drinkSuggestionBox.hidden = false;
    } catch (error) {
      drinkSuggestionBox.hidden = true;
    }
  }

  window.addEventListener('product-added', updateDrinkSuggestionBox);

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

    try {
      const response = await fetch('/.netlify/functions/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message })
      });

      const payload = await parseJsonSafely(response);
      if (!response.ok) {
        resultEl.textContent = (payload && payload.error) || 'Errore nella generazione.';
        return;
      }
      if (!payload) {
        resultEl.textContent = 'Errore nella generazione.';
        return;
      }

      if (payload.action === 'build_custom_item') {
        try {
          const buildResponse = await fetch('/.netlify/functions/build-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!buildResponse.ok) {
            throw new Error('Errore validazione server');
          }

          const buildData = await parseJsonSafely(buildResponse);
          if (!buildData || !buildData.cart_item || !window.Cart || typeof window.Cart.addItem !== 'function') {
            throw new Error('Risposta build-item non valida');
          }

          window.Cart.addItem(buildData.cart_item);
          window.dispatchEvent(new Event('cart-updated'));
          showSuccessMessage('Articolo aggiunto al carrello');
          if (typeof window.alDogeOpenDrawer === 'function') {
            window.alDogeOpenDrawer();
          }
          addBtn.disabled = true;
          lastSuggestion = null;
          return;
        } catch (err) {
          console.error(err);
          showErrorMessage('Errore nella creazione dell’articolo');
          return;
        }
      }

      const validated = validateSuggestion(payload);
      validated.secondarySuggestion = validated.action === 'add_recommended_items' ? (payload.secondarySuggestion || null) : null;
      lastSuggestion = validated;
      renderSuggestion(validated.action === 'add_recommended_items' ? applyPostSuggestionConversionFlow(validated, message) : validated);
    } catch (error) {
      console.error(error);
      resultEl.textContent = 'Errore tecnico temporaneo.';
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

})();
