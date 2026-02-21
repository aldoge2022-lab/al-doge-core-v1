(function (global) {
  const catalog = {
    doughs: {
      normale: { label: 'Normale', surcharge_cents: 0 },
      kamut: { label: 'Kamut', surcharge_cents: 200 }
    },
    extras: {
      burrata: { label: 'Burrata', price_cents: 150 }
    },
    cover_charge_cents: 200,
    menu: [
      { id: 'margherita', name: 'Pizza Margherita', base_price_cents: 700, active: true, tags: ['classica'] },
      { id: 'diavola', name: 'Pizza Diavola', base_price_cents: 850, active: true, tags: ['piccante'] }
    ],
    drinks: [
      { id: 'birra-05', name: 'Birra 0.5L', price_cents: 500, active: true },
      { id: 'acqua-05', name: 'Acqua 0.5L', price_cents: 150, active: true }
    ]
  };

  catalog.size_engine = {
    default: 'normale',
    options: catalog.doughs
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = catalog;
  }
  global.ALDOGE_CATALOG = catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
