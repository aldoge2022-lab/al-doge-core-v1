const { VALID_INGREDIENTS, normalizeIngredientId } = require('../schemas/orderSchemas');

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractValidIngredients(text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return [];
  }

  const found = new Set();

  VALID_INGREDIENTS.forEach((ingredient) => {
    const normalizedIngredient = normalizeIngredientId(ingredient);
    if (!normalizedIngredient) {
      return;
    }

    const escaped = normalizedIngredient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
    if (pattern.test(normalizedText)) {
      found.add(normalizedIngredient);
    }
  });

  return Array.from(found);
}

module.exports = {
  extractValidIngredients
};
