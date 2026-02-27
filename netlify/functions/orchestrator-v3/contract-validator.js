const FALLBACK_RESPONSE = Object.freeze({
  ok: false,
  cartUpdates: [],
  reply: 'Errore interno sistema ordine.'
});

function isValidCartUpdate(item) {
  return Boolean(
    item &&
    typeof item === 'object' &&
    typeof item.type === 'string' &&
    item.type.trim() &&
    typeof item.qty === 'number' &&
    Number.isFinite(item.qty) &&
    item.qty > 0
  );
}

function normalizeReply(reply) {
  if (typeof reply !== 'string') {
    return '';
  }

  return reply.trim();
}

function validateResponse(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'object') {
    return { ...FALLBACK_RESPONSE };
  }

  const ok = rawResponse.ok === true;
  const normalizedReply = normalizeReply(rawResponse.reply);
  const hasNullCartUpdatesOnSuccess = ok && rawResponse.cartUpdates == null;
  const normalizedCartUpdates = Array.isArray(rawResponse.cartUpdates)
    ? rawResponse.cartUpdates
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }

          const qty = Number(item.qty);
          return {
            ...item,
            type: typeof item.type === 'string' ? item.type.trim() : item.type,
            qty
          };
        })
        .filter(Boolean)
    : [];

  const normalizedSuggestions = Array.isArray(rawResponse.suggestions)
    ? rawResponse.suggestions
        .map((suggestion) => String(suggestion || '').trim())
        .filter(Boolean)
    : [];

  const cartUpdatesAreValid = normalizedCartUpdates.every(isValidCartUpdate);

  if (!normalizedReply || hasNullCartUpdatesOnSuccess || !cartUpdatesAreValid) {
    return { ...FALLBACK_RESPONSE };
  }

  const validated = {
    ok,
    cartUpdates: normalizedCartUpdates,
    reply: normalizedReply,
    suggestions: normalizedSuggestions
  };

  if (validated.suggestions && validated.suggestions.length === 0) {
    delete validated.suggestions;
  }

  return validated;
}

module.exports = {
  FALLBACK_RESPONSE,
  validateResponse
};
