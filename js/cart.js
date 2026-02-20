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
      return cart;
    }
  };

  window.Cart = Cart;
})();
