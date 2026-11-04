// Recordatorios (tabla reminders: title, remind_date, remind_time, status active|done). Igual que la clásica:
// pendientes primero por fecha/hora; los pasados sin hacer se marcan en rojo. Solo dentro de la app (sin push).
import { dbPost, dbPatch, dbDelete, safeGet } from '../db.js?v=202611041029';
import { escapeHTML, localDate, showToast, icon, openModal, closeModal } from '../util.js?v=202611041029';

let list = [];
let root = null;

export async function show(el, isCurrent = () => true) {
  const rows = await safeGet('reminders', '?order=created_at.desc');
  if (!isCurrent()) return;
  root = el; list = rows || [];
  paint();
}

const key = r => (r.remind_date || '9999') + (r.remind_time || '99:99');
function whenText(r) {
  if (!r.remind_date) return '';
  const today = localDate(), now = new Date().toTimeString().slice(0, 5);
  const past = r.status !== 'done' && (r.remind_date < today || (r.remind_date === today && r.remind_time && r.remind_time.slice(0, 5) < now));
  const d = new Date(r.remind_date + 'T12:00:00');
  const label = r.remind_date === today ? 'Hoy' : d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
  return `<span class="task-meta${past ? ' late' : ''}">${escapeHTML(label + (r.remind_time ? ' · ' + r.remind_time.slice(0, 5) : ''))}${past ? ' · ya pasó' : ''}</span>`;
}
function row(r) {
  const done = r.status === 'done';
  return `<div class="tcard${done ? ' done' : ''}" data-rem="${escapeHTML(r.id)}">
    <button type="button" class="check ${done ? 'done' : ''}" data-rcheck aria-label="${done ? 'Reabrir' : 'Hecho'}: ${escapeHTML(r.title)}">${done ? icon('check', 3) : ''}</button>
    <button type="button" class="tcard-main" data-redit><span class="task-title">${escapeHTML(r.title)}</span>${whenText(r)}</button>
    <button type="button" class="icon-btn sm" data-rdel aria-label="Eliminar ${escapeHTML(r.title)}">${icon('trash')}</button>
  </div>`;
}

function paint() {
  const sorted = [...list].sort((a, b) => ((a.status === 'done') - (b.status === 'done')) || key(a).localeCompare(key(b)));
  const open = sorted.filter(r => r.status !== 'done'), done = sorted.filter(r => r.status === 'done');
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center"><h1 class="hello" style="margin:0">Recordatorios</h1></header>
    <section class="card" style="gap:8px">
      <form class="radd" data-radd>
        <div class="radd-title"><label class="sr-only" for="rTitle">Nuevo recordatorio</label><input class="field" id="rTitle" placeholder="Nuevo recordatorio…" maxlength="200" autocomplete="off"></div>
        <div class="row2" style="flex:1 1 260px"><div><label class="sr-only" for="rDate">Fecha</label><input class="field" id="rDate" type="date"></div><div><label class="sr-only" for="rTime">Hora</label><input class="field" id="rTime" type="time"></div></div>
        <button type="submit" class="btn-primary" style="padding:0 18px">Agregar</button>
      </form>
      <div class="small">Te los muestro aquí con su fecha; no llegan como notificación.</div>
    </section>
    <div class="tgroup">${open.map(row).join('') || '<div class="card"><div class="small">No tienes recordatorios pendientes.</div></div>'}</div>
    ${done.length ? `<details class="tgroup past"><summary class="tgroup-h">Hechos <span>${done.length}</span></summary>${done.map(row).join('')}</details>` : ''}
  </div>`;
  root.querySelector('[data-radd]').onsubmit = e => { e.preventDefault(); add(); };
  root.querySelectorAll('[data-rem]').forEach(el => {
    const r = list.find(x => String(x.id) === el.dataset.rem);
    el.querySelector('[data-rcheck]').onclick = () => patch(r, { status: r.status === 'done' ? 'active' : 'done' });
    el.querySelector('[data-redit]').onclick = () => edit(r);
    el.querySelector('[data-rdel]').onclick = () => del(r);
  });
}
const again = () => { if (root && document.body.contains(root)) paint(); };

async function add() {
  const title = root.querySelector('#rTitle').value.trim();
  if (!title) return showToast('Escribe el recordatorio', 'error');
  const body = { title, remind_date: root.querySelector('#rDate').value || null, remind_time: root.querySelector('#rTime').value || null, status: 'active' };
  const temp = { ...body, id: 'temp-' + Date.now() };
  list.unshift(temp); paint();
  try { const [r] = await dbPost('reminders', body); Object.assign(temp, r); showToast('Recordatorio agregado'); }
  catch { list = list.filter(x => x !== temp); again(); showToast('No se pudo guardar', 'error'); }
}
async function patch(r, body) {
  const prev = {}; for (const k of Object.keys(body)) prev[k] = r[k];
  Object.assign(r, body); paint();
  try { await dbPatch('reminders', body, `?id=eq.${r.id}`); }
  catch { Object.assign(r, prev); again(); showToast('No se pudo actualizar', 'error'); }
}
function edit(r) {
  openModal('Editar recordatorio', `
    <label class="flabel" for="erTitle" style="margin-top:0">Recordatorio</label><input class="field" id="erTitle" maxlength="200" value="${escapeHTML(r.title)}">
    <div class="row2"><div><label class="flabel" for="erDate">Fecha</label><input class="field" id="erDate" type="date" value="${r.remind_date || ''}"></div>
      <div><label class="flabel" for="erTime">Hora</label><input class="field" id="erTime" type="time" value="${r.remind_time ? r.remind_time.slice(0, 5) : ''}"></div></div>`,
    '<button type="button" class="btn-primary" id="erSave">Guardar</button>');
  document.getElementById('erSave').onclick = () => {
    const title = document.getElementById('erTitle').value.trim();
    if (!title) return showToast('El título es requerido', 'error');
    closeModal();
    patch(r, { title, remind_date: document.getElementById('erDate').value || null, remind_time: document.getElementById('erTime').value || null });
  };
}
async function del(r) {
  const i = list.indexOf(r);
  list.splice(i, 1); paint();
  try {
    await dbDelete('reminders', `?id=eq.${r.id}`);
    showToast('Recordatorio eliminado', 'info', { label: 'Deshacer', onClick: async () => {
      const { id, ...rest } = r;
      try { const [n] = await dbPost('reminders', rest); list.splice(Math.min(i, list.length), 0, n); again(); } catch { showToast('No se pudo restaurar', 'error'); }
    } });
  } catch { list.splice(i, 0, r); again(); showToast('No se pudo eliminar', 'error'); }
}
