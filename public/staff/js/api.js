const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawBody = await response.text();
  let data = null;

  if (rawBody) {
    try {
      data = JSON.parse(rawBody);
    } catch (error) {
      data = rawBody;
    }
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data && data.error
      ? data.error
      : `Request failed: ${response.statusText || 'Unknown'} (${response.status})`;
    throw new Error(message);
  }

  return data;
}

export function getSessions() {
  return requestJson('/.netlify/functions/get-table-sessions');
}

export async function getSession(id) {
  const sessions = await getSessions();
  return sessions.find((session) => String(session.id) === String(id)) || null;
}

export function getOrders(session_id) {
  const params = new URLSearchParams({ session_id: String(session_id) });
  return requestJson(`/.netlify/functions/get-table-orders?${params.toString()}`);
}

export function openSession(table_id) {
  return requestJson('/.netlify/functions/open-table-session', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ table_id })
  });
}

export function createCheckout(session_id, mode, split_count) {
  const payload = { session_id, mode };
  if (mode === 'split') {
    payload.split_count = split_count;
  }
  return requestJson('/.netlify/functions/create-checkout', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}
