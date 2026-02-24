const fs = require('fs');
const path = require('path');

const FOOD_CORE_CANDIDATES = [
  path.resolve(__dirname, './food-core.json'),
  path.resolve(__dirname, '../food-core.json'),
  path.resolve(__dirname, '../../data/food-core.json')
];

function getFoodCore() {
  const existingPath = FOOD_CORE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  return existingPath ? require(existingPath) : {};
}

function getIngredients() {
  const foodCore = getFoodCore();
  return Array.isArray(foodCore?.ingredients) ? foodCore.ingredients : [];
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getIngredientById(ingredientId) {
  return getIngredients().find((ingredient) => ingredient?.id === ingredientId) || null;
}

function validateIngredientIds(ingredientIds) {
  if (!Array.isArray(ingredientIds)) {
    return false;
  }

  const normalized = ingredientIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (normalized.length !== ingredientIds.length) {
    return false;
  }

  const uniqueIds = new Set(normalized);
  if (uniqueIds.size !== normalized.length) {
    return false;
  }

  return normalized.every((id) => Boolean(getIngredientById(id)));
}

function calculateSupplements(ingredientIds) {
  if (!Array.isArray(ingredientIds)) {
    return 0;
  }

  return ingredientIds.reduce((total, ingredientId) => {
    const ingredient = getIngredientById(ingredientId);
    return total + toNumber(
      ingredient?.supplement ??
      ingredient?.supplementPrice ??
      ingredient?.extraPrice ??
      ingredient?.price ??
      0
    );
  }, 0);
}

function calculateAllergens(ingredientIds) {
  if (!Array.isArray(ingredientIds)) {
    return [];
  }

  const allergens = ingredientIds.flatMap((ingredientId) => {
    const ingredient = getIngredientById(ingredientId);
    return Array.isArray(ingredient?.allergens) ? ingredient.allergens : [];
  });

  return Array.from(new Set(allergens));
}

module.exports = {
  validateIngredientIds,
  calculateSupplements,
  calculateAllergens,
  getIngredientById
};
