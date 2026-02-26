const { getIngredientById } = require('../menu/food-engine');

const MAX_INGREDIENTS = 7;

function validatePaninoIngredientIds(ids = []) {
  if (!Array.isArray(ids)) return { valid: false, reason: 'Invalid input' };

  const unique = [...new Set(ids.map(id => String(id).trim()))];

  if (unique.length > MAX_INGREDIENTS) {
    return { valid: false, reason: 'Max ingredients exceeded' };
  }

  for (const id of unique) {
    const ingredient = getIngredientById(id);
    if (!ingredient) {
      return { valid: false, reason: `Ingredient not found: ${id}` };
    }

    if (ingredient.paninoAllowed !== true) {
      return { valid: false, reason: `Ingredient not allowed in panino: ${id}` };
    }

    const allergens = Array.isArray(ingredient.allergens) ? ingredient.allergens : [];
    if (allergens.some(a => String(a).toLowerCase().includes('pesce'))) {
      return { valid: false, reason: `Fish ingredient blocked: ${id}` };
    }
  }

  return { valid: true, ids: unique };
}

module.exports = {
  MAX_INGREDIENTS,
  validatePaninoIngredientIds
};
