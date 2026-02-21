const catalog = require('../../data/catalog');

function getDrinks() {
  return (catalog.drinks || []).filter((drink) => drink && drink.active);
}

function pickDrink(cart) {
  const drinks = getDrinks();
  if (!drinks.length) return null;

  const hasSpicyPizza = cart.some((item) => item.type === 'pizza' && /diavola|piccante/i.test(String(item.id)));
  if (hasSpicyPizza) {
    return drinks.find((drink) => /birra/i.test(drink.name)) || drinks[0];
  }

  return drinks.find((drink) => /acqua/i.test(drink.name)) || drinks[0];
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const cart = Array.isArray(body.cart) ? body.cart : [];
    const suggested = pickDrink(cart);
    if (!suggested) {
      return { statusCode: 200, body: JSON.stringify({ suggested_drink: '', reason: '' }) };
    }

    const reason = /birra/i.test(suggested.name)
      ? 'Bilancia il piccante della Diavola'
      : 'Rinfresca il palato e accompagna bene la pizza';

    return {
      statusCode: 200,
      body: JSON.stringify({
        suggested_drink: suggested.name,
        reason
      })
    };
  } catch (error) {
    return { statusCode: 400, body: 'Invalid input' };
  }
};
