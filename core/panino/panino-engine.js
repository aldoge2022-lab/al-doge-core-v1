const { validatePaninoIngredientIds } = require('./panino-validator');
const { calculatePaninoPrice } = require('./panino-pricing');

function buildPanino(ingredientIds = []) {
  const validation = validatePaninoIngredientIds(ingredientIds);

  if (!validation.valid) {
    return {
      ok: false,
      error: validation.reason
    };
  }

  const pricing = calculatePaninoPrice(validation.ids);

  return {
    ok: true,
    ingredientIds: validation.ids,
    pricing
  };
}

module.exports = {
  buildPanino
};
