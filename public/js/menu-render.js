(function () {
  const state = {
    data: {
      menu: [],
      drinks: [],
      extras: {},
      doughs: { normale: { surcharge_cents: 0 } },
      size_engine: {
        default: 'normale',
        options: {
          normale: { label: 'Normale', surcharge_cents: 0 }
        }
      }
    },
    size: 'normale'
  };
  window.ALDOGE_CATALOG = state.data;

  function formatCents(cents) {
    return '€ ' + (cents / 100).toFixed(2);
  }

  function currentSurcharge() {
    return state.data.size_engine.options[state.size].surcharge_cents;
  }

  function finalPrice(basePriceCents) {
    return basePriceCents + currentSurcharge();
  }

  function renderMenu() {
    const menuContainer = document.getElementById('menu');
    const totalSurcharge = currentSurcharge();

    menuContainer.innerHTML = '';

    state.data.menu
      .filter((product) => product.active)
      .forEach((product) => {
        const finalPriceCents = finalPrice(product.base_price_cents);
        const item = document.createElement('div');
        item.setAttribute('data-product-id', product.id);
        item.innerHTML =
          '<strong>' + product.name + '</strong> - ' + formatCents(finalPriceCents) +
          ' <button type="button" data-add-id="' + product.id + '">Aggiungi</button>';
        menuContainer.appendChild(item);
      });

    document.getElementById('size-surcharge').textContent = formatCents(totalSurcharge);
    bindAddButtons();
  }

  function renderSizeSelector() {
    const sizeSelect = document.getElementById('size-select');
    const options = state.data.size_engine.options;
    sizeSelect.innerHTML = '';

    Object.keys(options).forEach((key) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = options[key].label;
      option.selected = key === state.size;
      sizeSelect.appendChild(option);
    });

    sizeSelect.addEventListener('change', function (event) {
      state.size = event.target.value;
      renderMenu();
    });
  }

  function bindAddButtons() {
    document.querySelectorAll('[data-add-id]').forEach((button) => {
      button.onclick = function () {
        const product = state.data.menu.find((entry) => entry.id === button.getAttribute('data-add-id'));
        Cart.addItem({
          type: 'pizza',
          id: product.id,
          dough: state.size,
          extras: [],
          quantity: 1
        });
        window.dispatchEvent(new CustomEvent('product-added', { detail: { type: 'pizza', id: product.id } }));
      };
    });
  }

  function isMenuUnavailable(menu) {
    return !menu || !Array.isArray(menu.menu) || menu.menu.length === 0;
  }

  function toCatalogItem(item, type) {
    const price = Number(item.prezzo);
    return {
      id: String(item.id),
      name: String(item.nome),
      type,
      active: true,
      base_price_cents: Number.isFinite(price) ? Math.round(price * 100) : 0
    };
  }

  async function loadMenu() {
    const response = await fetch('/.netlify/functions/api-menu');
    if (!response.ok) throw new Error('Menu fetch failed');
    const payload = await response.json();

    state.data.menu = [
      ...(Array.isArray(payload.pizze) ? payload.pizze : []).map((item) => toCatalogItem(item, 'pizza')),
      ...(Array.isArray(payload.panini) ? payload.panini : []).map((item) => toCatalogItem(item, 'pizza'))
    ];
    state.data.drinks = (Array.isArray(payload.bevande) ? payload.bevande : []).map((item) => toCatalogItem(item, 'drink'));
    state.data.extras = {};
    state.data.doughs = { normale: { surcharge_cents: 0 } };
    state.data.size_engine = {
      default: 'normale',
      options: {
        normale: { label: 'Normale', surcharge_cents: 0 }
      }
    };
    state.size = state.data.size_engine.default;
  }

  loadMenu()
    .then(() => {
      if (isMenuUnavailable(state.data)) {
        document.getElementById('menu').textContent = 'Errore nel caricamento del menu';
        return;
      }
      renderSizeSelector();
      renderMenu();
    })
    .catch(() => {
      document.getElementById('menu').textContent = 'Errore nel caricamento del menu';
    });
})();
