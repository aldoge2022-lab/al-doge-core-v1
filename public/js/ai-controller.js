(function () {
  const DEFAULT_DOUGH = 'normale';
  const promptEl = document.getElementById('aiPrompt');
  const suggestBtn = document.getElementById('aiSuggestBtn');
  const resultEl = document.getElementById('aiResult');
  const quickActionButtons = document.querySelectorAll('[data-ai-quick]');

  function currentDough() {
    const select = document.getElementById('size-select');
    if (!select || !select.value) return DEFAULT_DOUGH;
    return select.value;
  }

  function getMenuItemById(menuItemId) {
    const catalog = window.ALDOGE_CATALOG || { menu: [] };
    return (catalog.menu || []).find((item) => item.id === menuItemId && item.active);
  }

  function applyCartUpdates(cartUpdates) {
    if (!Array.isArray(cartUpdates) || !window.Cart || typeof window.Cart.addItem !== 'function') {
      return;
    }

    const dough = currentDough();
    cartUpdates.forEach((entry) => {
      if (!entry || entry.type !== 'add') return;

      const menuItemId = String(entry.menuItemId || '').trim();
      const qty = Math.max(1, Number(entry.qty) || 1);
      const menuItem = getMenuItemById(menuItemId);
      if (!menuItem) return;

      window.Cart.addItem({
        id: menuItem.id,
        name: menuItem.name,
        dough,
        quantity: qty
      });
    });

    if (typeof window.Cart.updateBadge === 'function') {
      window.Cart.updateBadge();
    }
  }

  function handleResponse(response) {
    if (!resultEl) return;
    const safe = response && typeof response === 'object' ? response : {};
    const reply = typeof safe.reply === 'string'
      ? safe.reply
      : (typeof safe.message === 'string' ? safe.message : 'Nessuna risposta disponibile.');
    const toolsCalled = Array.isArray(safe.toolsCalled) ? safe.toolsCalled : [];
    const finalActions = Array.isArray(safe.finalActions) ? safe.finalActions : [];

    applyCartUpdates(safe.cartUpdates);

    resultEl.textContent = [
      reply,
      toolsCalled.length ? `Tools: ${toolsCalled.join(', ')}` : 'Tools: nessuno',
      finalActions.length ? `Azioni: ${finalActions.length}` : 'Azioni: nessuna'
    ].join('\n');
  }

  async function sendPromptToAI(prompt) {
    const safePrompt = String(prompt || '').trim();
    if (!safePrompt) {
      throw new Error('Prompt mancante');
    }

    const response = await fetch('/api/ai-orchestrator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: safePrompt })
    });
    const payload = await response.json();
    handleResponse(payload);
    return payload;
  }

  if (promptEl && suggestBtn && resultEl) {
    quickActionButtons.forEach((button) => {
      button.addEventListener('click', () => {
        promptEl.value = button.getAttribute('data-ai-quick') || '';
      });
    });

    suggestBtn.addEventListener('click', async () => {
      resultEl.textContent = 'Elaborazione AI in corso...';
      try {
        await sendPromptToAI(promptEl.value);
      } catch (error) {
        resultEl.textContent = (error && error.message) || 'Errore AI';
      }
    });
  }

  window.sendPromptToAI = sendPromptToAI;
  window.handleResponse = handleResponse;
  window.applyCartUpdates = applyCartUpdates;
})();
