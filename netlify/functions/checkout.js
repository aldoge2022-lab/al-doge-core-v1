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

    for (const item of cart.items) {
      // Ensure non-pizza items (drinks, extras) have the minimal fields expected by validation
      if (item.type !== 'pizza') {
        item.size = item.size || 'standard';
        item.dough = item.dough || null;
        item.ingredients = item.ingredients || [];
        item.tags = item.tags || [];
        item.extraPrice = item.extraPrice || 0;
      }

      // Final sanity checks
      if (!item.id || typeof item.price !== 'number' || Number.isNaN(item.price)) {
        throw new Error('Invalid input');
      }
    }

    return { statusCode: 200, body: JSON.stringify({ cart: { items: cart.items } }) };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid input' }) };
  }
};
