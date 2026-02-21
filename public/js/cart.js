(function () {
  const STORAGE_KEY = 'al_doge_cart_v1';

  function read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && Array.isArray(parsed.items)) {
        return parsed;
      }
    } catch (_) {}
    return { items: [] };
  }

  function write(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }

  const Cart = {
    getCart() {
      return read();
    },
    addItem(item) {
      const cart = read();
      const existing = cart.items.find(
        (entry) => entry.id === item.id && entry.size === item.size && entry.unit_price_cents === item.unit_price_cents
      );

      if (existing) {
        existing.quantity += 1;
      } else {
        cart.items.push({
          id: item.id,
          name: item.name,
          size: item.size,
          unit_price_cents: item.unit_price_cents,
          quantity: 1
        });
      }

      write(cart);
      window.dispatchEvent(new Event('cart-updated'));
      return cart;
    }
  };

  window.Cart = Cart;
})();

// =========================
// PREMIUM CART DRAWER UI
// =========================

function alDogeGetCartSafe() {
  try {
    if (window.Cart && typeof window.Cart.getCart === 'function') {
      const cartState = window.Cart.getCart();
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
  return cart.reduce((s, it) => {
    const q = Number(it.quantity ?? it.qty ?? 1);
    const price =
      it.price != null
        ? Number(it.price)
        : (it.price_cents != null
          ? Number(it.price_cents) / 100
          : (it.unit_price_cents != null ? Number(it.unit_price_cents) / 100 : 0));
    return s + (price * q);
  }, 0);
}

function alDogeFormatEUR(v) {
  return `€ ${Number(v).toFixed(2)}`;
}

function alDogeProceedToCheckoutSafe(cart) {
  if (typeof window.proceedToCheckout === 'function') return window.proceedToCheckout(cart);
  alert('Checkout non collegato: manca proceedToCheckout.');
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
    const price =
      it.price != null
        ? Number(it.price)
        : (it.price_cents != null
          ? Number(it.price_cents) / 100
          : (it.unit_price_cents != null ? Number(it.unit_price_cents) / 100 : 0));
    const line = price * q;

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
    right.textContent = alDogeFormatEUR(line);

    row.appendChild(left);
    row.appendChild(right);
    itemsEl.appendChild(row);
  });
}

function alDogeOpenDrawer() {
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('cartDrawerBackdrop');
  const openBtn = document.getElementById('cartOpenBtn');
  if (!drawer || !backdrop) return;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  backdrop.hidden = false;

  if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
}

function alDogeCloseDrawer() {
  const drawer = document.getElementById('cartDrawer');
  const backdrop = document.getElementById('cartDrawerBackdrop');
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
  const backdrop = document.getElementById('cartDrawerBackdrop');

  if (openBtn) openBtn.addEventListener('click', alDogeOpenDrawer);
  if (closeBtn) closeBtn.addEventListener('click', alDogeCloseDrawer);
  if (backdrop) backdrop.addEventListener('click', alDogeCloseDrawer);

  document.addEventListener('keydown', (e) => {
    const drawer = document.getElementById('cartDrawer');
    if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) alDogeCloseDrawer();
  });

  const btn1 = document.getElementById('cartCheckoutBtn');
  const btn2 = document.getElementById('cartCheckoutBtnTop');

  function goCheckout() {
    const cart = (window.Cart && typeof window.Cart.getCart === 'function')
      ? window.Cart.getCart()
      : { items: [] };
    if (!cart.items || !cart.items.length) return;
    window.proceedToCheckout(cart);
  }

  if (btn1) btn1.addEventListener('click', goCheckout);
  if (btn2) btn2.addEventListener('click', goCheckout);

  window.addEventListener('cart-updated', () => {
    alDogeRenderCartDrawer();
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('cartBackBtn');
  const closeBtn = document.getElementById('cartCloseBtn');
  const backdrop = document.getElementById('cartBackdrop') || document.getElementById('cartDrawerBackdrop');

  function closeDrawerSafe() {
    if (typeof window.closeDrawer === 'function') return window.closeDrawer();
    const drawer = document.getElementById('cartDrawer');
    const bd = document.getElementById('cartBackdrop') || document.getElementById('cartDrawerBackdrop');
    const openBtn = document.getElementById('cartOpenBtn');
    if (drawer) drawer.classList.remove('open');
    if (drawer) drawer.setAttribute('aria-hidden', 'true');
    if (bd) bd.hidden = true;
    if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
  }

  if (backBtn) backBtn.addEventListener('click', () => {
    closeDrawerSafe();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  if (closeBtn) closeBtn.addEventListener('click', closeDrawerSafe);
  if (backdrop) backdrop.addEventListener('click', closeDrawerSafe);

  document.addEventListener('keydown', (e) => {
    const drawer = document.getElementById('cartDrawer');
    if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) closeDrawerSafe();
  });
});

// =========================
// ✅ Checkout wiring (frontend only)
// =========================
window.proceedToCheckout = async function proceedToCheckout(cartPayload) {
  let items = [];

  try {
    if (Array.isArray(cartPayload)) {
      items = cartPayload;
    } else if (cartPayload && Array.isArray(cartPayload.items)) {
      items = cartPayload.items;
    } else if (window.Cart && typeof window.Cart.getCart === 'function') {
      const c = window.Cart.getCart();
      if (c && Array.isArray(c.items)) items = c.items;
    }
  } catch (_) {}

  if (!items.length) {
    alert('Il carrello è vuoto');
    return;
  }

  const formatoEl = document.querySelector('select[name="formato"], #formato');
  const formato = formatoEl ? formatoEl.value : undefined;

  const btns = [
    document.getElementById('cartCheckoutBtn'),
    document.getElementById('cartCheckoutBtnTop')
  ].filter(Boolean);
  btns.forEach((b) => {
    b.disabled = true;
  });

  try {
    const res = await fetch('/.netlify/functions/ordine-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, formato })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('ordine-ai error:', res.status, data);
      alert(`Errore checkout (${res.status}). Controlla console.`);
      return;
    }

    const url =
      data.url ||
      data.checkoutUrl ||
      data.checkout_url ||
      data.sessionUrl ||
      data.session_url;

    if (!url) {
      console.error('ordine-ai response without url:', data);
      alert('Checkout: risposta senza URL. Controlla console.');
      return;
    }

    window.location.href = url;
  } catch (err) {
    console.error('checkout exception:', err);
    alert('Errore rete/JS durante il checkout. Controlla console.');
  } finally {
    btns.forEach((b) => {
      b.disabled = false;
    });
  }
};
