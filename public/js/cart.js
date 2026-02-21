(function () {
  const STORAGE_KEY = 'cart';
  const LEGACY_STORAGE_KEY = 'al_doge_cart_v1';

  function toSafeQuantity(value) {
    return Math.max(1, Number(value) || 1);
  }

  function normalizeItem(item) {
    const cents =
      item && item.price_cents != null
        ? Number(item.price_cents)
        : Number(item && item.unit_price_cents);
    return {
      id: String(item && item.id ? item.id : ''),
      name: String((item && item.name) || 'Prodotto'),
      price_cents: Number.isFinite(cents) ? cents : 0,
      quantity: toSafeQuantity(item && (item.quantity ?? item.qty))
    };
  }

  function normalizeCart(items) {
    const normalized = [];
    (Array.isArray(items) ? items : []).forEach((entry) => {
      const item = normalizeItem(entry);
      if (!item.id || item.price_cents <= 0) return;
      const existing = normalized.find((cartItem) => cartItem.id === item.id);
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
    } catch (_) {}
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
      if (parsed && Array.isArray(parsed.items)) {
        return normalizeCart(parsed.items);
      }
    } catch (_) {}
    return [];
  }

  function write(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCart(cart)));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
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
      if (!normalizedItem.id || normalizedItem.price_cents <= 0) return cart;
      const existing = cart.find((entry) => entry.id === normalizedItem.id);

      if (existing) {
        existing.quantity += 1;
      } else {
        cart.push(normalizedItem);
      }

      write(cart);
      emitUpdated();
      return cart;
    },
    addItem(item) {
      return this.addToCart(item);
    },
    decreaseQuantity(productId) {
      const cart = read();
      const index = cart.findIndex((entry) => entry.id === productId);
      if (index === -1) return cart;
      if (cart[index].quantity > 1) {
        cart[index].quantity -= 1;
      } else {
        cart.splice(index, 1);
      }
      write(cart);
      emitUpdated();
      return cart;
    },
    removeFromCart(productId) {
      const cart = read().filter((entry) => entry.id !== productId);
      write(cart);
      emitUpdated();
      return cart;
    },
    calculateTotal() {
      const cart = read();
      const total = cart.reduce((sum, item) => sum + (item.price_cents * item.quantity), 0);
      const badge = document.getElementById('cartBadge');
      const barTotal = document.getElementById('cartBarTotal');
      if (badge) badge.textContent = String(cart.reduce((sum, item) => sum + item.quantity, 0));
      if (barTotal) barTotal.textContent = `€ ${(total / 100).toFixed(2)}`;
      return total;
    },
    clearCart() {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      emitUpdated();
      return [];
    }
  };

  window.Cart = Cart;
  window.addToCart = (product) => Cart.addToCart(product);
  window.decreaseQuantity = (productId) => Cart.decreaseQuantity(productId);
  window.removeFromCart = (productId) => Cart.removeFromCart(productId);
  window.calculateTotal = () => Cart.calculateTotal();
  window.clearCart = () => Cart.clearCart();
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
  return cart.reduce((sum, item) => {
    const q = Number(item.quantity ?? item.qty ?? 1);
    const priceCents =
      item.price_cents != null
        ? Number(item.price_cents)
        : (item.unit_price_cents != null ? Number(item.unit_price_cents) : Math.round(Number(item.price || 0) * 100));
    return sum + (priceCents * q);
  }, 0);
}

function alDogeFormatEUR(v) {
  return `€ ${(Number(v) / 100).toFixed(2)}`;
}


async function alDogeProceedToCheckout(cart) {
  const checkoutItems = Array.isArray(cart)
    ? cart.map((item) => ({
      id: item.id,
      quantity: Number(item.quantity ?? item.qty ?? 1),
      unit_price_cents: Number(item.price_cents ?? item.unit_price_cents ?? 0),
      name: item.name
    }))
    : [];

  const response = await fetch('/.netlify/functions/ordine-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: checkoutItems })
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
    const name = it.name ?? it.title ?? 'Prodotto';
    const q = Number(it.quantity ?? it.qty ?? 1);
    const priceCents =
      it.price_cents != null
        ? Number(it.price_cents)
        : (it.unit_price_cents != null ? Number(it.unit_price_cents) : Math.round(Number(it.price || 0) * 100));
    const line = priceCents * q;

    const metaParts = [];
    if (it.size) metaParts.push(String(it.size));
    if (it.format) metaParts.push(String(it.format));
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
