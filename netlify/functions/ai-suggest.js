const MAX_MESSAGE_LENGTH = 400;
const MENU_CACHE_TTL_MS = 60 * 1000;
const PREFERENCE_KEYWORDS = {
  spicy: ['piccante', 'diavola', 'pepperoni'],
  light: ['leggera', 'light', 'delicata'],
  premium: ['premium', 'gourmet', 'speciale']
};
let menuCache = null;

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function errorResponse(headers, statusCode, code, message, extra = {}) {
  return {
    statusCode,
    headers,
    body: JSON.stringify({ error: message, code, ...extra })
  };
}

function clampQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function parsePeople(message) {
  const lower = String(message || '').toLowerCase();
  const match = lower.match(/(?:siamo|in|per)\s+(\d{1,2})/) || lower.match(/(\d{1,2})\s+persone?/);
  return clampQty(match ? Number(match[1]) : 1);
}

function parsePreference(message) {
  const lower = String(message || '').toLowerCase();
  if (!lower) return null;

  for (const [key, keywords] of Object.entries(PREFERENCE_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) return key;
  }

  return null;
}

function dedupeItems(items) {
  const byId = new Map();
  (items || []).forEach((item) => {
    if (!item || !item.id) return;
    byId.set(item.id, clampQty((byId.get(item.id) || 0) + clampQty(item.qty)));
  });
  return [...byId.entries()].map(([id, qty]) => ({ id, qty }));
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

function maybeAddInvisibleUpsell(items, activeProducts, people, preference) {
  if (!Array.isArray(activeProducts) || !activeProducts.length) return null;
  const ids = new Set((items || []).map((item) => item.id));
  const beverage = activeProducts.find((item) => {
    const text = `${item.id} ${item.name || ''}`.toLowerCase();
    return !ids.has(item.id) && /(bevanda|drink|cola|fanta|acqua|birra)/.test(text);
  });
  if (beverage) {
    return {
      kind: 'beverage',
      item: { id: beverage.id, qty: clampQty(Math.ceil(people / 2)) },
      cta: 'Aggiungi bevanda'
    };
  }

  if (preference === 'premium') {
    const premium = activeProducts.find((item) => {
      const text = `${item.id} ${item.name || ''}`.toLowerCase();
      return !ids.has(item.id) && /(premium|gourmet|special)/.test(text);
    });
    if (premium) {
      return {
        kind: 'premium',
        item: { id: premium.id, qty: 1 },
        cta: 'Passa a opzione premium'
      };
    }
  }

  return null;
}

function buildConversionNote(items, secondarySuggestion, people, preference) {
  const count = (items || []).reduce((sum, item) => sum + clampQty(item.qty), 0);
  const parts = [`Proposta per ${people} persone`];
  if (count) parts.push(`${count} pezzi consigliati`);
  if (preference) parts.push(`stile ${preference}`);
  if (secondarySuggestion) parts.push(`upsell ${secondarySuggestion.kind}`);
  return `${parts.join(', ')}.`;
}

function getBaseUrl(event) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const headers = event && event.headers ? event.headers : {};
  const host = headers.host || headers.Host;
  const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https';
  if (host) return `${proto}://${host}`;
  return 'http://localhost:8888';
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
  if (menuCache && now - menuCache.fetchedAt < MENU_CACHE_TTL_MS) return menuCache.data;

  const baseUrl = getBaseUrl(event);
  const response = await fetch(`${baseUrl}/data/menu.json`);
  if (!response.ok) throw new Error('MENU_FETCH_FAILED');

  const parsed = await response.json();
  const validated = validateMenuData(parsed);
  menuCache = { data: validated, fetchedAt: now };
  return validated;
}

exports.handler = async function (event) {
  const headers = getCorsHeaders();

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(headers, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const message = String(body.message || '').trim();

    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return errorResponse(headers, 400, 'INVALID_INPUT', 'Invalid input');
    }

    const people = parsePeople(message) || clampQty(body.people || 1);
    const preference = parsePreference(message);
    const menuData = await fetchMenuData(event);
    const activeProducts = menuData.menu.filter(
      (item) => item && item.active && item.id && /^[a-z0-9-]+$/i.test(String(item.id))
    );
    const activeIds = new Set(activeProducts.map((item) => item.id));

    let items = parseFromMessage(message, activeProducts);
    if (!items.length && activeProducts.length) {
      items = [{ id: activeProducts[0].id, qty: people }];
    }

    const validItems = dedupeItems(items
      .filter((item) => activeIds.has(item.id))
      .map((item) => ({ id: item.id, qty: clampQty(item.qty) })));
    const secondarySuggestion = maybeAddInvisibleUpsell(validItems, activeProducts, people, preference);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items: validItems,
        secondarySuggestion,
        note: buildConversionNote(validItems, secondarySuggestion, people, preference)
      })
    };
  } catch (error) {
    console.error('Errore ai-suggest:', error);
    const code = error && error.message === 'MENU_FETCH_FAILED' ? 'MENU_FETCH_FAILED' : 'AI_SUGGEST_ERROR';
    return errorResponse(headers, 500, code, 'Errore tecnico temporaneo.', { items: [], note: '' });
  }
};


exports.__resetMenuCache = function () {
  menuCache = null;
};
