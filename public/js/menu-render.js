(function () {
  const CATEGORY_ORDER = ['classiche', 'speciali', 'verdure', 'pesce', 'bianche'];
  const CATEGORY_LABELS = {
    classiche: 'Classiche',
    speciali: 'Speciali',
    verdure: 'Verdure',
    pesce: 'Pesce',
    bianche: 'Bianche'
  };

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

  function isCategorySlug(value) {
    return CATEGORY_ORDER.includes(value);
  }

  function normalizeCategory(rawCategory, tags) {
    if (isCategorySlug(rawCategory)) return rawCategory;
    const normalizedTags = Array.isArray(tags)
      ? tags.map((tag) => String(tag).toLowerCase().trim())
      : [];

    if (normalizedTags.includes('classiche') || normalizedTags.includes('classica')) return 'classiche';
    if (normalizedTags.includes('speciali') || normalizedTags.includes('speciale')) return 'speciali';
    if (normalizedTags.includes('verdure') || normalizedTags.includes('vegetariana') || normalizedTags.includes('vegetariano')) return 'verdure';
    if (normalizedTags.includes('pesce')) return 'pesce';
    if (normalizedTags.includes('bianche') || normalizedTags.includes('bianca')) return 'bianche';
    return 'classiche';
  }

  function getCurrentCategoryFromPath() {
    const match = window.location.pathname.match(/^\/menu\/([^/]+)\/?$/);
    const slug = match ? match[1].toLowerCase() : null;
    return isCategorySlug(slug) ? slug : null;
  }

  function getVisiblePizzas() {
    return state.data.menu.filter((product) => product.active && product.type === 'pizza' && product.disponibile !== false);
  }

  function ingredientiPreview(ingredienti) {
    if (!Array.isArray(ingredienti)) return '';
    return ingredienti.slice(0, 4).join(', ');
  }

  function createPizzaCard(product) {
    const finalPriceCents = finalPrice(product.base_price_cents);
    const item = document.createElement('article');
    item.className = 'product-card';
    item.setAttribute('data-product-id', product.id);
    item.innerHTML =
      '<div class="product-card-head">' +
        '<h3 class="product-card-title">' + product.name + '</h3>' +
        '<div class="product-card-price">' + formatCents(finalPriceCents) + '</div>' +
      '</div>' +
      '<p class="product-card-ingredients">' + ingredientiPreview(product.ingredienti) + '</p>' +
      '<button type="button" class="product-card-add" data-add-id="' + product.id + '">Aggiungi</button>';
    return item;
  }

  function createCategoryHeader(slug, showLink) {
    const wrapper = document.createElement('div');
    wrapper.className = 'category-header';

    const title = document.createElement('h2');
    title.className = 'category-title';
    title.textContent = '🍕 Pizze ' + CATEGORY_LABELS[slug];
    wrapper.appendChild(title);

    if (showLink) {
      const link = document.createElement('a');
      link.className = 'category-link';
      link.href = '/menu/' + slug;
      link.textContent = 'Vedi tutte le ' + CATEGORY_LABELS[slug];
      wrapper.appendChild(link);
    }

    return wrapper;
  }

  function sortByName(items) {
    return [...items].sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
  }

  function setSeoForHome() {
    document.title = 'Menu Pizze | AL DOGE';
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute('content', 'Scopri le migliori pizze AL DOGE: classiche, speciali, verdure, pesce e bianche.');
    }
  }

  function setSeoForCategory(slug) {
    const label = CATEGORY_LABELS[slug];
    document.title = 'Pizze ' + label + ' | AL DOGE';
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute('content', 'Scopri tutte le pizze ' + label.toLowerCase() + ' di AL DOGE con ingredienti selezionati e qualità artigianale.');
    }
  }

  function renderHomeMenu() {
    const menuContainer = document.getElementById('menu');
    const totalSurcharge = currentSurcharge();
    menuContainer.innerHTML = '';

    const pizzas = getVisiblePizzas();
    CATEGORY_ORDER.forEach((slug) => {
      const categoryItems = sortByName(pizzas.filter((pizza) => pizza.categoria === slug)).slice(0, 3);
      if (categoryItems.length === 0) return;

      const section = document.createElement('section');
      section.className = 'category-section';
      section.appendChild(createCategoryHeader(slug, true));

      const grid = document.createElement('div');
      grid.className = 'category-grid';
      categoryItems.forEach((product) => grid.appendChild(createPizzaCard(product)));
      section.appendChild(grid);

      menuContainer.appendChild(section);
    });

    document.getElementById('size-surcharge').textContent = formatCents(totalSurcharge);
    setSeoForHome();
    bindAddButtons();
  }

  function renderCategoryPage(slug) {
    const menuContainer = document.getElementById('menu');
    const totalSurcharge = currentSurcharge();
    menuContainer.innerHTML = '';

    const section = document.createElement('section');
    section.className = 'category-section';
    section.appendChild(createCategoryHeader(slug, false));

    const categoryItems = sortByName(getVisiblePizzas().filter((pizza) => pizza.categoria === slug));
    const grid = document.createElement('div');
    grid.className = 'category-grid';
    categoryItems.forEach((product) => grid.appendChild(createPizzaCard(product)));
    section.appendChild(grid);

    const backLink = document.createElement('a');
    backLink.className = 'category-link category-back';
    backLink.href = '/';
    backLink.textContent = '← Torna al menu completo';
    section.appendChild(backLink);

    menuContainer.appendChild(section);

    document.getElementById('size-surcharge').textContent = formatCents(totalSurcharge);
    setSeoForCategory(slug);
    bindAddButtons();
  }

  function renderMenu() {
    const currentCategory = getCurrentCategoryFromPath();
    if (currentCategory) {
      renderCategoryPage(currentCategory);
      return;
    }
    renderHomeMenu();
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
    const priceCents = Number(item.prezzo_cents);
    return {
      id: String(item.id),
      name: String(item.nome),
      type,
      categoria: normalizeCategory(String(item.categoria || '').toLowerCase(), item.tag),
      disponibile: item.disponibile !== false,
      ingredienti: Array.isArray(item.ingredienti) ? item.ingredienti : [],
      active: item.disponibile !== false,
      base_price_cents: Number.isInteger(priceCents) ? priceCents : 0
    };
  }

  async function loadMenu() {
    const response = await fetch('/.netlify/functions/api-menu');
    if (!response.ok) throw new Error('Menu fetch failed');
    const payload = await response.json();

    state.data.menu = (Array.isArray(payload.pizze) ? payload.pizze : []).map((item) => toCatalogItem(item, 'pizza'));
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
