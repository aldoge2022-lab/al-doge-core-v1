const { buildItem, dedupe } = require('./build-item');
const { getIngredients } = require('../../../core/menu/food-engine');

const DEFAULT_INGREDIENTS = [
  { nome: 'pomodoro', categoria_tecnica: 'salsa', prezzo_extra: 1, allergeni: [] },
  { nome: 'mozzarella', categoria_tecnica: 'latticini', prezzo_extra: 3, allergeni: ['lattosio'] },
  { nome: 'basilico', categoria_tecnica: 'verdura', prezzo_extra: 1.5, allergeni: [] },
  { nome: 'tonno', categoria_tecnica: 'pesce', prezzo_extra: 2.5, allergeni: ['pesce'] },
  { nome: 'burrata', categoria_tecnica: 'latticini', prezzo_extra: 3, allergeni: ['lattosio'] },
  { nome: 'insalata', categoria_tecnica: 'verdura', prezzo_extra: 1.5, allergeni: [] }
];

const DEFAULT_IMPASTI = {
  normale: 0,
  kamut: 1.5
};

function fromMenu(menu = []) {
  const allIngredients = dedupe(menu.flatMap((item) => (Array.isArray(item?.ingredienti) ? item.ingredienti : [])));
  if (!allIngredients.length) return DEFAULT_INGREDIENTS;

  return allIngredients.map((nome) => {
    const lower = nome.toLowerCase();
    if (lower.includes('tonno')) {
      return { nome, categoria_tecnica: 'pesce', prezzo_extra: 2.5, allergeni: ['pesce'] };
    }
    if (lower.includes('burrata') || lower.includes('mozzarella') || lower.includes('bufala')) {
      return { nome, categoria_tecnica: 'latticini', prezzo_extra: 3, allergeni: ['lattosio'] };
    }
    return { nome, categoria_tecnica: 'verdura', prezzo_extra: 1.5, allergeni: [] };
  });
}

function generatePizza({ richiesta, menu }) {
  const available = dedupe((menu || []).flatMap((item) => item.ingredienti || []));
  const ingredienti = available.slice(0, 3);
  const built = buildItem({
    payload: {
      custom: true,
      categoria: 'pizza',
      ingredienti
    },
    ingredientiTable: fromMenu(menu),
    impasti: DEFAULT_IMPASTI
  });

  const details = built.statusCode === 200 ? built.body : { prezzo: 5, ingredienti: [] };
  return {
    nome: 'Pizza Personalizzata',
    ingredienti: details.ingredienti,
    prezzo: details.prezzo
  };
}

function generatePanino({ richiesta, menu }) {
  const allowedPaninoIngredients = getIngredients()
    .filter((ingredient) => ingredient?.paninoAllowed === true)
    .filter((ingredient) => {
      const allergens = Array.isArray(ingredient?.allergens) ? ingredient.allergens : [];
      return !allergens.some((value) => String(value).toLowerCase().includes('pesce'));
    });
  const allowedPaninoIds = allowedPaninoIngredients
    .map((ingredient) => String(ingredient.id || '').trim().toLowerCase())
    .filter(Boolean);

  const allowedPaninoSet = new Set(allowedPaninoIds);
  const normalizedRequest = String(richiesta || '').toLowerCase();
  const requestedAllowedIds = allowedPaninoIngredients
    .filter((ingredient) => {
      const id = String(ingredient.id || '').toLowerCase();
      const name = String(ingredient.name || '').toLowerCase();
      return (id && normalizedRequest.includes(id)) || (name && normalizedRequest.includes(name));
    })
    .map((ingredient) => String(ingredient.id || '').toLowerCase())
    .filter((id) => allowedPaninoSet.has(id));

  const available = dedupe((menu || []).flatMap((item) => item.ingredienti || []))
    .map((value) => String(value).toLowerCase())
    .filter((value) => allowedPaninoSet.has(value));
  const prioritizedRequested = requestedAllowedIds.filter((id) => available.includes(id));
  const fallbackPool = available.length ? available : allowedPaninoIds;
  const ingredienti = dedupe([...prioritizedRequested, ...fallbackPool]).slice(0, 4);
  const ingredientiTable = dedupe([
    ...fromMenu(menu).map((ingredient) => ingredient.nome),
    ...allowedPaninoIds
  ]).map((nome) => {
    const metadata = allowedPaninoIngredients.find((ingredient) => String(ingredient.id || '').toLowerCase() === nome);
    if (metadata) {
      return {
        nome,
        categoria_tecnica: 'verdura',
        prezzo_extra: Number(metadata.supplement || 0),
        allergeni: Array.isArray(metadata.allergens) ? metadata.allergens : []
      };
    }
    const fromCatalog = fromMenu(menu).find((ingredient) => ingredient.nome === nome);
    return fromCatalog || { nome, categoria_tecnica: 'verdura', prezzo_extra: 1.5, allergeni: [] };
  });

  const built = buildItem({
    payload: {
      custom: true,
      categoria: 'panino',
      ingredienti
    },
    ingredientiTable,
    impasti: DEFAULT_IMPASTI
  });

  const details = built.statusCode === 200 ? built.body : { prezzo: 5, ingredienti: [] };
  return {
    nome: 'Panino Personalizzato',
    ingredienti: details.ingredienti,
    prezzo: details.prezzo
  };
}

module.exports = {
  buildItem,
  generatePizza,
  generatePanino
};
