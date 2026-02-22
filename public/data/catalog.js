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
      {
        id: 'margherita',
        name: 'Margherita',
        base_price_cents: 600,
        ingredienti: ['pomodoro', 'mozzarella'],
        tag: ['classica', 'leggera'],
        active: true
      },
      {
        id: 'diavola',
        name: 'Diavola',
        base_price_cents: 700,
        ingredienti: ['pomodoro', 'mozzarella', 'salame piccante'],
        tag: ['forte', 'piccante'],
        active: true
      },
      {
        id: 'capricciosa',
        name: 'Capricciosa',
        base_price_cents: 800,
        ingredienti: ['pomodoro', 'mozzarella', 'prosciutto', 'funghi', 'carciofi'],
        tag: ['corposa'],
        active: true
      },
      {
        id: 'quattro-stagioni',
        name: 'Quattro Stagioni',
        base_price_cents: 800,
        ingredienti: ['pomodoro', 'mozzarella', 'funghi', 'carciofi', 'olive', 'prosciutto'],
        tag: ['corposa'],
        active: true
      },
      {
        id: 'quattro-formaggi',
        name: 'Quattro Formaggi',
        base_price_cents: 800,
        ingredienti: ['mozzarella', 'gorgonzola', 'grana', 'fontina'],
        tag: ['gourmet'],
        active: true
      },
      {
        id: 'prosciutto',
        name: 'Prosciutto',
        base_price_cents: 700,
        ingredienti: ['pomodoro', 'mozzarella', 'prosciutto'],
        tag: ['classica'],
        active: true
      },
      {
        id: 'tonno',
        name: 'Tonno',
        base_price_cents: 700,
        ingredienti: ['pomodoro', 'mozzarella', 'tonno'],
        tag: ['mare'],
        active: true
      },
      {
        id: 'vegetariana',
        name: 'Vegetariana',
        base_price_cents: 700,
        ingredienti: ['pomodoro', 'mozzarella', 'zucchine', 'melanzane', 'peperoni'],
        tag: ['vegetariana', 'leggera'],
        active: true
      },
      {
        id: 'bufala',
        name: 'Bufala',
        base_price_cents: 900,
        ingredienti: ['pomodoro', 'mozzarella di bufala'],
        tag: ['gourmet', 'leggera'],
        active: true
      },
      {
        id: 'boscaiola',
        name: 'Boscaiola',
        base_price_cents: 800,
        ingredienti: ['mozzarella', 'salsiccia', 'funghi'],
        tag: ['corposa'],
        active: true
      }
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
  } else {
    global.ALDOGE_CATALOG = catalog;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
