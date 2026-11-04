// Tareas: Hoy, Orden del día, Mañana, Próximas, Sin completar, Todas, Pasadas y categorías.
import { escapeHTML, localDate, todayStr, daysUntil, showToast, icon, openModal, closeModal } from '../util.js?v=202611040007';
import * as K from '../tareas.js?v=202611040007';

const { T } = K;
const VIEWS = { today: 'Hoy', order: 'Orden del día', tomorrow: 'Mañana', upcoming: 'Próximas', missed: 'Sin completar', all: 'Todas', past: 'Pasadas' };
const PRIO_FILTERS = { all: 'Todas', critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' };
let st = { view: 'today', priority: 'all', search: '', pastLimit: { done: 30, missed: 30 } };
let root = null;

const ls = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage */ } } };

export async function show(el, param, isCurrent = () => true) {
  await K.loadTasks();
  if (!isCurrent()) return;
  root = el;
  const v = param && (VIEWS[param] || param.startsWith('project_')) ? param : ls.get('v2TasksView', 'today');
  st.view = VIEWS[v] || v.startsWith('project_') ? v : 'today';
  paint();
  const n = await K.checkRecurring(); // igual que v1 al abrir
  if (n && isCurrent() && root === el) paint();
}

export const openNewTask = () => openTaskModal(null);

// ── Tarjeta ──────────────────────────────────────────
function dueText(t) {
  const today = localDate();
  if (K.rangeHidden(t)) return `Empieza ${K.shortDay(t.start_date)} · límite ${K.formatDate(t.due_date)}`;
  if (K.rangeActive(t)) return `Límite ${K.formatDate(t.due_date)} · ${K.rangeDueText(t)}`;
  if (!t.due_date) return '';
  const lbl = t.due_date === today ? 'Hoy' : t.due_date < today ? `Vencida · ${K.formatDate(t.due_date)}` : t.due_date === K.tomorrowStr() ? 'Mañana' : K.formatDate(t.due_date);
  return lbl + (t.due_time ? ' ' + t.due_time.slice(0, 5) : '') + (t.end_date ? ` → ${K.formatDate(t.end_date)}` : '');
}
function badge(t) {
  if (K.isClosed(t)) return t.status === 'missed' ? '<span class="chip chip-plain">No completada</span>' : '';
  const p = K.effPriority(t);
  return p === 'critical' ? '<span class="chip chip-alert">Crítica</span>' : p === 'high' ? '<span class="chip chip-soft">Alta</span>' : '';
}
function cardHTML(t) {
  const st2 = t.status === 'done' ? 'done' : t.status === 'missed' ? 'missed' : t.status === 'in_progress' ? 'progress' : '';
  const subs = T.subtasks.filter(s => s.task_id === t.id);
  const meta = [
    K.CATEGORIES[t.category] || '',
    t.status === 'in_progress' ? 'En progreso' : '',
    dueText(t),
    subs.length ? `${subs.filter(s => s.done).length}/${subs.length} subtareas` : '',
    t.is_recurring ? '↻ ' + K.recurrenceLabel(t.recurrence) : '',
    t.remind_day_before ? 'Aviso un día antes' : '',
    t.estimated_minutes ? `${t.estimated_minutes} min` : '',
    K.workedToday(t) ? 'Avanzaste hoy' : ''
  ].filter(Boolean);
  const overdue = !K.isClosed(t) && ((K.rangeActive(t) && daysUntil(t.due_date) < 0) || (!K.isRangeTask(t) && t.due_date && t.due_date < localDate()));
  return `<div class="tcard ${st2}" data-id="${escapeHTML(t.id)}">
    <button type="button" class="check ${st2 === 'done' ? 'done' : st2 === 'missed' ? 'missed' : st2 === 'progress' ? 'progress' : ''}" data-check aria-label="${K.isClosed(t) ? 'Reabrir' : 'Completar'}: ${escapeHTML(t.title)}">${st2 === 'done' ? icon('check', 3) : st2 === 'missed' ? icon('x', 3) : ''}</button>
    <button type="button" class="tcard-main" data-edit>
      <span class="task-title">${escapeHTML(t.title)}</span>
      ${meta.length ? `<span class="task-meta${overdue ? ' late' : ''}">${escapeHTML(meta.join(' · '))}</span>` : ''}
    </button>
    ${badge(t)}
    <button type="button" class="icon-btn sm" data-more aria-label="Más acciones para ${escapeHTML(t.title)}">${icon('mas')}</button>
  </div>`;
}
const group = (label, list) => list.length ? `<div class="tgroup"><h2 class="tgroup-h">${escapeHTML(label)} <span>${list.length}</span></h2>${list.map(cardHTML).join('')}</div>` : '';

// ── Vistas ───────────────────────────────────────────
function quickHTML() {
  const open = ls.get('v2QuickOpen', '1') !== '0';
  const pending = T.quick.filter(q => !q.done), done = T.quick.filter(q => q.done);
  const item = q => `<div class="qitem${q.done ? ' done' : ''}">
    <button type="button" class="check check-sm ${q.done ? 'done' : ''}" data-qtoggle="${escapeHTML(q.id)}" aria-label="${q.done ? 'Desmarcar' : 'Marcar'}: ${escapeHTML(q.title)}">${q.done ? icon('check', 3) : ''}</button>
    <span class="qtitle">${escapeHTML(q.title)}</span>
    <button type="button" class="icon-btn sm" data-qdel="${escapeHTML(q.id)}" aria-label="Borrar ${escapeHTML(q.title)}">${icon('x')}</button></div>`;
  return `<details class="card quick" ${open ? 'open' : ''} data-quick>
    <summary class="card-head"><h2>Tareas rápidas${pending.length ? ` <span class="chip chip-plain">${pending.length}</span>` : ''}</h2><span class="muted" style="font-size:13px">${open ? 'Ocultar' : 'Mostrar'}</span></summary>
    <form class="qadd" data-qadd><label class="sr-only" for="qIn">Nueva tarea rápida</label><input class="field" id="qIn" placeholder="Anota un pendiente…" autocomplete="off" maxlength="200"><button type="submit" class="btn-primary sm" aria-label="Agregar">${icon('plus', 2.4)}</button></form>
    ${pending.map(item).join('')}
    ${done.length ? `<div class="card-head" style="padding-top:6px"><span class="small">Hechas (${done.length})</span><button type="button" class="btn-link" data-qclear>Borrar hechas</button></div>${done.map(item).join('')}` : ''}
  </details>`;
}

function todayHTML() {
  const list = K.filtered('today', st);
  const today = localDate();
  const g = { late: [], today: [], rec: [], future: [], missed: [], worked: [], done: [] };
  for (const t of list) {
    if (K.workedTodayRange(t)) g.worked.push(t);
    else if (K.isFutureRange(t)) g.future.push(t);
    else if (t.is_recurring && !K.isClosed(t)) g.rec.push(t);
    else if (t.status === 'done') g.done.push(t);
    else if (t.status === 'missed') g.missed.push(t);
    else if (t.due_date && t.due_date < today && !K.isRangeTask(t)) g.late.push(t);
    else g.today.push(t);
  }
  g.future.sort((a, b) => a.due_date.localeCompare(b.due_date));
  const rem = K.tomorrowReminders();
  return quickHTML()
    + group('Vencidas', g.late) + group('Hoy', g.today) + group('Recurrentes', g.rec)
    + (rem.length ? group('Mañana · te lo recuerdo', rem) : '')
    + group('A futuro', g.future) + group('No completadas', g.missed) + group('Avanzaste hoy', g.worked) + group('Completadas hoy', g.done)
    || '<div class="card"><div class="small">No hay tareas para hoy.</div></div>';
}

function upcomingHTML() {
  const list = K.filtered('upcoming', st);
  const byDate = (a, b) => (a.due_date || '').localeCompare(b.due_date || '') || (a.due_time || '').localeCompare(b.due_time || '') || (K.PRIORITY_RANK[K.effPriority(a)] ?? 3) - (K.PRIORITY_RANK[K.effPriority(b)] ?? 3);
  const exact = list.filter(t => !K.isRangeTask(t)).sort(byDate), range = list.filter(K.isRangeTask).sort(byDate);
  return (group('Día exacto', exact) + group('Con fecha límite', range)) || '<div class="card"><div class="small">Nada próximo.</div></div>';
}

function missedHTML() {
  const list = K.filtered('missed', st).sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (!list.length) return '<div class="card"><div class="small">Todo al día: no hay tareas vencidas.</div></div>';
  const by = {};
  list.forEach(t => (by[t.due_date] = by[t.due_date] || []).push(t));
  return Object.keys(by).sort().map(d => group(new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }), by[d])).join('');
}

function pastHTML() {
  const recent = (a, b) => String(b.completed_at || b.due_date || '').localeCompare(String(a.completed_at || a.due_date || ''));
  const open = (() => { try { return JSON.parse(ls.get('v2PastOpen', '{}')); } catch { return {}; } })();
  const sec = (key, label, arr) => `<details class="tgroup past" data-past="${key}" ${open[key] ? 'open' : ''}>
    <summary class="tgroup-h">${label} <span>${arr.length}</span></summary>
    ${arr.slice(0, st.pastLimit[key]).map(cardHTML).join('') || '<div class="small" style="padding:8px 0">Nada por aquí.</div>'}
    ${arr.length > st.pastLimit[key] ? `<button type="button" class="btn-ghost sm" data-past-more="${key}">Ver ${Math.min(30, arr.length - st.pastLimit[key])} más</button>` : ''}
  </details>`;
  return sec('done', 'Completadas', T.tasks.filter(t => t.status === 'done').sort(recent)) + sec('missed', 'No completadas', T.tasks.filter(t => t.status === 'missed').sort(recent));
}

function orderHTML() {
  const { open, closed } = K.orderedToday();
  const row = (t, n, isClosed) => `<div class="oitem${isClosed ? ' closed' : ''}" data-id="${escapeHTML(t.id)}">
    ${isClosed ? '' : `<span class="ohandle" aria-hidden="true" title="Arrastra para ordenar"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span><span class="onum">${n}</span>`}
    <button type="button" class="check ${t.status === 'done' ? 'done' : t.status === 'missed' ? 'missed' : ''}" data-check aria-label="${isClosed ? 'Reabrir' : 'Completar'}: ${escapeHTML(t.title)}">${t.status === 'done' ? icon('check', 3) : t.status === 'missed' ? icon('x', 3) : ''}</button>
    <button type="button" class="tcard-main" data-edit><span class="task-title">${escapeHTML(t.title)}</span>${dueText(t) ? `<span class="task-meta">${escapeHTML(dueText(t))}</span>` : ''}</button>
    ${isClosed ? '' : `<span class="order-move"><button type="button" class="icon-btn sm" data-omove="-1" aria-label="Subir ${escapeHTML(t.title)}">${icon('up')}</button><button type="button" class="icon-btn sm" data-omove="1" aria-label="Bajar ${escapeHTML(t.title)}">${icon('down')}</button></span>`}
    ${isClosed ? '' : badge(t)}
  </div>`;
  return `<div class="small" style="padding:0 4px">Arrastra ⋮⋮ (o usa las flechas) para decidir en qué orden harás tus tareas de hoy.</div>
    <div class="card" style="gap:0;padding-top:8px;padding-bottom:8px"><div class="olist" id="olist">${open.length ? open.map((t, i) => row(t, i + 1, false)).join('') : '<div class="small" style="padding:10px 0">No hay tareas pendientes para hoy.</div>'}</div></div>
    ${closed.length ? `<div class="tgroup"><h2 class="tgroup-h">Completadas hoy <span>${closed.length}</span></h2><div class="card" style="gap:0;padding-top:8px;padding-bottom:8px">${closed.map(t => row(t, 0, true)).join('')}</div></div>` : ''}`;
}

function bodyHTML() {
  if (st.view === 'today') return todayHTML();
  if (st.view === 'order') return orderHTML();
  if (st.view === 'upcoming') return upcomingHTML();
  if (st.view === 'missed') return missedHTML();
  if (st.view === 'past') return pastHTML();
  const list = K.filtered(st.view, st);
  return list.length ? `<div class="tgroup">${list.map(cardHTML).join('')}</div>` : '<div class="card"><div class="small">No hay tareas aquí.</div></div>';
}

function counts() {
  const today = localDate();
  return {
    today: T.tasks.filter(t => !K.rangeHidden(t) && K.isTodayTask(t, today) && !K.isClosed(t) && !K.isFutureRange(t)).length,
    missed: T.tasks.filter(t => !K.isClosed(t) && t.due_date && t.due_date < today && !K.rangeHidden(t)).length
  };
}

function paint() {
  const c = counts();
  const sideCount = document.getElementById('sideTaskCount'); if (sideCount) sideCount.textContent = c.today || '';
  const showFilters = !['order', 'past'].includes(st.view);
  const scroll = root.querySelector('.views')?.scrollLeft || 0;
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center">
      <h1 class="hello" style="margin:0">Tareas</h1>
      <button type="button" class="btn-dark round" data-new aria-label="Nueva tarea">${icon('plus', 2.4)}<span class="lbl">Nueva tarea</span></button>
    </header>
    <nav class="views" aria-label="Vistas de tareas">
      ${Object.entries(VIEWS).map(([k, v]) => `<button type="button" class="vchip" data-view="${k}" aria-pressed="${k === st.view}">${v}${k === 'today' && c.today ? ` <span>${c.today}</span>` : ''}${k === 'missed' && c.missed ? ` <span class="warn">${c.missed}</span>` : ''}</button>`).join('')}
      ${Object.entries(K.CATEGORIES).map(([k, v]) => `<button type="button" class="vchip" data-view="project_${k}" aria-pressed="${st.view === 'project_' + k}">${v}</button>`).join('')}
    </nav>
    ${showFilters ? `<div class="tfilters">
      <label class="sr-only" for="tSearch">Buscar</label>
      <input class="field" id="tSearch" type="search" placeholder="Buscar…" value="${escapeHTML(st.search)}" autocomplete="off">
      <label class="sr-only" for="tPrio">Prioridad</label>
      <select class="field" id="tPrio">${Object.entries(PRIO_FILTERS).map(([k, v]) => `<option value="${k}"${k === st.priority ? ' selected' : ''}>${k === 'all' ? 'Prioridad: todas' : v}</option>`).join('')}</select>
    </div>` : ''}
    <div class="tbody">${bodyHTML()}</div>
  </div>`;
  const views = root.querySelector('.views'); if (views) views.scrollLeft = scroll;
  bind();
}
const rerender = () => { if (root && document.body.contains(root)) paint(); };

// ── Eventos ──────────────────────────────────────────
function bind() {
  root.querySelector('[data-new]').onclick = () => openTaskModal(null);
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { st.view = b.dataset.view; ls.set('v2TasksView', st.view); paint(); });
  const s = root.querySelector('#tSearch');
  if (s) s.oninput = () => { st.search = s.value.trim(); const pos = s.selectionStart; paint(); const n = root.querySelector('#tSearch'); n.focus(); n.setSelectionRange(pos, pos); };
  const p = root.querySelector('#tPrio'); if (p) p.onchange = () => { st.priority = p.value; paint(); };
  root.querySelectorAll('[data-id]').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('[data-check]')?.addEventListener('click', () => K.toggleTask(id, rerender));
    card.querySelector('[data-edit]')?.addEventListener('click', () => openTaskModal(id));
    card.querySelector('[data-more]')?.addEventListener('click', () => actionsSheet(id));
    card.querySelectorAll('[data-omove]').forEach(b => b.onclick = () => moveOrder(id, Number(b.dataset.omove)));
  });
  root.querySelectorAll('.ohandle').forEach(h => h.addEventListener('pointerdown', startDrag));
  // Tareas rápidas
  const q = root.querySelector('[data-quick]');
  if (q) {
    q.addEventListener('toggle', () => { ls.set('v2QuickOpen', q.open ? '1' : '0'); const m = q.querySelector('summary .muted'); if (m) m.textContent = q.open ? 'Ocultar' : 'Mostrar'; });
    q.querySelector('[data-qadd]').onsubmit = e => { e.preventDefault(); const i = q.querySelector('#qIn'); const v = i.value.trim(); if (!v) return; i.value = ''; K.addQuick(v, () => { rerender(); root.querySelector('#qIn')?.focus(); }); };
    q.querySelectorAll('[data-qtoggle]').forEach(b => b.onclick = () => K.toggleQuick(b.dataset.qtoggle, rerender));
    q.querySelectorAll('[data-qdel]').forEach(b => b.onclick = () => K.deleteQuick(b.dataset.qdel, rerender));
    q.querySelector('[data-qclear]')?.addEventListener('click', () => K.clearDoneQuick(rerender));
  }
  root.querySelectorAll('details[data-past]').forEach(d => d.addEventListener('toggle', () => {
    let o = {}; try { o = JSON.parse(ls.get('v2PastOpen', '{}')); } catch { /* vacío */ }
    o[d.dataset.past] = d.open; ls.set('v2PastOpen', JSON.stringify(o));
  }));
  root.querySelectorAll('[data-past-more]').forEach(b => b.onclick = () => { st.pastLimit[b.dataset.pastMore] += 30; paint(); });
}

function actionsSheet(id) {
  const t = T.tasks.find(x => String(x.id) === String(id)); if (!t) return;
  const closed = K.isClosed(t);
  const acts = [
    K.rangeActive(t) && ['worked', K.workedToday(t) ? 'Quitar el avance de hoy' : 'Avancé hoy (no la termina)'],
    !closed && ['progress', t.status === 'in_progress' ? 'Regresar a pendiente' : 'Marcar en progreso'],
    !closed && ['missed', 'No la completé (no se repite)'],
    !closed && t.due_date !== K.tomorrowStr() && ['tomorrow', 'Pasar a mañana'],
    ['duplicate', 'Duplicar para mañana'],
    ['edit', 'Editar'],
    ['delete', 'Eliminar']
  ].filter(Boolean);
  openModal(t.title, `<div class="more-list">${acts.map(([k, v]) => `<button type="button" data-act="${k}"${k === 'delete' ? ' style="color:var(--alert)"' : ''}>${escapeHTML(v)}</button>`).join('')}</div>`);
  document.querySelectorAll('#modal [data-act]').forEach(b => b.onclick = () => {
    closeModal();
    const a = b.dataset.act;
    if (a === 'worked') K.toggleWorkedToday(id, rerender);
    else if (a === 'progress') K.markInProgress(id, rerender);
    else if (a === 'missed') K.markMissed(id, rerender);
    else if (a === 'tomorrow') K.moveToTomorrow(id, rerender);
    else if (a === 'duplicate') K.duplicateToTomorrow(id, rerender);
    else if (a === 'edit') openTaskModal(id);
    else if (a === 'delete') K.deleteTask(id, rerender);
  });
}

// ── Orden del día ────────────────────────────────────
function orderIds() { return [...root.querySelectorAll('#olist .oitem')].map(x => x.dataset.id); }
function moveOrder(id, dir) {
  const ids = orderIds(), i = ids.indexOf(String(id)), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  K.saveDayOrder(ids, rerender); // asigna day_order al instante (antes de esperar la red) y guarda
  paint();
}
// Arrastre con Pointer Events (igual que v1): no se reinserta el nodo arrastrado, se mueven los vecinos.
function startDrag(e) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  const handle = e.currentTarget, item = handle.closest('.oitem'), list = item.parentElement;
  const grab = e.clientY - item.getBoundingClientRect().top;
  let lastY = e.clientY, raf = 0;
  try { handle.setPointerCapture(e.pointerId); } catch { /* sin capture */ }
  item.classList.add('dragging');
  const sibs = () => [...list.querySelectorAll('.oitem:not(.closed)')];
  const place = () => {
    item.style.transform = '';
    const top = item.getBoundingClientRect().top, h = item.offsetHeight, want = lastY - grab, center = want + h / 2;
    const s = sibs(), i = s.indexOf(item), prev = s[i - 1], next = s[i + 1];
    if (prev) { const r = prev.getBoundingClientRect(); if (center < r.top + r.height / 2) { list.insertBefore(prev, item.nextSibling); return place(); } }
    if (next) { const r = next.getBoundingClientRect(); if (center > r.top + r.height / 2) { list.insertBefore(next, item); return place(); } }
    item.style.transform = `translateY(${want - top}px)`;
  };
  const tick = () => {
    const edge = 90;
    if (lastY < edge) window.scrollBy(0, -Math.ceil((edge - lastY) / 6));
    else if (lastY > window.innerHeight - edge) window.scrollBy(0, Math.ceil((lastY - (window.innerHeight - edge)) / 6));
    place(); raf = requestAnimationFrame(tick);
  };
  const move = ev => { lastY = ev.clientY; place(); };
  const end = () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end);
    item.style.transform = ''; item.classList.remove('dragging');
    root.querySelectorAll('#olist .onum').forEach((n, k) => { n.textContent = k + 1; });
    K.saveDayOrder(orderIds(), rerender);
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  raf = requestAnimationFrame(tick);
}

// ── Formulario ───────────────────────────────────────
const DAY_BTNS = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
export function openTaskModal(id, onSaved) {
  const t = id ? T.tasks.find(x => String(x.id) === String(id)) : null;
  const f = {
    title: t?.title || '', priority: t?.priority || '', mode: t && K.isRangeTask(t) ? 'deadline' : 'exact',
    due: t?.due_date || '', time: t?.due_time ? t.due_time.slice(0, 5) : '', start: t?.start_date || '',
    remind: !!t?.remind_day_before, recur: '', days: [], endDate: t?.end_date || '', category: t?.category || '',
    est: t?.estimated_minutes || ''
  };
  if (t?.recurrence) {
    const legacy = K.legacyRecurrenceToDays(t.recurrence, t.due_date);
    if (t.recurrence.startsWith('custom:')) { f.recur = 'custom'; f.days = t.recurrence.slice(7).split(',').filter(x => x !== '').map(Number); }
    else if (legacy) { f.recur = 'custom'; f.days = legacy; }
    else f.recur = t.recurrence; // 'monthly' se conserva
  }
  const body = () => `
    <label class="flabel" for="fTitle" style="margin-top:0">Título</label>
    <input class="field" id="fTitle" maxlength="200" autocomplete="off" placeholder="¿Qué hay que hacer?" value="${escapeHTML(f.title)}">
    <span class="flabel">Prioridad</span>
    <div class="seg4" role="group" aria-label="Prioridad">${Object.entries(K.PRIORITIES).map(([k, v]) => `<button type="button" data-prio="${k}" aria-pressed="${f.priority === k}" class="p-${k}">${v}</button>`).join('')}</div>
    <span class="flabel">¿Qué tipo de fecha?</span>
    <div class="seg" role="group" aria-label="Tipo de fecha" style="grid-template-columns:repeat(2,minmax(0,1fr));max-width:none">
      <button type="button" data-mode="exact" aria-pressed="${f.mode === 'exact'}">Día exacto</button>
      <button type="button" data-mode="deadline" aria-pressed="${f.mode === 'deadline'}">Con fecha límite</button>
    </div>
    <div class="row2">
      <div><label class="flabel" for="fDue">${f.mode === 'deadline' ? 'Fecha límite' : 'Fecha'}</label><input class="field" id="fDue" type="date" value="${f.due}"></div>
      <div><label class="flabel" for="fTime">Hora</label><input class="field" id="fTime" type="time" value="${f.time}"></div>
    </div>
    ${f.mode === 'deadline' ? `<label class="flabel" for="fStart">Empiezo a trabajarla desde <span class="muted">(antes no aparece)</span></label><input class="field" id="fStart" type="date" value="${f.start || todayStr()}">` : ''}
    <label class="toggle-row"><input type="checkbox" id="fRemind"${f.remind ? ' checked' : ''}> Recordarme el día anterior</label>
    <span class="flabel">Repetir</span>
    <div class="seg" role="group" aria-label="Repetir" style="grid-template-columns:repeat(2,minmax(0,1fr));max-width:none">
      <button type="button" data-recur="" aria-pressed="${!f.recur}">No repetir</button>
      <button type="button" data-recur="custom" aria-pressed="${f.recur === 'custom' || f.recur === 'monthly'}">${f.recur === 'monthly' ? 'Mensual' : 'Ciertos días'}</button>
    </div>
    ${f.recur === 'custom' ? `<div class="days7" role="group" aria-label="Días">${DAY_BTNS.map(([d, l]) => `<button type="button" data-day="${d}" aria-pressed="${f.days.includes(d)}" aria-label="${['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][d]}">${l}</button>`).join('')}</div>` : ''}
    ${f.recur ? `<label class="flabel" for="fEnd">Se repite hasta <span class="muted">(opcional)</span></label><input class="field" id="fEnd" type="date" value="${f.endDate}">` : ''}
    <div class="row2">
      <div><label class="flabel" for="fCat">Categoría</label><select class="field" id="fCat"><option value="">Sin categoría</option>${Object.entries(K.CATEGORIES).map(([k, v]) => `<option value="${k}"${f.category === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="flabel" for="fEst">Minutos estimados</label><input class="field" id="fEst" inputmode="numeric" value="${f.est}" autocomplete="off"></div>
    </div>`;
  const read = () => {
    const v = id2 => document.getElementById(id2);
    f.title = v('fTitle').value; f.due = v('fDue').value; f.time = v('fTime').value;
    if (v('fStart')) f.start = v('fStart').value;
    f.remind = v('fRemind').checked; if (v('fEnd')) f.endDate = v('fEnd').value;
    f.category = v('fCat').value; f.est = v('fEst').value;
  };
  const rebind = () => {
    const m = document.getElementById('modal');
    m.querySelector('.modal-body').innerHTML = body();
    m.querySelectorAll('[data-prio]').forEach(b => b.onclick = () => { read(); f.priority = b.dataset.prio; rebind(); });
    m.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { read(); f.mode = b.dataset.mode; if (f.mode === 'exact') f.start = ''; rebind(); });
    m.querySelectorAll('[data-recur]').forEach(b => b.onclick = () => { read(); f.recur = b.dataset.recur === 'custom' && f.recur === 'monthly' ? 'monthly' : b.dataset.recur; if (!f.recur) f.days = []; rebind(); });
    m.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { read(); const d = Number(b.dataset.day); f.days = f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d]; rebind(); });
  };
  openModal(t ? 'Editar tarea' : 'Nueva tarea', body(), `<button type="button" class="btn-primary" id="fSave">${t ? 'Guardar cambios' : 'Crear tarea'}</button>`);
  rebind();
  if (!t) setTimeout(() => document.getElementById('fTitle')?.focus(), 50);
  document.getElementById('fSave').onclick = async () => {
    read();
    const title = f.title.trim();
    const start = f.mode === 'deadline' ? f.start : '';
    const err =
      !title ? 'El título es requerido' :
      !f.priority ? 'Elige una prioridad' :
      f.recur === 'custom' && !f.days.length ? 'Elige al menos un día para repetir' :
      f.mode === 'deadline' && !f.due ? 'Pon la fecha límite' :
      f.mode === 'deadline' && !start ? 'Pon desde cuándo empiezas a trabajarla' :
      f.remind && !f.due ? 'Para recordarte el día anterior, la tarea necesita fecha' :
      start && f.due && start > f.due ? 'El inicio no puede ser después de la fecha límite' :
      start && f.recur ? 'Una tarea recurrente no puede tener inicio; quita uno de los dos' :
      f.est && !/^\d{1,4}$/.test(String(f.est)) ? 'Los minutos deben ser un número' : '';
    if (err) return showToast(err, 'error');
    const btn = document.getElementById('fSave'); btn.disabled = true;
    try {
      await K.saveTask(t?.id, { ...f, title, start });
      closeModal(); showToast(t ? 'Tarea actualizada' : 'Tarea creada');
      if (onSaved) onSaved(); else rerender();
    } catch (e) { btn.disabled = false; showToast('No se pudo guardar: ' + (e.message || '').slice(0, 120), 'error'); }
  };
}
