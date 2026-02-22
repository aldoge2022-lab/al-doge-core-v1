(function () {
  (function initTableMode() {
    const params = new URLSearchParams(window.location.search);
    const table = String(params.get('table') || '').trim();
    const storedTable = String(localStorage.getItem('table_id') || sessionStorage.getItem('active_table') || '').trim();
    if (table && /^[A-Za-z0-9_-]{1,20}$/.test(table)) {
      localStorage.setItem('table_id', table);
      sessionStorage.setItem('active_table', table);
      document.body.classList.add('table-mode');
    } else if (/^[A-Za-z0-9_-]{1,20}$/.test(storedTable)) {
      document.body.classList.add('table-mode');
    }
  })();

  const STORAGE_KEY = 'cart';
  const ALTERNATE_STORAGE_KEY = 'aldoge_cart';
  const LEGACY_STORAGE_KEY = 'al_doge_cart_v1';
  const CHECKOUT_SUCCESS_STATUS = 'success';
  const FALLBACK_CATALOG = { menu: [], drinks: [], doughs: { normale: { surcharge_cents: 0 } }, extras: {} };
  const catalog = window.ALDOGE_CATALOG || FALLBACK_CATALOG;

  function lineUnitPrice(item) {
    if (!item || !item.id) return 0;
    if (item.type === 'drink') {
      const drink = (catalog.drinks || []).find((entry) => entry.id === item.id && entry.active);
      return drink ? Number(drink.price_cents) : 0;
    }
    const pizza = (catalog.menu || []).find((entry) => entry.id === item.id && entry.active);
    if (!pizza) return 0;
    const dough = catalog.doughs[item.dough] || catalog.doughs.normale || { surcharge_cents: 0 };
    const extrasTotal = (item.extras || []).reduce((sum, extraId) => {
      const extra = catalog.extras[extraId];
      return sum + (extra ? Number(extra.price_cents) : 0);
    }, 0);
    return Number(pizza.base_price_cents) + Number(dough.surcharge_cents || 0) + extrasTotal;
  }

  function cartItemKey(item) {
    const extras = Array.isArray(item.extras) ? [...item.extras].sort().join(',') : '';
    return [item.type, item.id, item.dough || '', extras].join('|');
  }

  function toSafeQuantity(value) {
    return Math.max(1, Number(value) || 1);
  }

  function normalizeItem(item) {
    const type = item && item.type === 'drink' ? 'drink' : 'pizza';
    const id = String(item && item.id ? item.id : '');
    const dough = type === 'pizza'
      ? String((item && item.dough) || (item && item.size) || (catalog.size_engine && catalog.size_engine.default) || 'normale')
      : undefined;
    const extras = type === 'pizza' && Array.isArray(item && item.extras)
      ? [...new Set(item.extras.map((extra) => String(extra)).filter((extra) => catalog.extras[extra]))]
      : [];
    return {
      type,
      id,
      dough,
      extras,
      quantity: toSafeQuantity(item && (item.quantity ?? item.qty))
    };
  }

  function normalizeCart(items) {
    const normalized = [];
    (Array.isArray(items) ? items : []).forEach((entry) => {
      const item = normalizeItem(entry);
      if (!item.id || lineUnitPrice(item) <= 0) return;
      const itemKey = cartItemKey(item);
      const existing = normalized.find((cartItem) => cartItemKey(cartItem) === itemKey);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        normalized.push(item);
      }
    });
    return normalized;
  }

  function read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(parsed)) {
        return normalizeCart(parsed);
      }
    } catch (ignoredParseError) {}
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
      if (parsed && Array.isArray(parsed.items)) {
        return normalizeCart(parsed.items);
      }
    } catch (ignoredParseError) {}
    return [];
  }

  function write(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCart(cart)));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  function renderCart() {
    if (typeof window.alDogeRenderCartDrawer === 'function') {
      window.alDogeRenderCartDrawer();
    }
  }

  function updateBadge() {
    const cart = read();
    const badge = document.getElementById('cartBadge');
    if (badge) badge.textContent = String(cart.reduce((sum, item) => sum + item.quantity, 0));
  }

  function commitCart(cart) {
    const normalizedCart = normalizeCart(cart);
    if (normalizedCart.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } else {
      write(normalizedCart);
    }
    renderCart();
    updateBadge();
    emitUpdated();
  }

  function emitUpdated() {
    window.dispatchEvent(new Event('cart-updated'));
  }

  const Cart = {
    getCart() {
      return read();
    },
    addToCart(item) {
      const cart = read();
      const normalizedItem = normalizeItem(item);
      if (!normalizedItem.id || lineUnitPrice(normalizedItem) <= 0) return cart;
      const itemKey = cartItemKey(normalizedItem);
      const existing = cart.find((entry) => cartItemKey(entry) === itemKey);

      if (existing) {
        existing.quantity += normalizedItem.quantity;
      } else {
        cart.push(normalizedItem);
      }

      commitCart(cart);
      return cart;
    },
    addItem(item) {
      return this.addToCart(item);
    },
    decreaseQuantity(productId) {
      const cart = read();
      const index = typeof productId === 'object'
        ? cart.findIndex((entry) => cartItemKey(entry) === cartItemKey(normalizeItem(productId)))
        : cart.findIndex((entry) => entry.id === productId);
      if (index === -1) return cart;
      if (cart[index].quantity > 1) {
        cart[index].quantity -= 1;
      } else {
        cart.splice(index, 1);
      }
      commitCart(cart);
      return cart;
    },
    removeFromCart(productId) {
      const cart = typeof productId === 'object'
        ? read().filter((entry) => cartItemKey(entry) !== cartItemKey(normalizeItem(productId)))
        : read().filter((entry) => entry.id !== productId);
      commitCart(cart);
      return cart;
    },
    removeItem(productId) {
      return this.removeFromCart(productId);
    },
    updateBadge() {
      updateBadge();
    },
    calculatePreviewTotal() {
      const cart = read();
      const total = cart.reduce((sum, item) => sum + (lineUnitPrice(item) * item.quantity), 0);
      this.updateBadge();
      const barTotal = document.getElementById('cartBarTotal');
      if (barTotal) barTotal.textContent = `€ ${(total / 100).toFixed(2)}`;
      return total;
    },
    calculateTotal() {
      return this.calculatePreviewTotal();
    },
    clearCart() {
      commitCart([]);
      return [];
    }
  };

  window.Cart = Cart;
  window.addToCart = (product) => Cart.addToCart(product);
  window.decreaseQuantity = (productId) => Cart.decreaseQuantity(productId);
  window.removeFromCart = (productId) => Cart.removeFromCart(productId);
  window.removeItem = (productId) => Cart.removeItem(productId);
  window.renderCart = () => renderCart();
  window.updateBadge = () => Cart.updateBadge();
  window.calculatePreviewTotal = () => Cart.calculatePreviewTotal();
  window.calculateTotal = () => Cart.calculatePreviewTotal();
  window.clearCart = () => Cart.clearCart();

  (function handleCheckoutRedirect() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');

    if (status === CHECKOUT_SUCCESS_STATUS) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(ALTERNATE_STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);

      if (typeof window.renderCart === 'function') {
        window.renderCart();
      }

      if (typeof window.updateBadge === 'function') {
        window.updateBadge();
      }

      const url = new URL(window.location.href);
      url.searchParams.delete('checkout');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  })();
})();

// =========================
// PREMIUM CART DRAWER UI
// =========================

function alDogeGetCartSafe() {
  try {
    if (window.Cart && typeof window.Cart.getCart === 'function') {
      const cartState = window.Cart.getCart();
      if (Array.isArray(cartState)) return cartState;
      if (cartState && Array.isArray(cartState.items)) return cartState.items;
    }
  } catch (_) {}
  try {
    const raw = localStorage.getItem('cart');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  try {
    const raw = localStorage.getItem('al_doge_cart_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
    }
  } catch (_) {}
  if (Array.isArray(window.cart)) return window.cart;
  return [];
}

function alDogeCalcCount(cart) {
  return cart.reduce((s, it) => s + Number(it.quantity ?? it.qty ?? 1), 0);
}

function alDogeCalcTotal(cart) {
  if (window.Cart && typeof window.Cart.calculatePreviewTotal === 'function') {
    return window.Cart.calculatePreviewTotal();
  }
  return 0;
}

function alDogeFormatEUR(v) {
  return `€ ${(Number(v) / 100).toFixed(2)}`;
}



function alDogeGetTableNumberFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    const value = String(localStorage.getItem('table_id') || sessionStorage.getItem('active_table') || params.get('table') || params.get('table_number') || '').trim();
    return /^[A-Za-z0-9_-]{1,20}$/.test(value) ? value : null;
  } catch (_) {
    return null;
  }
}

async function alDogeProceedToCheckout(cart) {
  const checkoutItems = Array.isArray(cart)
    ? cart.map((item) => ({
      type: item.type === 'drink' ? 'drink' : 'pizza',
      id: item.id,
      quantity: Number(item.quantity ?? item.qty ?? 1),
      dough: item.type === 'drink' ? undefined : String(item.dough || 'normale'),
      extras: item.type === 'drink' ? [] : (Array.isArray(item.extras) ? item.extras : [])
    }))
    : [];

  const tableNumber = alDogeGetTableNumberFromQuery();
  const tableId = tableNumber ? Number(tableNumber) : null;
  const splitPersonsInput = document.getElementById('splitPersonsInput');
  const splitToggleButton = document.getElementById('splitToggleBtn');
  const splitPersons = Math.max(1, Math.floor(Number(splitPersonsInput && splitPersonsInput.value) || 2));
  const totalCents = alDogeCalcTotal(cart);
  const splitMode = Boolean(
    tableNumber
    && splitToggleButton
    && splitToggleButton.getAttribute('aria-pressed') === 'true'
    && totalCents > 0
  );

  if (tableNumber) {
    if (!Number.isFinite(tableId)) {
      throw new Error('Numero tavolo non valido');
    }
    const tableOrderResponse = await fetch('/.netlify/functions/create-table-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table_id: tableId,
        items: checkoutItems.map((item) => ({ id: item.id, qty: Math.max(1, Math.floor(Number(item.quantity) || 1)) }))
      })
    });
    let tableOrderPayload = null;
    try {
      tableOrderPayload = await tableOrderResponse.json();
    } catch (ignoredParseError) {}
    if (!tableOrderResponse.ok) {
      throw new Error((tableOrderPayload && tableOrderPayload.error) || 'Errore sconosciuto');
    }
    if (!tableOrderPayload || !tableOrderPayload.order_id) {
      throw new Error('Ordine tavolo non disponibile');
    }
    const checkoutResponse = await fetch('/.netlify/functions/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: tableOrderPayload.order_id })
    });
    const checkoutPayload = await checkoutResponse.json();
    if (!checkoutResponse.ok || !checkoutPayload || !checkoutPayload.url) {
      throw new Error((checkoutPayload && (checkoutPayload.error || checkoutPayload.note)) || 'Checkout non disponibile');
    }
    window.location.href = checkoutPayload.url;
    return;
  }

  const response = await fetch('/.netlify/functions/create-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cart: checkoutItems,
      ...(splitMode ? {
        split_mode: true,
        split_persons: splitPersons,
        amount_override_cents: Math.ceil(totalCents / splitPersons)
      } : {})
    })
  });

  const payload = await response.json();
  if (!response.ok || !payload || !payload.url) {
    throw new Error((payload && (payload.error || payload.note)) || 'Checkout non disponibile');
  }

  window.location.href = payload.url;
}

window.proceedToCheckout = alDogeProceedToCheckout;

async function alDogeProceedToCheckoutSafe(cart) {
  if (typeof window.proceedToCheckout === 'function') return window.proceedToCheckout(cart);
  if (typeof window.createCheckoutSession === 'function') return window.createCheckoutSession(cart);
  if (typeof window.checkout === 'function') return window.checkout(cart);
  alert('Checkout non collegato: manca proceedToCheckout/createCheckoutSession/checkout.');
}

function alDogeRenderCartDrawer() {
  const catalog = window.ALDOGE_CATALOG || { menu: [], drinks: [], doughs: {}, extras: {} };
  const cart = alDogeGetCartSafe();
  const count = alDogeCalcCount(cart);
  const total = alDogeCalcTotal(cart);

  const badge = document.getElementById('cartBadge');
  const barTotal = document.getElementById('cartBarTotal');
  const topCheckout = document.getElementById('cartCheckoutBtnTop');

  if (badge) badge.textContent = String(count);
  if (barTotal) barTotal.textContent = alDogeFormatEUR(total);
  if (topCheckout) topCheckout.disabled = (count === 0);

  const emptyEl = document.getElementById('cartDrawerEmpty');
  const itemsEl = document.getElementById('cartDrawerItems');
  const totalEl = document.getElementById('cartDrawerTotal');
  const checkoutBtn = document.getElementById('cartCheckoutBtn');

  if (totalEl) totalEl.textContent = alDogeFormatEUR(total);
  if (checkoutBtn) checkoutBtn.disabled = (count === 0);

  if (!emptyEl || !itemsEl) return;

  itemsEl.innerHTML = '';
  if (count === 0) {
    emptyEl.style.display = '';
    return;
  }

  emptyEl.style.display = 'none';

  cart.forEach((it) => {
    const drink = (catalog.drinks || []).find((entry) => entry.id === it.id);
    const pizza = (catalog.menu || []).find((entry) => entry.id === it.id);
    const name = drink ? drink.name : (pizza ? pizza.name : 'Prodotto');
    const q = Number(it.quantity ?? it.qty ?? 1);
    const dough = catalog.doughs && it.dough ? catalog.doughs[it.dough] : null;
    const extraIds = Array.isArray(it.extras) ? it.extras : [];
    const extras = extraIds.map((extraId) => catalog.extras && catalog.extras[extraId] ? catalog.extras[extraId].label : null).filter(Boolean);
    const baseCents = drink
      ? Number(drink.price_cents)
      : (pizza ? Number(pizza.base_price_cents) + Number((dough && dough.surcharge_cents) || 0) + extraIds.reduce((sum, extraId) => {
        const extraEntry = catalog.extras && catalog.extras[extraId];
        return sum + (extraEntry ? Number(extraEntry.price_cents) : 0);
      }, 0) : 0);
    const priceCents = baseCents;
    const line = priceCents * q;

    const metaParts = [];
    if (it.dough) metaParts.push(String((dough && dough.label) || it.dough));
    if (extras.length) metaParts.push(extras.join(', '));
    const meta = metaParts.length ? metaParts.join(' • ') : '';

    const row = document.createElement('div');
    row.className = 'cart-item-row';

    const left = document.createElement('div');
    const itemName = document.createElement('div');
    itemName.className = 'cart-item-name';
    itemName.textContent = `${name} × ${q}`;
    left.appendChild(itemName);

    if (meta) {
      const itemMeta = document.createElement('div');
      itemMeta.className = 'cart-item-meta';
      itemMeta.textContent = meta;
      left.appendChild(itemMeta);
    }

    const right = document.createElement('div');
    right.className = 'cart-item-right';
    const linePrice = document.createElement('div');
    linePrice.textContent = alDogeFormatEUR(line);
    right.appendChild(linePrice);

    const actions = document.createElement('div');
    actions.className = 'cart-item-actions';

    const decreaseBtn = document.createElement('button');
    decreaseBtn.type = 'button';
    decreaseBtn.className = 'cart-item-action-btn';
    decreaseBtn.textContent = '−';
    decreaseBtn.setAttribute('aria-label', `Riduci quantità ${name}`);
    decreaseBtn.addEventListener('click', () => {
      if (window.Cart && typeof window.Cart.decreaseQuantity === 'function') {
        window.Cart.decreaseQuantity(it.id);
      }
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'cart-item-action-btn';
    removeBtn.textContent = 'Rimuovi';
    removeBtn.setAttribute('aria-label', `Rimuovi ${name}`);
    removeBtn.addEventListener('click', () => {
      if (window.Cart && typeof window.Cart.removeFromCart === 'function') {
        window.Cart.removeFromCart(it.id);
      }
    });

    actions.appendChild(decreaseBtn);
    actions.appendChild(removeBtn);
    right.appendChild(actions);

    row.appendChild(left);
    row.appendChild(right);
    itemsEl.appendChild(row);
  });
}

function alDogeOpenDrawer() {
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('cartBackdrop') || document.getElementById('cartDrawerBackdrop');
  const openBtn = document.getElementById('cartOpenBtn');
  if (!drawer || !backdrop) return;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.hidden = false;

  if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
}

function alDogeCloseDrawer() {
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('cartBackdrop') || document.getElementById('cartDrawerBackdrop');
  const openBtn = document.getElementById('cartOpenBtn');
  if (!drawer || !backdrop) return;

  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  backdrop.hidden = true;

  if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
}

document.addEventListener('DOMContentLoaded', () => {
  const activeTable = alDogeGetTableNumberFromQuery();
  if (activeTable) {
    const banner = document.createElement('section');
    banner.className = 'menu-controls';
    banner.id = 'tableModeBanner';
    banner.textContent = `Tavolo ${activeTable} attivo`;
    const main = document.querySelector('main.container');
    if (main) main.insertAdjacentElement('afterbegin', banner);
  }

  alDogeRenderCartDrawer();

  const openBtn = document.getElementById('cartOpenBtn');
  const closeBtn = document.getElementById('cartCloseBtn');
  const backdrop = document.getElementById('cartBackdrop') || document.getElementById('cartDrawerBackdrop');
  const backToMenuBtn = document.getElementById('cartBackToMenuBtn');

  if (openBtn) openBtn.addEventListener('click', alDogeOpenDrawer);
  if (closeBtn) closeBtn.addEventListener('click', alDogeCloseDrawer);
  if (backdrop) backdrop.addEventListener('click', alDogeCloseDrawer);
  if (backToMenuBtn) backToMenuBtn.addEventListener('click', alDogeCloseDrawer);

  document.addEventListener('keydown', (e) => {
    const drawer = document.getElementById('cartDrawer');
    if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) alDogeCloseDrawer();
  });

  const btn1 = document.getElementById('cartCheckoutBtn');
  const btn2 = document.getElementById('cartCheckoutBtnTop');
  if (activeTable) {
    const footer = document.querySelector('.cart-drawer-footer');
    if (footer && !document.getElementById('splitToggleBtn')) {
      const splitWrap = document.createElement('div');
      splitWrap.className = 'cart-total-row';
      splitWrap.innerHTML = `
        <label for="splitPersonsInput">Numero persone:</label>
        <input id="splitPersonsInput" class="table-split-input" type="number" min="1" value="2" />
        <button id="splitToggleBtn" class="cart-checkout" type="button" aria-pressed="false">Dividi conto</button>
      `;
      footer.insertBefore(splitWrap, footer.firstChild);
      const splitToggleBtn = splitWrap.querySelector('#splitToggleBtn');
      splitToggleBtn.addEventListener('click', () => {
        const enabled = splitToggleBtn.getAttribute('aria-pressed') === 'true';
        splitToggleBtn.setAttribute('aria-pressed', enabled ? 'false' : 'true');
      });
    }
  }

  async function goCheckout() {
    const cart = alDogeGetCartSafe();
    if (!cart.length) return;
    try {
      await alDogeProceedToCheckoutSafe(cart);
    } catch (error) {
      alert((error && error.message) || 'Errore checkout.');
    }
  }

  if (btn1) btn1.addEventListener('click', goCheckout);
  if (btn2) btn2.addEventListener('click', goCheckout);

  window.addEventListener('cart-updated', () => {
    if (window.Cart && typeof window.Cart.calculateTotal === 'function') {
      window.Cart.calculateTotal();
    }
    alDogeRenderCartDrawer();
  });
});
