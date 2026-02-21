const fs = require('node:fs');
const path = require('node:path');

const MAX_MESSAGE_LENGTH = 400;

function getCorsHeaders() {
  let allowedOrigin = '*';
  if (process.env.SITE_URL) {
    try {
      allowedOrigin = new URL(process.env.SITE_URL).origin;
    } catch (_) {}
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function loadMenuData() {
  const menuPath = path.join(process.cwd(), 'public', 'data', 'menu.json');
  const content = fs.readFileSync(menuPath, 'utf8');
  return JSON.parse(content);
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
    const qtyMatch = lower.match(new RegExp(`(\\d+)\\s*(x)?\\s*${escaped}`));
    items.push({ id: product.id, qty: clampQty(qtyMatch ? qtyMatch[1] : 1) });
  });

  return items;
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

    const menuData = loadMenuData();
    const activeProducts = (menuData.menu || []).filter((item) => item && item.active && item.id);
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
        note: 'Errore tecnico temporaneo.'
      })
    };
  }
};
