// Calendario Mes (cuadrícula desde domingo) y Semana, como la clásica: "Incluir completadas", día saturado
// (≥5 pendientes de día exacto) y tareas con fecha límite en cada día desde su inicio, con la prioridad de ese día.
import { escapeHTML, localDate, todayStr, icon } from '../util.js?v=202611041208';
import * as K from '../tareas.js?v=202611041208';
import { openTaskModal } from './tareas.js?v=202611041208';

const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const PRIO = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja', done: 'Completada', missed: 'No completada' };
let st = { mode: 'month', offset: 0, showDone: true, selected: null };
let root = null;
const ls = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage */ } } };

export async function show(el, isCurrent = () => true) {
  await K.loadTasks();
  if (!isCurrent()) return;
  root = el;
  st = { mode: ls.get('v2CalMode', 'month'), offset: 0, showDone: ls.get('v2CalDone', '1') === '1', selected: localDate() };
  paint();
  if (await K.checkRecurring() && isCurrent() && root === el) paint();
}

// ── Reglas (calTasksByDate de la clásica) ────────────
const addDays = (ds, n) => { const [y, m, d] = ds.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const between = (a, b) => { const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5); };
const prioFor = n => n <= 1 ? 'critical' : n <= 3 ? 'high' : n <= 7 ? 'medium' : 'low';
function byDate(list) {
  const out = {}, today = todayStr();
  for (const t of list) {
    if (!K.isRangeTask(t)) { (out[t.due_date] ||= []).push(t); continue; }
    const closedOn = t.completed_at ? localDate(new Date(t.completed_at)) : null;
    let end = t.due_date;
    if (K.isClosed(t)) { if (closedOn && closedOn < end) end = closedOn; if (closedOn && closedOn > end && t.status === 'done') end = closedOn; }
    else if (today > end) end = today;
    const from = end < t.start_date ? end : t.start_date;
    const total = Math.min(between(from, end), 366);
    for (let i = 0; i <= total; i++) {
      const ds = addDays(from, i), left = between(ds, t.due_date);
      (out[ds] ||= []).push({ ...t, priority: prioFor(left), __range: true, __left: left, __worked: (t.worked_dates || []).includes(ds) });
    }
  }
  Object.values(out).forEach(l => l.sort((a, b) => (K.PRIORITY_RANK[a.priority] ?? 3) - (K.PRIORITY_RANK[b.priority] ?? 3)));
  return out;
}
const cls = t => t.status === 'done' ? 'done' : t.status === 'missed' ? 'missed' : (t.priority || 'low');
const prefix = t => t.__range ? (t.__worked ? '✓ ' : '⏳ ') : '';
const rangeNote = t => t.__left < 0 ? `vencida hace ${-t.__left} d` : t.__left === 0 ? 'vence hoy' : `límite en ${t.__left} d`;
const saturated = list => list.filter(t => !t.__range && !K.isClosed(t)).length >= 5;

// ── Vistas ───────────────────────────────────────────
function monthHTML(map) {
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + st.offset);
  const y = base.getFullYear(), m = base.getMonth(), today = localDate();
  const start = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < start; i++) cells.push({ d: new Date(y, m, 1 - start + i), cur: false });
  for (let i = 1; i <= days; i++) cells.push({ d: new Date(y, m, i), cur: true });
  while (cells.length % 7) { const l = cells[cells.length - 1].d; cells.push({ d: new Date(l.getFullYear(), l.getMonth(), l.getDate() + 1), cur: false }); }
  const title = base.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return { title: title.charAt(0).toUpperCase() + title.slice(1), body: `<div class="cal-grid cal-dow" aria-hidden="true">${DOW.map(x => `<div>${x}</div>`).join('')}</div>
    <div class="cal-grid" role="grid" aria-label="${escapeHTML(title)}">${cells.map(({ d, cur }) => {
      const ds = localDate(d), list = map[ds] || [], sat = saturated(list);
      return `<button type="button" class="cal-cell${cur ? '' : ' other'}${ds === today ? ' today' : ''}${ds === st.selected ? ' sel' : ''}${sat ? ' sat' : ''}" data-day="${ds}" aria-label="${escapeHTML(d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }))}: ${list.length} tarea${list.length === 1 ? '' : 's'}${sat ? ', día saturado' : ''}">
        <span class="cal-num">${d.getDate()}${sat ? ' <span class="cal-warn" aria-hidden="true">!</span>' : ''}</span>
        <span class="cal-pills" aria-hidden="true">${list.slice(0, 3).map(t => `<span class="cal-pill ${cls(t)}">${escapeHTML(prefix(t) + t.title)}</span>`).join('')}${list.length > 3 ? `<span class="cal-more">+${list.length - 3}</span>` : ''}</span>
        <span class="cal-dots" aria-hidden="true">${list.slice(0, 4).map(t => `<i class="cdot ${cls(t)}"></i>`).join('')}</span>
      </button>`;
    }).join('')}</div>` };
}

function weekHTML(map) {
  const s = new Date(); s.setHours(12, 0, 0, 0); s.setDate(s.getDate() - s.getDay() + st.offset * 7);
  const days = [...Array(7)].map((_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; });
  const f = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '');
  const today = localDate();
  return { title: `${f(days[0])} – ${f(days[6])}`, body: `<section class="card" style="gap:0;padding-top:6px;padding-bottom:6px">${days.map((d, i) => {
    const ds = localDate(d), list = map[ds] || [], sat = saturated(list);
    return `<div class="cal-wrow${sat ? ' sat' : ''}">
      <button type="button" class="cal-wlabel${ds === today ? ' today' : ''}" data-day="${ds}" aria-label="Ver ${escapeHTML(d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric' }))}"><span>${DOW[i]}</span><b>${d.getDate()}</b>${sat ? '<span class="cal-warn">!</span>' : ''}</button>
      <div class="cal-wtasks">${list.map(t => itemBtn(t, true)).join('') || '<span class="small">Sin tareas</span>'}</div>
    </div>`;
  }).join('')}</section>` };
}

function itemBtn(t, compact) {
  const note = t.__range ? rangeNote(t) : t.due_time ? t.due_time.slice(0, 5) : '';
  return `<button type="button" class="cal-item ${cls(t)}${compact ? ' compact' : ''}" data-task="${escapeHTML(t.id)}">
    <i class="cdot ${cls(t)}" aria-hidden="true"></i>
    <span class="cal-item-t${t.status === 'done' ? ' struck' : ''}">${escapeHTML(prefix(t) + t.title)}</span>
    ${note ? `<em>${escapeHTML(note)}</em>` : ''}
  </button>`;
}

function dayHTML(map) {
  if (!st.selected) return '';
  const list = map[st.selected] || [];
  const label = new Date(st.selected + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, c => c.toUpperCase());
  return `<section class="card" style="gap:6px" aria-labelledby="calDayT">
    <div class="card-head"><h2 id="calDayT">${escapeHTML(label)}</h2>
      <button type="button" class="btn-link" data-newon="${st.selected}">+ Tarea este día</button></div>
    ${list.map(t => itemBtn(t, false)).join('') || '<div class="small">Sin tareas este día.</div>'}
  </section>`;
}

function paint() {
  const visible = K.T.tasks.filter(t => t.due_date && (st.showDone || !K.isClosed(t)));
  const map = byDate(visible);
  const v = st.mode === 'week' ? weekHTML(map) : monthHTML(map);
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center"><h1 class="hello" style="margin:0">Calendario</h1></header>
    <div class="cal-bar">
      <div class="seg" role="group" aria-label="Vista" style="grid-template-columns:repeat(2,minmax(0,1fr));max-width:220px">
        <button type="button" data-mode="month" aria-pressed="${st.mode === 'month'}">Mes</button>
        <button type="button" data-mode="week" aria-pressed="${st.mode === 'week'}">Semana</button>
      </div>
      <label class="toggle-row" style="margin:0"><input type="checkbox" id="calDone"${st.showDone ? ' checked' : ''}> Incluir completadas</label>
    </div>
    <div class="cal-nav">
      <button type="button" class="icon-btn" data-go="-1" aria-label="${st.mode === 'week' ? 'Semana' : 'Mes'} anterior">${icon('back')}</button>
      <h2>${escapeHTML(v.title)}</h2>
      <button type="button" class="icon-btn" data-go="1" aria-label="${st.mode === 'week' ? 'Semana' : 'Mes'} siguiente" style="transform:scaleX(-1)">${icon('back')}</button>
      ${st.offset ? '<button type="button" class="btn-ghost sm" data-go="0">Hoy</button>' : ''}
    </div>
    <div class="cal-layout"><div class="cal-main">${v.body}</div><div class="cal-side">${st.mode === 'month' ? dayHTML(map) : ''}
      <div class="cal-legend small"><span><i class="cdot critical"></i>Crítica</span><span><i class="cdot high"></i>Alta</span><span><i class="cdot medium"></i>Media</span><span><i class="cdot low"></i>Baja</span><span><i class="cdot done"></i>Hecha</span><span><i class="cdot missed"></i>No completada</span><span>⏳ con fecha límite · ! día saturado (5+ pendientes)</span></div>
    </div></div>
  </div>`;
  bind();
}
const again = () => { if (root && document.body.contains(root)) paint(); };

function bind() {
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; st.offset = 0; ls.set('v2CalMode', st.mode); paint(); });
  root.querySelector('#calDone').onchange = e => { st.showDone = e.target.checked; ls.set('v2CalDone', st.showDone ? '1' : '0'); paint(); };
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const v = Number(b.dataset.go); st.offset = v === 0 ? 0 : st.offset + v; paint(); });
  root.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    st.selected = b.dataset.day;
    if (st.mode === 'week') { st.mode = 'month'; const d = new Date(st.selected + 'T12:00:00'), n = new Date(); st.offset = (d.getFullYear() - n.getFullYear()) * 12 + d.getMonth() - n.getMonth(); }
    paint();
    if (window.innerWidth < 900) root.querySelector('#calDayT')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  root.querySelectorAll('[data-task]').forEach(b => b.onclick = () => openTaskModal(b.dataset.task, again));
  root.querySelector('[data-newon]')?.addEventListener('click', e => openTaskModal(null, again, { due: e.currentTarget.dataset.newon }));
}
