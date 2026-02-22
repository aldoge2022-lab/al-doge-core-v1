// public/data/catalog.js
// Catalogo normalizzato: garantisce che ogni item abbia i campi minimi richiesti dal checkout.

const NORMALIZED_KEYS = new Set(['id', 'name', 'type', 'price', 'size', 'dough', 'ingredients', 'tags', 'extraPrice']);

const normalizeItem = (item) => ({
  id: item.id,
  name: item.name,
  type: item.type || 'generic',
  // Prezzo memorizzato in centesimi come number (es. €6.00 -> 600)
  price: Number(item.price) || 0,
  // Formato/size (utile per pizze e fallback per bevande)
  size: item.size || 'standard',
  // Campi opzionali ma richiesti dalla validazione del checkout
  dough: item.dough || null,
  ingredients: Array.isArray(item.ingredients) ? item.ingredients : [],
  tags: Array.isArray(item.tags) ? item.tags : [],
  extraPrice: Number(item.extraPrice) || 0,
  // Qualsiasi campo extra viene preservato
  ...Object.keys(item).reduce((acc, k) => {
    if (!NORMALIZED_KEYS.has(k)) {
      acc[k] = item[k];
    }
    return acc;
  }, {})
});

// Definizione iniziale del catalogo (esempi reali; mantieni o estendi con i tuoi item)
let catalog = {
  pizzas: [
    {
      id: 'margherita',
      name: 'Margherita',
      price: 600,
      type: 'pizza',
      ingredients: ['pomodoro', 'mozzarella'],
      tags: ['classica']
    },
    {
      id: 'diavola',
      name: 'Diavola',
      price: 700,
      type: 'pizza',
      ingredients: ['pomodoro', 'mozzarella', 'salame piccante'],
      tags: ['piccante']
    },
    {
      id: 'quattro-formaggi',
      name: 'Quattro Formaggi',
      price: 800,
      type: 'pizza',
      ingredients: ['mozzarella', 'gorgonzola', 'parmigiano', 'provola'],
      tags: ['formaggi']
    },
    {
      id: 'bufala',
      name: 'Bufala',
      price: 900,
      type: 'pizza',
      ingredients: ['pomodoro', 'mozzarella di bufala'],
      tags: ['gourmet', 'leggera']
    }
  ],
  drinks: [
    {
      id: 'acqua-05',
      name: 'Acqua 0.5L',
      price: 150,
      type: 'drink'
    },
    {
      id: 'birra-05',
      name: 'Birra 0.5L',
      price: 500,
      type: 'drink'
    }
  ],
  extras: [
    {
      id: 'extra-olio',
      name: 'Olio extra',
      price: 50,
      type: 'extra'
    }
  ]
};

// Normalizza ogni sezione del catalogo per assicurare forma coerente
Object.keys(catalog || {}).forEach((section) => {
  if (Array.isArray(catalog[section])) {
    catalog[section] = catalog[section].map(normalizeItem);
  }
});

// Compatibilità retroattiva per le funzioni server che leggono la struttura legacy.
catalog.menu = (catalog.pizzas || []).map((item) => ({
  ...item,
  ingredienti: item.ingredients,
  tag: item.tags,
  base_price_cents: Number(item.price) || 0,
  active: true
}));

catalog.drinks = (catalog.drinks || []).map((item) => ({
  ...item,
  price_cents: Number(item.price) || 0,
  active: true
}));

catalog.doughs = {
  normale: { label: 'Normale', surcharge_cents: 0 },
  kamut: { label: 'Kamut', surcharge_cents: 200 }
};

catalog.size_engine = {
  default: 'normale',
  options: catalog.doughs
};

module.exports = catalog;
