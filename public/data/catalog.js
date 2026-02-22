/apply-patch <<'PATCH'
*** Begin Patch
*** Add File: public/data/catalog.js
+// public/data/catalog.js
+// Catalogo normalizzato: garantisce che ogni item abbia i campi minimi richiesti dal checkout.
+
+const normalizeItem = (item) => ({
+  id: item.id,
+  name: item.name,
+  type: item.type || 'generic',
+  price: Number(item.price) || 0,
+  size: item.size || 'standard',
+  dough: item.dough || null,
+  ingredients: Array.isArray(item.ingredients) ? item.ingredients : [],
+  tags: Array.isArray(item.tags) ? item.tags : [],
+  extraPrice: Number(item.extraPrice) || 0,
+  ...Object.keys(item).reduce((acc, k) => {
+    if (!['id','name','type','price','size','dough','ingredients','tags','extraPrice'].includes(k)) {
+      acc[k] = item[k];
+    }
+    return acc;
+  }, {})
+});
+
+let catalog = {
+  pizzas: [
+    {
+      id: 'margherita',
+      name: 'Margherita',
+      price: 600,
+      type: 'pizza',
+      ingredients: ['pomodoro', 'mozzarella'],
+      tags: ['classica']
+    },
+    {
+      id: 'diavola',
+      name: 'Diavola',
+      price: 700,
+      type: 'pizza',
+      ingredients: ['pomodoro', 'mozzarella', 'salame piccante'],
+      tags: ['piccante']
+    },
+    {
+      id: 'quattro-formaggi',
+      name: 'Quattro Formaggi',
+      price: 800,
+      type: 'pizza',
+      ingredients: ['mozzarella', 'gorgonzola', 'parmigiano', 'provola'],
+      tags: ['formaggi']
+    }
+  ],
+  drinks: [
+    {
+      id: 'acqua-05',
+      name: 'Acqua 0.5L',
+      price: 150,
+      type: 'drink'
+    },
+    {
+      id: 'birra-05',
+      name: 'Birra 0.5L',
+      price: 500,
+      type: 'drink'
+    }
+  ],
+  extras: [
+    {
+      id: 'extra-olio',
+      name: 'Olio extra',
+      price: 50,
+      type: 'extra'
+    }
+  ]
+};
+
+Object.keys(catalog || {}).forEach((section) => {
+  if (Array.isArray(catalog[section])) {
+    catalog[section] = catalog[section].map(normalizeItem);
+  }
+});
+
+module.exports = catalog;
+
*** End Patch
PATCH
