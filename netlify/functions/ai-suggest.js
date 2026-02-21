const MAX_MESSAGE_LENGTH = 400;
const MENU_CACHE_TTL_MS = 5 * 60 * 1000;

let menuCache = {
  expiresAt: 0,
  data: null
};

function getCorsHeaders() {
  let allowedOrigin = '*';
  if (process.env.SITE_URL) {
    try {
      allowedOrigin = new URL(process.env.SITE_URL).origin;
    } catch (_) {
      // fallback to "*" when SITE_URL is invalid
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
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

function getBaseUrl(event) {
  if (process.env.SITE_URL) {
    try {
      return new URL(process.env.SITE_URL).origin;
    } catch (_) {
      // fallback to request headers
    }
  }

  const headers = event.headers || {};
  const host = headers.host || headers.Host;
  if (!host) {
    throw new Error('Missing host header');
  }

  const protoHeader = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'];
  const proto = protoHeader ? String(protoHeader).split(',')[0].trim() : 'https';
  return `${proto}://${host}`;
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

async function fetchMenuData(event) {
  const now = Date.now();
  if (menuCache.data && menuCache.expiresAt > now) {
    return menuCache.data;
  }

  const baseUrl = getBaseUrl(event);
  const response = await fetch(`${baseUrl}/data/menu.json`);
  if (!response.ok) {
    throw new Error(`Menu fetch failed (${response.status})`);
  }

  const menuData = validateMenuData(await response.json());
  menuCache = {
    data: menuData,
    expiresAt: now + MENU_CACHE_TTL_MS
  };

  return menuData;
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

    const menuData = await fetchMenuData(event);
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

    let code = 'AI_SUGGEST_ERROR';
    if (String(error && error.message || '').startsWith('Menu fetch failed')) {
      code = 'MENU_FETCH_FAILED';
    } else if (String(error && error.message || '').includes('Missing host header')) {
      code = 'MISSING_HOST_HEADER';
    } else if (String(error && error.message || '').includes('Invalid menu')) {
      code = 'INVALID_MENU_DATA';
    } else if (String(error && error.message || '').includes('No active menu items')) {
      code = 'NO_ACTIVE_MENU_ITEMS';
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        items: [],
        note: 'Errore tecnico temporaneo.',
        code
      })
    };
  }
};


exports.__resetMenuCache = function () {
  menuCache = { data: null, expiresAt: 0 };
};
