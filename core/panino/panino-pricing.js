const { getIngredientById } = require('../menu/food-engine');

const BASE_PRICE = 8.5;
const INCLUDED = 3;

function calculatePaninoPrice(ids = []) {
  const ingredients = ids.map(id => getIngredientById(id)).filter(Boolean);

  const extras = ingredients.slice(INCLUDED);

  const extraCharge = extras.reduce((total, ingredient) => {
    return total + Number(ingredient.supplement || 0);
  }, 0);

  const total = Number((BASE_PRICE + extraCharge).toFixed(2));

  return {
    basePrice: BASE_PRICE,
    includedCount: Math.min(INCLUDED, ingredients.length),
    extraCount: extras.length,
    extraCharge: Number(extraCharge.toFixed(2)),
    total
  };
}

module.exports = {
  BASE_PRICE,
  INCLUDED,
  calculatePaninoPrice
};
