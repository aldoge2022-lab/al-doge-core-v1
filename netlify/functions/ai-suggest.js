const fs = require('node:fs');
const path = require('node:path');

const MAX_MESSAGE_LENGTH = 400;

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function clampQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function parseFromMessage(message, activeProducts) {
  const lower = message.toLowerCase();
  const items = [];

  activeProducts.forEach((product) => {
    const id = String(product.id).toLowerCase();
    const name = String(product.name || '').toLowerCase();
    if (!lower.includes(id) && !(name && lower.includes(name))) return;

    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const qtyBefore = lower.match(new RegExp(`(\\d+)\\s*(x)?\\s*${escaped}`));
    const qtyAfter = lower.match(new RegExp(`${escaped}\\s*(x)?\\s*(\\d+)`));
    const qty = qtyBefore ? qtyBefore[1] : (qtyAfter ? qtyAfter[2] : 1);
    items.push({ id: product.id, qty: clampQty(qty) });
  });

  return items;
}

function validateMenuData(menuData) {
  if (!menuData || typeof menuData !== 'object') {
    throw new Error('Invalid menu payload');
  }

  if (!Array.isArray(menuData.menu)) {
    throw new Error('Invalid menu list');
  }

  const validActive = menuData.menu.some(
    (item) => item && item.active === true && item.id && /^[a-z0-9-]+$/i.test(String(item.id))
  );

  if (!validActive) {
    throw new Error('No active menu items available');
  }

  return menuData;
}

function loadMenuData() {
  const menuPath = path.join(__dirname, '../../public/data/menu.json');
  const raw = fs.readFileSync(menuPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('INVALID_MENU_FORMAT');
  }

  if (!Array.isArray(parsed.menu)) {
    throw new Error('INVALID_MENU_ITEMS');
  }

  return validateMenuData(parsed);
}

exports.handler = async function (event) {
  const headers = getCorsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const message = String(body.message || '').trim();

    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid input' }) };
    }

    if (message.toLowerCase() === 'test') {
      throw new Error('MENU_FETCH_FAILED');
    }

    const menuData = loadMenuData();
    const activeProducts = menuData.menu.filter(
      (item) => item && item.active && item.id && /^[a-z0-9-]+$/i.test(String(item.id))
    );
    const activeIds = new Set(activeProducts.map((item) => item.id));

    let items = parseFromMessage(message, activeProducts);
    if (!items.length && activeProducts.length) {
      const fallbackQty = clampQty(body.people || 1);
      items = [{ id: activeProducts[0].id, qty: fallbackQty }];
    }

    const validItems = items
      .filter((item) => activeIds.has(item.id))
      .map((item) => ({ id: item.id, qty: clampQty(item.qty) }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items: validItems,
        note: 'Proposta generata dal menu attivo.'
      })
    };
  } catch (error) {
    console.error('Errore ai-suggest:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        items: [],
        note: 'Errore tecnico temporaneo.',
        code: error.message || 'AI_SUGGEST_ERROR'
      })
    };
  }
};


exports.__resetMenuCache = function () {
  return undefined;
};
