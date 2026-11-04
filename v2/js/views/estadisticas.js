// Estadísticas de tareas — mismas métricas que la clásica (renderStatsView + updateStreak).
import { escapeHTML, localDate } from '../util.js?v=202611041328';
import * as K from '../tareas.js?v=202611041328';

let root = null;

export async function show(el, isCurrent = () => true) {
  await K.loadTasks();
  if (!isCurrent()) return;
  root = el; paint();
}

const dayOf = t => t.completed_at ? localDate(new Date(t.completed_at)) : null;
const offsetDay = n => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); };
const bar = (label, done, total, color = 'var(--accent)') => {
  const pct = total ? Math.round(done / total * 100) : 0;
  return `<div class="bud"><div class="bud-line"><span>${escapeHTML(label)}</span><span class="muted">${pct}% · ${done}/${total}</span></div>
    <div class="track" role="progressbar" aria-label="${escapeHTML(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%;background:${color}"></div></div></div>`;
};

function streak(tasks) {
  const days = new Set(tasks.map(dayOf).filter(Boolean));
  let n = 0; const d = new Date();
  while (days.has(localDate(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function donut(parts) {
  const total = parts.reduce((s, p) => s + p.val, 0);
  if (!total) return '<circle cx="60" cy="60" r="45" fill="var(--line-2)"/>';
  let a = -Math.PI / 2;
  return parts.map(({ val, color }) => {
    if (!val) return '';
    const ang = val / total * Math.PI * 2;
    if (ang >= Math.PI * 2 - 1e-6) return `<circle cx="60" cy="60" r="45" fill="${color}"/>`;
    const x1 = 60 + 45 * Math.cos(a), y1 = 60 + 45 * Math.sin(a); a += ang;
    const x2 = 60 + 45 * Math.cos(a), y2 = 60 + 45 * Math.sin(a);
    return `<path d="M60,60 L${x1.toFixed(2)},${y1.toFixed(2)} A45,45 0 ${ang > Math.PI ? 1 : 0},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}"/>`;
  }).join('');
}

function paint() {
  const tasks = K.T.tasks, today = localDate();
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const pending = tasks.filter(t => !K.isClosed(t)).length;
  const late = tasks.filter(t => !K.isClosed(t) && t.due_date && t.due_date < today).length;
  const inProg = tasks.filter(t => t.status === 'in_progress').length;
  const pct = total ? Math.round(done / total * 100) : 0;

  const cats = [...Object.entries(K.CATEGORIES), [null, 'Sin categoría']].map(([id, name]) => {
    const list = tasks.filter(t => id ? t.category === id : !t.category);
    return bar(name, list.filter(t => t.status === 'done').length, list.length);
  }).join('');
  const PCOL = { critical: 'var(--over)', high: 'var(--accent)', medium: '#C9A227', low: '#7FA892' };
  const prios = Object.entries(K.PRIORITIES).map(([id, name]) => {
    const list = tasks.filter(t => t.priority === id);
    return bar(name, list.filter(t => t.status === 'done').length, list.length, PCOL[id]);
  }).join('');

  // Recurrentes con más de 2 semanas de historial: % de días cumplidos.
  const twoWeeks = offsetDay(-14);
  const groups = {};
  tasks.filter(t => t.is_recurring).forEach(t => { (groups[`${t.title}|${t.category || ''}`] ||= []).push(t); });
  const recur = Object.values(groups).map(rows => {
    const earliest = rows.reduce((m, t) => t.due_date && (!m || t.due_date < m) ? t.due_date : m, null);
    const past = rows.filter(t => t.due_date && t.due_date <= today);
    return { earliest, label: `${rows[0].title} · ${K.recurrenceLabel(rows[0].recurrence)}`, done: past.filter(t => t.status === 'done').length, total: past.length };
  }).filter(g => g.earliest && g.earliest <= twoWeeks).sort((a, b) => (b.total ? b.done / b.total : 0) - (a.total ? a.done / a.total : 0));

  // Actividad 35 días.
  const byDay = {};
  tasks.forEach(t => { const d = dayOf(t); if (d && t.status === 'done') byDay[d] = (byDay[d] || 0) + 1; });
  const heat = [];
  for (let i = 34; i >= 0; i--) { const ds = offsetDay(-i); heat.push([ds, byDay[ds] || 0]); }
  const lvl = n => n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : 3;
  const best = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  let week = 0; for (let i = 0; i < 7; i++) week += byDay[offsetDay(-i)] || 0;
  const highPending = tasks.filter(t => t.priority === 'high' && !K.isClosed(t)).length;
  const rest = Math.max(0, pending - inProg - late);

  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center"><h1 class="hello" style="margin:0">Estadísticas</h1></header>
    <div class="kpis" style="display:grid">
      <section class="hero" style="gap:8px"><span class="label">Tasa de completación</span><div class="hero-num" style="font-size:40px">${pct}%</div><div class="hero-sub">${done} de ${total} tareas</div></section>
      <section class="card card-sm"><span class="label">Racha actual</span><div class="big">${streak(tasks)} día${streak(tasks) === 1 ? '' : 's'}</div><div class="small">días seguidos completando algo</div></section>
      <section class="card card-sm"><span class="label">Sin completar</span><div class="big" style="color:var(--alert)">${late}</div><div class="small">${pending} pendientes en total</div></section>
      <section class="card card-sm"><span class="label">Promedio última semana</span><div class="big">${(week / 7).toFixed(1)}/día</div><div class="small">${best ? `Mejor día: ${best[1]} el ${escapeHTML(new Date(best[0] + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }))}` : 'Mejor día: —'}</div></section>
    </div>
    <div class="fin-grid"><div class="fin-col">
      <section class="card" style="gap:12px"><h2 style="font-size:16px">Por categoría</h2>${cats}</section>
      <section class="card" style="gap:12px"><h2 style="font-size:16px">Por prioridad</h2>${prios}<div class="small">${highPending} de alta prioridad pendientes</div></section>
      <section class="card" style="gap:12px"><h2 style="font-size:16px">Recurrentes</h2><div class="small" style="margin-top:-6px">% de días cumplidos (con más de 2 semanas de historial)</div>
        ${recur.length ? recur.map(g => bar(g.label, g.done, g.total)).join('') : '<div class="small">Aún no hay recurrentes con más de 2 semanas de historial.</div>'}</section>
    </div><div class="fin-col">
      <section class="card" style="gap:12px"><h2 style="font-size:16px">Actividad · últimos 35 días</h2>
        <div class="heat" role="img" aria-label="Tareas completadas por día, últimos 35 días">${heat.map(([d, n]) => `<i class="h${lvl(n)}" title="${d}: ${n}"></i>`).join('')}</div>
        <div class="small" style="display:flex;gap:6px;align-items:center">Menos <i class="hk h0"></i><i class="hk h1"></i><i class="hk h2"></i><i class="hk h3"></i> Más</div></section>
      <section class="card" style="gap:12px"><h2 style="font-size:16px">Estados</h2>
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Completadas ${done}, en progreso ${inProg}, sin completar ${late}, pendientes ${rest}">
            ${donut([{ val: done, color: 'var(--accent)' }, { val: inProg, color: '#C9A227' }, { val: late, color: 'var(--over)' }, { val: rest, color: 'var(--line-2)' }])}
            <circle cx="60" cy="60" r="30" fill="var(--card)"/><text x="60" y="65" text-anchor="middle" fill="var(--text)" font-size="16" font-weight="700">${pct}%</text>
          </svg>
          <div style="display:flex;flex-direction:column;gap:6px;flex:1 1 140px;font-size:14px">
            ${[['var(--accent)', 'Completadas', done], ['#C9A227', 'En progreso', inProg], ['var(--over)', 'Sin completar', late], ['var(--line-2)', 'Pendientes', rest]].map(([c, l, v]) => `<div style="display:flex;justify-content:space-between;gap:8px"><span style="display:flex;align-items:center;gap:8px"><i class="cdot" style="background:${c}"></i>${l}</span><span class="muted">${v}</span></div>`).join('')}
          </div>
        </div></section>
    </div></div>
  </div>`;
}
