(function () {
  const STORAGE_KEY = 'al_doge_cart_v1';
  const CART_UPDATED_EVENT = 'al-doge-cart-updated';

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

  function formatCents(cents) {
    return '€ ' + (cents / 100).toFixed(2);
  }

  function renderCartUI(cart) {
    const cartItemsEl = document.getElementById('cart-items');
    const cartTotalEl = document.getElementById('cart-total');
    const cartEmptyEl = document.getElementById('cart-empty');

    if (!cartItemsEl || !cartTotalEl || !cartEmptyEl) {
      return;
    }

    cartItemsEl.innerHTML = '';
    const hasItems = cart.items.length > 0;
    cartEmptyEl.style.display = hasItems ? 'none' : 'block';

    let totalCents = 0;
    cart.items.forEach((item) => {
      totalCents += item.unit_price_cents * item.quantity;
      const li = document.createElement('li');
      li.textContent = item.quantity + 'x ' + item.name + ' (' + item.size + ') - ' + formatCents(item.unit_price_cents * item.quantity);
      cartItemsEl.appendChild(li);
    });

    cartTotalEl.textContent = 'Totale: ' + formatCents(totalCents);
  }

  function initCartUI() {
    if (typeof window === 'undefined' || !window.document) {
      return;
    }

    renderCartUI(read());
    window.addEventListener(CART_UPDATED_EVENT, function () {
      renderCartUI(read());
    });
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(CART_UPDATED_EVENT));
      }
      return cart;
    }
  };

  window.Cart = Cart;
  initCartUI();
})();
