import { createCheckout, getOrders, getSession, openSession } from './api.js';

const errorEl = document.getElementById('error');
const ordersBody = document.getElementById('orders-body');
const actionsEl = document.getElementById('actions');
const qrImg = document.getElementById('payment-qr');

const query = new URLSearchParams(window.location.search);
const sessionId = query.get('id');

function eur(cents) {
  return `€ ${(Number(cents || 0) / 100).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderOrders(orders) {
  const rows = Array.isArray(orders) ? orders : [];
  if (!rows.length) {
    ordersBody.innerHTML = '<tr><td colspan="4">Nessun ordine trovato</td></tr>';
    return;
  }

  ordersBody.innerHTML = rows.map((order) => {
    const qty = Number(order.qty || order.quantity || 0);
    const price = Number(order.price_cents || order.unit_price_cents || 0);
    const total = Number(order.total_cents || price * qty);
    const item = order.item_name || order.item || order.id || 'Item';
    return `<tr>
      <td>${escapeHtml(item)}</td>
      <td>${qty}</td>
      <td>${eur(price)}</td>
      <td>${eur(total)}</td>
    </tr>`;
  }).join('');
}

async function generateCheckout(mode, split_count) {
  try {
    const response = await createCheckout(sessionId, mode, split_count);
    const checkoutUrl = response.checkout_url;
    if (!checkoutUrl) {
      throw new Error('checkout_url mancante');
    }
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(checkoutUrl)}`;
    qrImg.style.display = 'block';
    errorEl.textContent = '';
  } catch (error) {
    errorEl.textContent = error.message || 'Errore generazione checkout';
  }
}

function renderActions(session) {
  actionsEl.innerHTML = '';
  if (session.status === 'open') {
    const checkoutBtn = document.createElement('button');
    checkoutBtn.type = 'button';
    checkoutBtn.textContent = 'Genera Checkout';
    checkoutBtn.addEventListener('click', () => generateCheckout('full'));

    const splitWrap = document.createElement('div');
    [2, 3, 4, 5, 6, 8].forEach((value) => {
      const splitBtn = document.createElement('button');
      splitBtn.type = 'button';
      splitBtn.textContent = `Dividi ${value}`;
      splitBtn.addEventListener('click', () => generateCheckout('split', value));
      splitWrap.appendChild(splitBtn);
    });

    actionsEl.append(checkoutBtn, splitWrap);
    return;
  }

  const reopenBtn = document.createElement('button');
  reopenBtn.type = 'button';
  reopenBtn.textContent = 'Riapri Tavolo';
  reopenBtn.addEventListener('click', async () => {
    try {
      await openSession(session.table_id);
      window.location.href = './index.html';
    } catch (error) {
      errorEl.textContent = error.message || 'Errore riapertura tavolo';
    }
  });
  actionsEl.appendChild(reopenBtn);
}

async function load() {
  if (!sessionId) {
    errorEl.textContent = 'Sessione non specificata';
    return;
  }

  try {
    const [session, orders] = await Promise.all([
      getSession(sessionId),
      getOrders(sessionId)
    ]);

    if (!session) {
      errorEl.textContent = 'Sessione non trovata';
      return;
    }

    setText('table-id', String(session.table_id));
    setText('session-id', String(session.id));
    setText('total', eur(session.total_cents));
    setText('paid', eur(session.paid_cents));
    setText('residual', eur(session.residual_cents));
    setText('status', String(session.status));
    renderOrders(orders);
    renderActions(session);
    errorEl.textContent = '';
  } catch (error) {
    errorEl.textContent = error.message || 'Errore caricamento dettaglio tavolo';
  }
}

load();
