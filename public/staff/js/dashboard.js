import { getSessions } from './api.js';

const previousStatuses = new Map();
const grid = document.getElementById('grid');
const errorEl = document.getElementById('error');
const NOTIFICATION_FREQUENCY = 920;
const NOTIFICATION_VOLUME = 0.05;
const NOTIFICATION_DURATION_SECONDS = 0.15;

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

function beep() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = NOTIFICATION_FREQUENCY;
    gain.gain.value = NOTIFICATION_VOLUME;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + NOTIFICATION_DURATION_SECONDS);
  } catch (error) {}
}

function buildCard(session) {
  const paid = Number(session.paid_cents || 0);
  const residual = Number(session.residual_cents || 0);
  const partial = paid > 0 && residual > 0;
  const statusIcon = session.status === 'open' ? '🟢' : '🔴';
  const card = document.createElement('article');
  card.className = `card ${session.status === 'open' ? 'open' : 'closed'}`;
  card.tabIndex = 0;
  card.innerHTML = `
    <div><strong>Tavolo ${escapeHtml(session.table_id)}</strong></div>
    <div class="row"><span><span class="status-icon">${statusIcon}</span>Stato</span><strong>${escapeHtml(session.status)}</strong></div>
    <div class="row"><span>Totale</span><strong>${eur(session.total_cents)}</strong></div>
    <div class="row"><span>Pagato</span><strong>${eur(session.paid_cents)}</strong></div>
    <div class="row"><span>Residuo</span><strong>${eur(session.residual_cents)}</strong></div>
    ${partial ? '<span class="badge">Pagamento parziale</span>' : ''}
  `;
  card.addEventListener('click', () => {
    window.location.href = `./table.html?id=${encodeURIComponent(session.id)}`;
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      card.click();
    }
  });
  return card;
}

async function refresh() {
  try {
    const sessions = await getSessions();
    const alive = new Set();
    const fragment = document.createDocumentFragment();
    sessions.forEach((session) => {
      const id = String(session.id);
      const previous = previousStatuses.get(id);
      if (previous === 'open' && session.status === 'closed') {
        beep();
      }
      previousStatuses.set(id, session.status);
      alive.add(id);
      fragment.appendChild(buildCard(session));
    });
    Array.from(previousStatuses.keys()).forEach((id) => {
      if (!alive.has(id)) previousStatuses.delete(id);
    });
    grid.innerHTML = '';
    grid.appendChild(fragment);
    errorEl.textContent = '';
  } catch (error) {
    errorEl.textContent = error.message || 'Errore caricamento tavoli';
  }
}

refresh();
setInterval(refresh, 5000);
