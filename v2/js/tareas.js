// Tareas: datos, reglas y acciones. Port fiel de v1 (index.html): isTodayTask, rangos, recurrentes
// (checkRecurring / spawnNextRecurring / shouldRecurOnDate), missed, pasar/duplicar a mañana,
// "avancé hoy" y Orden del día. Mismas tablas y columnas; nada de esquema nuevo.
// Diferencia con v1: las acciones son optimistas (se ven al instante) con rollback + toast.
import { dbGet, dbPost, dbPatch, dbDelete, safeGet } from './db.js?v=202611091124';
import { localDate, todayStr, daysUntil, showToast } from './util.js?v=202611091124';

export const T = { tasks: [], subtasks: [], quick: [], loaded: false, recurringChecked: false };

export async function loadTasks() {
  const [tasks, subtasks, quick] = await Promise.all([
    dbGet('tasks', '?order=position.asc,created_at.desc'),
    safeGet('subtasks', '?order=position.asc'),
    safeGet('quick_tasks', '?order=created_at.asc')
  ]);
  T.tasks = tasks || []; T.subtasks = subtasks || []; T.quick = quick || []; T.loaded = true;
  return T;
}

// ── Fechas ────────────────────────────────────────────
export const tomorrowStr = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localDate(d); };
export function shortDay(d) { return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''); }
export function formatDate(s) { return new Date(s + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', ''); }

// ── Reglas de v1 ─────────────────────────────────────
export const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
export const PRIORITIES = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' };
export const CATEGORIES = { trabajo: 'Trabajo', personal: 'Personal', fitness: 'Fitness', proyectos: 'Proyectos' };
export const isClosed = t => t.status === 'done' || t.status === 'missed';
export const isRangeTask = t => !!(t.start_date && t.due_date);
const rangeOpen = t => isRangeTask(t) && !isClosed(t);
export const workedToday = t => (t.worked_dates || []).includes(todayStr());
export const rangeHidden = t => rangeOpen(t) && todayStr() < t.start_date;
export const rangeActive = t => rangeOpen(t) && todayStr() >= t.start_date;
export const isFutureRange = t => rangeActive(t) && !workedToday(t) && daysUntil(t.due_date) > 7;
export const workedTodayRange = t => rangeActive(t) && workedToday(t);
export function rangePriority(t) {
  const n = daysUntil(t.due_date);
  return n <= 1 ? 'critical' : n <= 3 ? 'high' : n <= 7 ? 'medium' : 'low';
}
export const effPriority = t => rangeActive(t) ? rangePriority(t) : t.priority;
export function rangeDueText(t) {
  const n = daysUntil(t.due_date);
  if (n < 0) return `vencida hace ${-n} día${n === -1 ? '' : 's'}`;
  if (n === 0) return 'vence hoy';
  return `faltan ${n} día${n === 1 ? '' : 's'}`;
}

export function isTodayTask(t, today = localDate()) {
  if (isRangeTask(t) && !isClosed(t)) {
    if (rangeHidden(t)) return false;
    if (workedToday(t)) return false;
    return daysUntil(t.due_date) <= 7;
  }
  if (t.status === 'in_progress') return true;
  if (isClosed(t)) return !!t.completed_at && localDate(new Date(t.completed_at)) === today;
  if (!t.due_date) return true;
  return t.due_date <= today;
}
export const sortByPriority = list => [...list].sort((a, b) => (PRIORITY_RANK[effPriority(a)] ?? 3) - (PRIORITY_RANK[effPriority(b)] ?? 3));

// Recurrentes: en Todas/Próximas/categorías se ven UNA vez (la ocurrencia más próxima).
const recurKey = t => t.is_recurring ? `${t.title}|${t.category || ''}` : null;
export function dedupeRecurring(list) {
  const idx = new Map(), out = [];
  for (const t of list) {
    if (!t.is_recurring) { out.push(t); continue; }
    const k = recurKey(t);
    if (!idx.has(k)) { idx.set(k, out.length); out.push(t); }
    else { const i = idx.get(k); if ((t.due_date || '9999-99-99') < (out[i].due_date || '9999-99-99')) out[i] = t; }
  }
  return out;
}

// Vistas: today | tomorrow | upcoming | missed | all | project_<id>
export function filtered(view, { priority = 'all', search = '' } = {}) {
  const today = localDate(), tomorrow = tomorrowStr();
  let list = view === 'upcoming' ? [...T.tasks] : T.tasks.filter(t => !rangeHidden(t));
  if (view === 'today') list = list.filter(t => isTodayTask(t, today) || isFutureRange(t) || workedTodayRange(t));
  else if (view === 'tomorrow') list = list.filter(t => t.status !== 'done' && t.due_date === tomorrow);
  else if (view === 'upcoming') list = list.filter(t => !isClosed(t) && ((t.end_date && t.end_date > today) || (!t.end_date && t.due_date && t.due_date > today)));
  else if (view === 'missed') list = list.filter(t => !isClosed(t) && t.due_date && t.due_date < today);
  else if (view.startsWith('project_')) { const pid = view.slice(8); list = list.filter(t => t.category === pid && !isClosed(t)); }
  else list = list.filter(t => !isClosed(t));
  if (view === 'all' || view === 'upcoming' || view.startsWith('project_')) list = dedupeRecurring(list);
  if (priority !== 'all') list = list.filter(t => effPriority(t) === priority);
  if (search) { const q = search.toLowerCase(); list = list.filter(t => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)); }
  return sortByPriority(list);
}

// Recordatorio del día anterior (sección "Mañana" en Hoy).
export const tomorrowReminders = () => T.tasks.filter(t => t.remind_day_before && t.due_date && !isClosed(t) && daysUntil(t.due_date) === 1 && !rangeActive(t));

// Orden del día: con fecha de hoy (o de rango en Hoy), abiertas por day_order y luego prioridad.
export function orderedToday() {
  const today = localDate();
  const list = T.tasks.filter(t => (t.due_date === today || isRangeTask(t)) && isTodayTask(t, today));
  const idx = new Map(T.tasks.map((t, i) => [t.id, i]));
  const open = list.filter(t => !isClosed(t)).sort((a, b) =>
    (a.day_order ?? 1e9) - (b.day_order ?? 1e9) || (PRIORITY_RANK[effPriority(a)] ?? 3) - (PRIORITY_RANK[effPriority(b)] ?? 3) || idx.get(a.id) - idx.get(b.id));
  return { open, closed: list.filter(isClosed) };
}

// ── Recurrencia ──────────────────────────────────────
const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export function recurrenceLabel(r) {
  if (!r) return '';
  if (r === 'daily') return 'Diario';
  if (r === 'weekly') return 'Semanal';
  if (r === 'weekdays') return 'Lunes–Viernes';
  if (r === 'monthly') return 'Mensual';
  if (r.startsWith('monthday:')) return `Cada mes, día ${r.slice(9)}`;
  if (r.startsWith('custom:')) return r.slice(7).split(',').filter(x => x !== '').map(n => DAY_NAMES[+n]).join(', ');
  return r;
}
export function legacyRecurrenceToDays(recurrence, dueDate) {
  if (recurrence === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (recurrence === 'weekdays') return [1, 2, 3, 4, 5];
  if (recurrence === 'weekly' && dueDate) return [new Date(dueDate + 'T12:00:00').getDay()];
  return null;
}
// 'monthday:N' = cada mes el día N; en meses más cortos, el último día del mes.
export const monthDayOf = r => (r && r.startsWith('monthday:') ? Math.min(31, Math.max(1, parseInt(r.slice(9), 10) || 1)) : null);
const lastDay = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export function nextMonthDay(n, from = new Date()) { // hoy o la siguiente fecha con ese día
  const d = new Date(from); d.setHours(12, 0, 0, 0);
  const here = Math.min(n, lastDay(d));
  if (d.getDate() <= here) { d.setDate(here); return d; }
  const nx = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
  nx.setDate(Math.min(n, lastDay(nx))); return nx;
}
export function shouldRecurOnDate(t, d) {
  const day = d.getDay();
  const md = monthDayOf(t.recurrence);
  if (md) return d.getDate() === Math.min(md, lastDay(d));
  if (t.recurrence === 'daily') return true;
  if (t.recurrence === 'weekdays') return day >= 1 && day <= 5;
  if (t.recurrence === 'weekly' && t.due_date) return new Date(t.due_date + 'T12:00:00').getDay() === day;
  if (t.recurrence === 'monthly' && t.due_date) return new Date(t.due_date + 'T12:00:00').getDate() === d.getDate();
  if (t.recurrence && t.recurrence.startsWith('custom:')) return t.recurrence.slice(7).split(',').filter(x => x !== '').map(Number).includes(day);
  return false;
}
const copyForDate = (t, dateStr) => {
  const { id, created_at, completed_at, ...rest } = t;
  return { ...rest, status: 'todo', due_date: dateStr, completed_at: null };
};

// Igual que checkRecurring() de v1: hoy + 7 días para cada recurrente no completada.
// El índice único (title, due_date) where is_recurring evita duplicados si v1 y v2 corren a la vez.
export async function checkRecurring() {
  if (T.recurringChecked) return 0;
  T.recurringChecked = true;
  let created = 0;
  const recurring = T.tasks.filter(t => t.is_recurring && t.recurrence && t.status !== 'done');
  for (const t of recurring) {
    for (let i = 0; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const ds = localDate(d);
      if (ds === t.due_date) continue;
      if (t.due_date && ds < t.due_date) continue;
      if (t.end_date && ds > t.end_date) continue;
      if (!shouldRecurOnDate(t, d)) continue;
      if (T.tasks.some(x => x.title === t.title && x.due_date === ds)) continue;
      try { const [r] = await dbPost('tasks', copyForDate(t, ds)); T.tasks.push(r); created++; }
      catch (e) { console.warn('checkRecurring', e); } // 409 = ya existe (otra pestaña o v1)
    }
  }
  return created;
}
// Al completar una recurrente: crea la siguiente ocurrencia (spawnNextRecurring de v1).
async function spawnNextRecurring(t) {
  const next = new Date(); next.setHours(12, 0, 0, 0);
  if (t.recurrence === 'daily' || t.recurrence === 'weekdays') {
    next.setDate(next.getDate() + 1);
    if (t.recurrence === 'weekdays') while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  } else if (t.recurrence === 'weekly') next.setDate(next.getDate() + 7);
  else if (t.recurrence === 'monthly') next.setMonth(next.getMonth() + 1);
  else if (monthDayOf(t.recurrence)) { const nx = new Date(next); nx.setDate(nx.getDate() + 1); next.setTime(nextMonthDay(monthDayOf(t.recurrence), nx).getTime()); }
  else if (t.recurrence && t.recurrence.startsWith('custom:')) {
    next.setDate(next.getDate() + 1);
    let guard = 0;
    while (!shouldRecurOnDate(t, next) && guard < 14) { next.setDate(next.getDate() + 1); guard++; }
  }
  const ns = localDate(next);
  if (t.end_date && ns > t.end_date) return;
  if (T.tasks.some(x => x.title === t.title && x.due_date === ns && x.id !== t.id)) return;
  try { const [r] = await dbPost('tasks', copyForDate(t, ns)); T.tasks.push(r); } catch (e) { console.warn('spawnNextRecurring', e); }
}

// ── Acciones (optimistas) ────────────────────────────
const find = id => T.tasks.find(t => String(t.id) === String(id));
async function optimistic(t, patch, rerender, okMsg, errMsg) {
  const prev = {}; for (const k of Object.keys(patch)) prev[k] = t[k];
  Object.assign(t, patch); rerender();
  try { await dbPatch('tasks', patch, `?id=eq.${t.id}`); if (okMsg) showToast(okMsg); return true; }
  catch (e) { Object.assign(t, prev); rerender(); showToast(errMsg || 'No se pudo guardar', 'error'); return false; }
}

export async function toggleTask(id, rerender) {
  const t = find(id); if (!t) return;
  const done = t.status === 'todo' || t.status === 'in_progress';
  const ok = await optimistic(t, { status: done ? 'done' : 'todo', completed_at: done ? new Date().toISOString() : null }, rerender, done ? 'Tarea completada' : 'Tarea reabierta');
  if (ok && done && t.is_recurring && t.recurrence) { await spawnNextRecurring(t); rerender(); }
}
export async function markInProgress(id, rerender) {
  const t = find(id); if (!t || t.status === 'done') return;
  const s = t.status === 'in_progress' ? 'todo' : 'in_progress';
  await optimistic(t, { status: s }, rerender, s === 'in_progress' ? 'Marcada en progreso' : 'De vuelta a pendiente');
}
export async function markMissed(id, rerender) {
  const t = find(id); if (!t || isClosed(t)) return;
  await optimistic(t, { status: 'missed', completed_at: new Date().toISOString() }, rerender, 'Marcada como no completada');
}
export async function moveToTomorrow(id, rerender) {
  const t = find(id); if (!t || isClosed(t)) return;
  const tm = tomorrowStr(); if (t.due_date === tm) return;
  if (T.tasks.some(x => x.id !== t.id && x.title === t.title && x.due_date === tm)) return showToast(`Ya existe "${t.title}" para mañana`, 'error');
  await optimistic(t, { due_date: tm }, rerender, 'Movida a mañana');
}
export async function duplicateToTomorrow(id, rerender) {
  const t = find(id); if (!t) return;
  const tm = tomorrowStr();
  if (T.tasks.some(x => x.id !== t.id && x.title === t.title && x.due_date === tm)) return showToast(`Ya existe "${t.title}" para mañana`, 'error');
  const { id: _id, created_at, completed_at, ...rest } = t;
  const body = { ...rest, status: 'todo', due_date: tm, completed_at: null, is_recurring: false, recurrence: null, end_date: null, position: T.tasks.length };
  try { const [r] = await dbPost('tasks', body); T.tasks.push(r); rerender(); showToast('Duplicada para mañana'); }
  catch { showToast('No se pudo duplicar', 'error'); }
}
export async function toggleWorkedToday(id, rerender) {
  const t = find(id); if (!t) return;
  const today = todayStr(), prev = (t.worked_dates || []).slice();
  const next = prev.includes(today) ? prev.filter(d => d !== today) : [...prev, today].sort();
  await optimistic(t, { worked_dates: next }, rerender, next.includes(today) ? 'Avance de hoy guardado. Vuelve a salir mañana.' : 'Quité el avance de hoy');
}
let lastDeleted = null;
export async function deleteTask(id, rerender) {
  const t = find(id); if (!t) return;
  const i = T.tasks.indexOf(t);
  T.tasks.splice(i, 1); rerender();
  try { await dbDelete('tasks', `?id=eq.${t.id}`); lastDeleted = t; showToast('Tarea eliminada', 'info', { label: 'Deshacer', onClick: () => undoDelete(rerender) }); }
  catch { T.tasks.splice(i, 0, t); rerender(); showToast('No se pudo eliminar', 'error'); }
}
async function undoDelete(rerender) {
  if (!lastDeleted) return;
  const { id, ...rest } = lastDeleted; lastDeleted = null;
  try { const [r] = await dbPost('tasks', rest); T.tasks.push(r); rerender(); showToast('Tarea restaurada'); }
  catch { showToast('No se pudo restaurar', 'error'); }
}
// Guarda el orden manual del día (day_order = índice).
export async function saveDayOrder(ids, rerender) {
  const changed = [];
  ids.forEach((id, i) => { const t = find(id); if (t && t.day_order !== i) { changed.push([t, t.day_order]); t.day_order = i; } });
  if (!changed.length) return;
  try { await Promise.all(changed.map(([t]) => dbPatch('tasks', { day_order: t.day_order }, `?id=eq.${t.id}`))); }
  catch { changed.forEach(([t, p]) => { t.day_order = p; }); rerender(); showToast('No se pudo guardar el orden', 'error'); }
}

// Crear / editar (mismo cuerpo que saveTask de v1).
export async function saveTask(editingId, f) {
  const recurrence = f.recur === 'custom' ? 'custom:' + [...f.days].sort((a, b) => a - b).join(',')
    : f.recur === 'monthday' ? `monthday:${f.monthDay}` : (f.recur || null); // 'monthly' viejo se conserva
  // Mensual sin fecha: la primera vez es el próximo día N (hoy si hoy es N).
  if (f.recur === 'monthday' && !f.due) f = { ...f, due: localDate(nextMonthDay(Number(f.monthDay))) };
  const body = {
    title: f.title, priority: f.priority, due_date: f.due || null, due_time: f.time || null,
    end_date: recurrence ? (f.endDate || null) : null, category: f.category || null,
    estimated_minutes: f.est ? parseInt(f.est, 10) : null, is_recurring: !!recurrence, recurrence
  };
  const editing = editingId ? find(editingId) : null;
  if (!editing) { body.tags = []; body.position = T.tasks.length; }
  if (f.start) body.start_date = f.start; else if (editing && editing.start_date) body.start_date = null;
  if (f.remind) body.remind_day_before = true; else if (editing && editing.remind_day_before) body.remind_day_before = false;
  if (editing) {
    const prev = { ...editing };
    Object.assign(editing, body);
    try { await dbPatch('tasks', body, `?id=eq.${editing.id}`); }
    catch (e) { Object.assign(editing, prev); throw e; }
    if (prev.is_recurring) await updateSeries(prev, editing).catch(e => console.warn('updateSeries', e));
    return editing;
  }
  const [r] = await dbPost('tasks', body);
  T.tasks.push(r);
  return r;
}

// Una recurrente es una serie de filas (una por día) con el mismo título. Al editar una, el cambio
// se aplica a sus copias pendientes de hoy en adelante; si no, al cambiarle el título quedaban dos
// series y se duplicaba cada día. Copias que ya no tocan (cambió la recurrencia o se quitó) se borran.
const SERIES_FIELDS = ['title', 'priority', 'due_time', 'category', 'estimated_minutes', 'recurrence', 'end_date', 'remind_day_before', 'is_recurring'];
async function updateSeries(prev, now) {
  const today = todayStr();
  const sibs = T.tasks.filter(x => x.id !== now.id && x.is_recurring && x.title === prev.title && x.due_date && x.due_date >= today && (x.status === 'todo' || x.status === 'in_progress'));
  if (!sibs.length) return;
  const patch = {}; for (const k of SERIES_FIELDS) if (k in now) patch[k] = now[k] ?? null;
  for (const x of sibs) {
    const d = new Date(x.due_date + 'T12:00:00');
    const gone = !now.is_recurring || !shouldRecurOnDate(now, d) || (now.end_date && x.due_date > now.end_date)
      || x.due_date === now.due_date
      || (now.title !== prev.title && T.tasks.some(y => y !== x && y.title === now.title && y.due_date === x.due_date));
    if (gone) { await dbDelete('tasks', `?id=eq.${x.id}`); T.tasks = T.tasks.filter(y => y !== x); }
    else { await dbPatch('tasks', patch, `?id=eq.${x.id}`); Object.assign(x, patch); }
  }
}

// ── Tareas rápidas ───────────────────────────────────
export async function addQuick(title, rerender) {
  const row = { id: 'temp-' + Date.now(), title, done: false };
  T.quick.push(row); rerender();
  try { const [c] = await dbPost('quick_tasks', { title, done: false }); const wasDone = row.done; Object.assign(row, c, { done: wasDone }); if (wasDone) await dbPatch('quick_tasks', { done: true, completed_at: new Date().toISOString() }, `?id=eq.${row.id}`); }
  catch { T.quick = T.quick.filter(q => q !== row); rerender(); showToast('No se pudo guardar', 'error'); }
}
export async function toggleQuick(id, rerender) {
  const q = T.quick.find(x => String(x.id) === String(id)); if (!q) return;
  q.done = !q.done; rerender();
  if (String(q.id).startsWith('temp-')) return;
  try { await dbPatch('quick_tasks', { done: q.done, completed_at: q.done ? new Date().toISOString() : null }, `?id=eq.${q.id}`); }
  catch { q.done = !q.done; rerender(); showToast('No se pudo actualizar', 'error'); }
}
export async function deleteQuick(id, rerender) {
  const q = T.quick.find(x => String(x.id) === String(id)); if (!q) return;
  T.quick = T.quick.filter(x => x !== q); rerender();
  if (String(q.id).startsWith('temp-')) return;
  try { await dbDelete('quick_tasks', `?id=eq.${q.id}`); } catch { T.quick.push(q); rerender(); showToast('No se pudo eliminar', 'error'); }
}
export async function clearDoneQuick(rerender) {
  const done = T.quick.filter(q => q.done && !String(q.id).startsWith('temp-'));
  T.quick = T.quick.filter(q => !q.done); rerender();
  try { for (const q of done) await dbDelete('quick_tasks', `?id=eq.${q.id}`); } catch { showToast('No se pudieron borrar todas', 'error'); }
}
