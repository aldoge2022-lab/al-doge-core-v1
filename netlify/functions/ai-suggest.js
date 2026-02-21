const MAX_MESSAGE_LENGTH = 400;
const MENU_CACHE_TTL_MS = 5 * 60 * 1000;

const PREFERENCE_KEYWORDS = {
  piccante: ['piccante', 'spicy', 'diavola', 'forte'],
  leggera: ['leggera', 'light', 'leggero', 'semplice'],
  vegetariana: ['vegetariana', 'vegetariano', 'veg']
};

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

function errorResponse(statusCode, headers, code, note) {
  return {
    statusCode,
    headers,
    body: JSON.stringify({
      items: [],
      note,
      code
    })
  };
}

function clampQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function parsePeople(message) {
  const match = message.match(/(?:siamo in|per|x)\s*(\d{1,2})/i) || message.match(/\b(\d{1,2})\s*(persone|persona)\b/i);
  if (!match) return null;
  return clampQty(match[1]);
}

function parsePreference(message) {
  const lower = message.toLowerCase();
  const selected = Object.keys(PREFERENCE_KEYWORDS).find((key) =>
    PREFERENCE_KEYWORDS[key].some((keyword) => lower.includes(keyword))
  );
  return selected || null;
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

function chooseProductByPreference(activeProducts, preference) {
  if (!preference) return null;

  const byName = (matcher) => activeProducts.find((item) => matcher(String(item.name || '').toLowerCase()));

  if (preference === 'piccante') {
    return byName((name) => name.includes('diavola') || name.includes('piccante') || name.includes('spicy'));
  }

  if (preference === 'leggera') {
    return byName((name) => name.includes('margherita') || name.includes('light') || name.includes('leggera'));
  }

  if (preference === 'vegetariana') {
    return byName((name) => name.includes('vegetar') || name.includes('verdure') || name.includes('ortolana'));
  }

  return null;
}

function dedupeItems(items) {
  const map = new Map();
  items.forEach((item) => {
    const key = String(item.id);
    const prev = map.get(key) || 0;
    map.set(key, clampQty(prev + Number(item.qty || 1)));
  });
  return Array.from(map.entries()).map(([id, qty]) => ({ id, qty }));
}


function isProposalMode(message) {
  const lower = String(message || '').toLowerCase();
  return ['proposta', 'consiglia', 'sugger', 'menu'].some((keyword) => lower.includes(keyword));
}

function productById(activeProducts, id) {
  return activeProducts.find((item) => item.id === id) || null;
}

function getTopPricedProduct(activeProducts, excludedId) {
  return activeProducts
    .filter((item) => item.id !== excludedId)
    .sort((a, b) => Number(b.base_price_cents || 0) - Number(a.base_price_cents || 0))[0] || null;
}

function maybeAddInvisibleUpsell(activeProducts, items, peopleQty, allowUpsell) {
  if (!allowUpsell || peopleQty < 2 || activeProducts.length < 2) return items;

  const current = dedupeItems(items);
  if (current.length > 1) return current;

  const anchor = current[0];
  if (!anchor) return current;

  const anchorProduct = productById(activeProducts, anchor.id);
  const topProduct = getTopPricedProduct(activeProducts, anchor.id);
  if (!anchorProduct || !topProduct) return current;

  const anchorPrice = Number(anchorProduct.base_price_cents || 0);
  const topPrice = Number(topProduct.base_price_cents || 0);
  const hasUpgradeValue = topPrice > anchorPrice;
  if (!hasUpgradeValue) return current;

  const upsellQty = peopleQty >= 4 ? 2 : 1;
  current.push({ id: topProduct.id, qty: upsellQty });
  return dedupeItems(current);
}

function buildConversionNote(preference, count, itemsCount) {
  const base = preference
    ? `Proposta ${preference} dal menu attivo.`
    : 'Proposta generata dal menu attivo.';

  if (itemsCount > 1) {
    return `${base} Ho incluso una variante premium per aumentare soddisfazione e ticket medio.`;
  }

  if (count >= 3) {
    return `${base} Vuoi che la prossima proposta sia ottimizzata per gruppo?`;
  }

  return `${base} Se vuoi, posso preparare una variante più ricca.`;
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
    return errorResponse(405, headers, 'METHOD_NOT_ALLOWED', 'Metodo non consentito.');
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const message = String(body.message || '').trim();

    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return errorResponse(400, headers, 'INVALID_INPUT', 'Input non valido.');
    }

    const menuData = await fetchMenuData(event);
    const activeProducts = menuData.menu.filter(
      (item) => item && item.active && item.id && /^[a-z0-9-]+$/i.test(String(item.id))
    );
    const activeIds = new Set(activeProducts.map((item) => item.id));

    const peopleQty = parsePeople(message) || clampQty(body.people || 1);
    const preference = parsePreference(message);

    let items = parseFromMessage(message, activeProducts);
    const explicitItemsFound = items.length > 0;

    if (!items.length) {
      const preferred = chooseProductByPreference(activeProducts, preference);
      if (preferred) {
        items = [{ id: preferred.id, qty: peopleQty }];
      }
    }

    if (!items.length && activeProducts.length) {
      items = [{ id: activeProducts[0].id, qty: peopleQty }];
    }

    if (explicitItemsFound && peopleQty > 1) {
      const allDefaultQty = items.every((item) => Number(item.qty || 1) === 1);
      if (allDefaultQty) {
        items = items.map((item) => ({ id: item.id, qty: peopleQty }));
      }
    }

    const allowUpsell = !explicitItemsFound || isProposalMode(message);
    items = maybeAddInvisibleUpsell(activeProducts, items, peopleQty, allowUpsell);

    const validItems = dedupeItems(items)
      .filter((item) => activeIds.has(item.id))
      .map((item) => ({ id: item.id, qty: clampQty(item.qty) }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items: validItems,
        note: buildConversionNote(preference, peopleQty, validItems.length)
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

    return errorResponse(500, headers, code, 'Errore tecnico temporaneo.');
  }
};

exports.__resetMenuCache = function () {
  menuCache = { data: null, expiresAt: 0 };
};
