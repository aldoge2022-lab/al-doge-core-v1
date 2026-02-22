exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const cart = body.cart;

    if (!cart || !Array.isArray(cart.items)) {
      throw new Error('Invalid input');
    }

    const normalizedItems = cart.items.map((item) => {
      const normalized = { ...item };
      if (normalized.type !== 'pizza') {
        normalized.size = normalized.size || 'standard';
        normalized.dough = normalized.dough || null;
        normalized.ingredients = normalized.ingredients || [];
        normalized.tags = normalized.tags || [];
        normalized.extraPrice = normalized.extraPrice ?? 0;
      }
      return normalized;
    });

    for (const item of normalizedItems) {
      if (!item.id || typeof item.price !== 'number' || !Number.isFinite(item.price)) {
        throw new Error('Invalid input');
      }
    }

    return { statusCode: 200, body: JSON.stringify({ cart: { items: normalizedItems } }) };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid input' }) };
  }
};
