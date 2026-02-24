const fs = require('fs');
const path = require('path');
const {
  getIngredientById,
  calculateSupplements,
  calculateAllergens,
  validateIngredientIds
} = require('./food-engine');

const FOOD_CORE_CANDIDATES = [
  path.resolve(__dirname, './food-core.json'),
  path.resolve(__dirname, '../food-core.json'),
  path.resolve(__dirname, '../../data/food-core.json')
];

const DEFAULT_IMPASTO = 'classico';
const DEFAULT_MOZZARELLA = 'classica';

function getFoodCore() {
  const existingPath = FOOD_CORE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return existingPath ? require(existingPath) : {};
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function capitalize(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function getOptionFromCore(foodCore, categoryKeys, optionId) {
  for (const categoryKey of categoryKeys) {
    const category = foodCore?.[categoryKey];

    if (Array.isArray(category)) {
      const found = category.find((item) => item?.id === optionId || item?.key === optionId || item?.slug === optionId);
      if (found) {
        return found;
      }
    }

    if (category && typeof category === 'object' && !Array.isArray(category)) {
      if (category[optionId]) {
        return category[optionId];
      }
    }
  }

  return null;
}

function extractSupplement(option) {
  if (!option || typeof option !== 'object') {
    return 0;
  }

  return toNumber(
    option.supplement ??
    option.supplementPrice ??
    option.extraPrice ??
    option.surcharge ??
    option.surcharge_cents ??
    option.price ??
    0
  );
}

function extractAllergens(option) {
  if (!option || typeof option !== 'object') {
    return [];
  }

  const allergens = option.allergens ?? option.allergeni;
  return Array.isArray(allergens) ? allergens : [];
}

function createCustomPanino({
  ingredientIds,
  impasto = DEFAULT_IMPASTO,
  mozzarella = DEFAULT_MOZZARELLA
}) {
  const isValid = validateIngredientIds(ingredientIds);
  if (!isValid) {
    throw new Error('Invalid ingredientIds provided for custom panino');
  }

  const foodCore = getFoodCore();

  const ingredientSupplements = toNumber(calculateSupplements(ingredientIds));

  const impastoOption = impasto !== DEFAULT_IMPASTO
    ? getOptionFromCore(foodCore, ['impasti', 'doughs', 'impasto'], impasto)
    : null;
  if (impasto !== DEFAULT_IMPASTO && !impastoOption) {
    throw new Error('Invalid impasto option');
  }
  const impastoSupplement = impasto !== DEFAULT_IMPASTO ? extractSupplement(impastoOption) : 0;

  const mozzarellaOption = mozzarella !== DEFAULT_MOZZARELLA
    ? getOptionFromCore(foodCore, ['mozzarelle', 'mozzarella'], mozzarella)
    : null;
  if (mozzarella !== DEFAULT_MOZZARELLA && !mozzarellaOption) {
    throw new Error('Invalid mozzarella option');
  }
  const mozzarellaSupplement = mozzarella !== DEFAULT_MOZZARELLA ? extractSupplement(mozzarellaOption) : 0;

  const ingredientAllergens = calculateAllergens(ingredientIds);
  const allergens = [
    ...(Array.isArray(ingredientAllergens) ? ingredientAllergens : []),
    ...extractAllergens(impastoOption),
    ...extractAllergens(mozzarellaOption)
  ];

  const uniqueAllergens = Array.from(new Set(allergens));

  const readableIngredients = ingredientIds
    .slice(0, 3)
    .map((ingredientId) => getIngredientById(ingredientId)?.name || ingredientId);

  const hasMoreThanThree = ingredientIds.length > 3;
  const ingredientsLabel = `${readableIngredients.join(', ')}${hasMoreThanThree ? ', ...' : ''}`;
  const impastoSuffix = impasto !== DEFAULT_IMPASTO ? ` (${capitalize(impasto)})` : '';
  const displayName = `Panino Custom AL DOGE – ${ingredientsLabel}${impastoSuffix}`;

  const basePrice = 0;
  const supplementsTotal = ingredientSupplements + impastoSupplement + mozzarellaSupplement;
  const totalPrice = basePrice + supplementsTotal;

  return {
    id: 'panino_custom_al_doge',
    type: 'custom_panino',
    displayName,
    ingredientIds,
    impasto,
    mozzarella,
    supplementsTotal,
    totalPrice,
    allergens: uniqueAllergens
  };
}

module.exports = {
  createCustomPanino
};
