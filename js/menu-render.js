(function () {
  const state = {
    data: null,
    size: null
  };

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
          id: product.id,
          name: product.name,
          size: state.size,
          unit_price_cents: finalPrice(product.base_price_cents)
        });
      };
    });
  }

  fetch('data/menu.json')
    .then((response) => response.json())
    .then((data) => {
      state.data = data;
      state.size = data.size_engine.default;
      renderSizeSelector();
      renderMenu();
    })
    .catch(function (error) {
      console.error(error);
      document.getElementById('menu').textContent = 'Errore nel caricamento del menu';
    });
})();
