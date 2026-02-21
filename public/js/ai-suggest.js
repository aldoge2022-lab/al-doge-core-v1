(function () {
  const promptEl = document.getElementById('aiPrompt');
  const suggestBtn = document.getElementById('aiSuggestBtn');
  const resultEl = document.getElementById('aiResult');
  const addBtn = document.getElementById('aiAddBtn');
  const quickActionButtons = document.querySelectorAll('[data-ai-quick]');
  const microConfirmEl = document.getElementById('aiMicroConfirm');
  const secondarySuggestEl = document.getElementById('aiSecondarySuggest');
  const addSecondaryBtn = document.getElementById('aiAddSecondaryBtn');
  const ctaHintEl = document.getElementById('aiCtaHint');

  if (!promptEl || !suggestBtn || !resultEl || !addBtn) return;

  let menuData = null;
  let lastSuggestion = null;
  let lastSecondarySuggestion = null;

  function currentSize() {
    const select = document.getElementById('size-select');
    if (!select || !select.value) return 'normale';
    return select.value;
  }

  function getPeopleCount(items) {
    return items.reduce((sum, item) => sum + Number(item.qty || 0), 0) || 1;
  }

  function getUnitPrice(product) {
    if (!menuData || !menuData.size_engine || !menuData.size_engine.options) return Number(product.base_price_cents);
    const size = currentSize();
    const surcharge = menuData.size_engine.options[size]
      ? menuData.size_engine.options[size].surcharge_cents
      : 0;
    return Number(product.base_price_cents) + Number(surcharge);
  }

  function addItemsToCart(items) {
    if (!menuData || !window.Cart || typeof window.Cart.addItem !== 'function') {
      resultEl.textContent = 'Carrello non disponibile.';
      return false;
    }

    const size = currentSize();
    const productsById = new Map((menuData.menu || []).map((item) => [item.id, item]));

    items.forEach((entry) => {
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
    return true;
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

  function pickSecondarySuggestion(primaryItems) {
    const primaryIds = new Set(primaryItems.map((item) => item.id));
    const activeProducts = (menuData.menu || []).filter((item) => item && item.active && item.id && !primaryIds.has(item.id));
    if (!activeProducts.length) return null;

    const beverageOrDessert = activeProducts.find((product) => {
      const name = String(product.name || '').toLowerCase();
      return ['bevanda', 'cola', 'bibita', 'birra', 'acqua', 'dolce', 'tiramisu', 'dessert'].some((k) => name.includes(k));
    });

    const peopleCount = getPeopleCount(primaryItems);
    const suggestedQty = Math.max(1, Math.min(3, Math.ceil(peopleCount / 2)));

    if (beverageOrDessert) return { id: beverageOrDessert.id, qty: suggestedQty, kind: 'beverage' };

    const premiumFallback = activeProducts
      .slice()
      .sort((a, b) => Number(b.base_price_cents || 0) - Number(a.base_price_cents || 0))[0];

    return premiumFallback ? { id: premiumFallback.id, qty: 1, kind: 'premium' } : null;
  }

  function applyPostSuggestionConversionFlow(data) {
    const peopleCount = getPeopleCount(data.items);

    if (microConfirmEl) {
      microConfirmEl.textContent = `Ottima scelta per ${peopleCount} ${peopleCount === 1 ? 'persona' : 'persone'}.`;
    }

    lastSecondarySuggestion = pickSecondarySuggestion(data.items);

    if (secondarySuggestEl) {
      if (lastSecondarySuggestion && lastSecondarySuggestion.kind === 'beverage') {
        secondarySuggestEl.textContent = 'Vuoi aggiungere una bevanda per completare?';
      } else if (lastSecondarySuggestion) {
        secondarySuggestEl.textContent = 'Vuoi completare l’ordine con una proposta premium?';
      } else {
        secondarySuggestEl.textContent = '';
      }
    }

    if (addSecondaryBtn) {
      if (lastSecondarySuggestion && lastSecondarySuggestion.kind === 'beverage') {
        addSecondaryBtn.textContent = `Aggiungi ${lastSecondarySuggestion.qty} bibite`;
      } else if (lastSecondarySuggestion) {
        addSecondaryBtn.textContent = 'Aggiungi suggerimento secondario';
      } else {
        addSecondaryBtn.textContent = 'Aggiungi suggerimento secondario';
      }
      addSecondaryBtn.disabled = !lastSecondarySuggestion;
    }

    if (ctaHintEl) {
      ctaHintEl.textContent = 'Puoi procedere al pagamento in meno di 30 secondi.';
    }
  }

  function renderSuggestion(data) {
    if (!data.items.length) {
      resultEl.textContent = 'Nessuna proposta valida.';
      addBtn.disabled = true;
      return;
    }

    const names = new Map((menuData.menu || []).map((item) => [item.id, item.name]));
    const lines = data.items.map((it) => `- ${names.get(it.id) || it.id} × ${it.qty}`).join('\n');
    resultEl.textContent = `Proposta:\n${lines}\n${data.note ? `\n${data.note}` : ''}`;
    addBtn.disabled = false;
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
    lastSecondarySuggestion = null;
    if (microConfirmEl) microConfirmEl.textContent = '';
    if (secondarySuggestEl) secondarySuggestEl.textContent = '';
    if (addSecondaryBtn) {
      addSecondaryBtn.disabled = true;
      addSecondaryBtn.textContent = 'Aggiungi suggerimento secondario';
    }
    if (ctaHintEl) ctaHintEl.textContent = '';

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
        resultEl.textContent = [payload.note, payload.error, payload.code ? `Codice: ${payload.code}` : ''].filter(Boolean).join(' • ') || 'Errore nella generazione.';
        return;
      }

      const validated = validateSuggestion(payload);
      lastSuggestion = validated;
      renderSuggestion(validated);
      applyPostSuggestionConversionFlow(validated);
    } catch (error) {
      console.error(error);
      resultEl.textContent = 'Errore tecnico temporaneo.';
    }
  });

  addBtn.addEventListener('click', function () {
    if (!lastSuggestion || !lastSuggestion.items.length) {
      return;
    }

    const added = addItemsToCart(lastSuggestion.items);
    if (!added) return;

    if (ctaHintEl) {
      ctaHintEl.textContent = 'Perfetto: carrello aggiornato. Ora completa con “Vai al pagamento”.';
    }
  });

  if (addSecondaryBtn) {
    addSecondaryBtn.addEventListener('click', function () {
      if (!lastSecondarySuggestion) return;
      const added = addItemsToCart([{ id: lastSecondarySuggestion.id, qty: lastSecondarySuggestion.qty }]);
      if (!added) return;

      if (ctaHintEl) {
        ctaHintEl.textContent = 'Suggerimento aggiunto. Ottimo: puoi procedere al pagamento.';
      }
    });
  }

  fetch('/data/menu.json')
    .then((response) => response.json())
    .then((data) => {
      menuData = data;
    })
    .catch((error) => {
      console.error(error);
    });
})();
