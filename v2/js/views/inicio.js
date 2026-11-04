// Inicio: tareas de hoy y hábitos de la semana (solo lectura en la Fase 1).
// Finanzas y Whoop se muestran como "pendiente" hasta sus fases.
import { dbGet, safeGet } from '../db.js';
import { escapeHTML, todayStr, localDate, daysUntil, weekKey, todayIdx, longDate, greeting, icon } from '../util.js';

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const CATEGORY = { trabajo: 'Trabajo', personal: 'Personal', fitness: 'Fitness', proyectos: 'Proyectos' };
const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

// ── Datos ─────────────────────────────────────────────
export async function load() {
  // Abiertas + las que se cerraron hoy (para el "5/8 hechas").
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const since = new Date(startOfDay.getTime() - 86400000).toISOString(); // margen de un día por zona horaria
  const [tasks, habits, weeks] = await Promise.all([
    dbGet('tasks', `?select=*&or=(status.in.(todo,in_progress),completed_at.gte.${encodeURIComponent(since)})&order=position.asc,created_at.desc`),
    safeGet('habits', '?order=created_at.asc'),
    safeGet('habit_weeks', `?week_key=eq.${weekKey()}`)
  ]);
  return { tasks: tasks || [], habits, weeks };
}

// ── Reglas de v1 (isTodayTask, rangos, effPriority) ──
const isRange = t => !!(t.start_date && t.due_date);
const isClosed = t => t.status === 'done' || t.status === 'missed';
const rangeOpen = t => isRange(t) && !isClosed(t);
const workedToday = t => (t.worked_dates || []).includes(todayStr());
function rangePriority(t) {
  const n = daysUntil(t.due_date);
  return n <= 1 ? 'critical' : n <= 3 ? 'high' : n <= 7 ? 'medium' : 'low';
}
const effPriority = t => (rangeOpen(t) && todayStr() >= t.start_date) ? rangePriority(t) : t.priority;

export function isTodayTask(t, today = localDate()) {
  if (rangeOpen(t)) {
    if (todayStr() < t.start_date) return false;  // aún no empieza
    if (workedToday(t)) return false;             // "Avancé hoy": regresa mañana
    return daysUntil(t.due_date) <= 7;
  }
  if (t.status === 'in_progress') return true;
  if (isClosed(t)) return !!t.completed_at && localDate(new Date(t.completed_at)) === today;
  if (!t.due_date) return true;
  return t.due_date <= today;
}

// Las de hoy: abiertas en el orden manual del día (day_order), luego por prioridad; cerradas al final.
export function todayTasks(tasks) {
  const list = tasks.filter(t => isTodayTask(t));
  const idx = new Map(tasks.map((t, i) => [t.id, i]));
  const open = list.filter(t => !isClosed(t)).sort((a, b) =>
    (a.day_order ?? 1e9) - (b.day_order ?? 1e9) ||
    (PRIORITY_RANK[effPriority(a)] ?? 3) - (PRIORITY_RANK[effPriority(b)] ?? 3) ||
    (a.due_time || '99').localeCompare(b.due_time || '99') ||
    idx.get(a.id) - idx.get(b.id));
  const closed = list.filter(isClosed);
  return { open, closed };
}

export function habitsWeek(habits, weeks) {
  return (habits || []).map(h => {
    const row = (weeks || []).find(w => w.habit_id === h.id);
    const days = row && Array.isArray(row.days) ? row.days : [];
    const count = days.length || (row?.count ?? 0);
    return { id: h.id, title: h.title, target: h.target_per_week || 1, days, count };
  });
}

// ── Vista ─────────────────────────────────────────────
const fmtTime = t => t ? t.slice(0, 5).replace(/^0/, '') : '';

function badge(t) {
  if (isClosed(t)) return '';
  const p = effPriority(t);
  if (p === 'critical') return '<span class="chip chip-alert">Crítica</span>';
  if (p === 'high') return '<span class="chip chip-soft">Alta</span>';
  if (!isRange(t) && t.due_date && t.due_date < localDate()) return '<span class="chip chip-plain">Vencida</span>';
  return '';
}

function taskRow(t) {
  const st = t.status === 'done' ? 'done' : t.status === 'missed' ? 'missed' : '';
  const stLabel = st === 'done' ? 'Completada' : st === 'missed' ? 'No completada' : 'Pendiente';
  const meta = [fmtTime(t.due_time), CATEGORY[t.category] || ''].filter(Boolean);
  if (rangeOpen(t)) {
    const n = daysUntil(t.due_date);
    meta.push(n < 0 ? `vencida hace ${-n} d` : n === 0 ? 'vence hoy' : `faltan ${n} d`);
  }
  return `<div class="task${st ? ' closed' : ''}">
    <span class="check ${st}" role="img" aria-label="${stLabel}">${st === 'done' ? icon('check', 3) : st === 'missed' ? icon('x', 3) : ''}</span>
    <div class="task-main">
      <div class="task-title">${escapeHTML(t.title)}</div>
      ${meta.length ? `<div class="task-meta">${escapeHTML(meta.join(' · '))}</div>` : ''}
    </div>
    ${badge(t)}
  </div>`;
}

function habitRow(h) {
  const ti = todayIdx();
  const dots = DAY_LABELS.map((l, i) =>
    `<span class="dot${h.days.includes(i) ? ' on' : ''}${i === ti ? ' today' : ''}"></span>`).join('');
  const done = h.count >= h.target;
  return `<div class="habit" role="group" aria-label="${escapeHTML(h.title)}: ${h.count} de ${h.target} esta semana">
    <div class="habit-name">${escapeHTML(h.title)}<small>${h.count}/${h.target}${done ? ' · meta cumplida' : ''}</small></div>
    <div class="dots" aria-hidden="true">${dots}</div>
  </div>`;
}

const MAX_ROWS = 8;

export function render(el, data, { name = 'Alfredo' } = {}) {
  const { open, closed } = todayTasks(data.tasks);
  const total = open.length + closed.length;
  const doneN = closed.length;
  const pct = total ? Math.round(doneN / total * 100) : 0;
  const criticals = open.filter(t => effPriority(t) === 'critical').length;
  const rows = [...open, ...closed];
  const shown = rows.slice(0, MAX_ROWS);
  const habits = data.habits ? habitsWeek(data.habits, data.weeks) : null;
  const hDone = habits ? habits.reduce((s, h) => s + Math.min(h.count, h.target), 0) : 0;
  const hTarget = habits ? habits.reduce((s, h) => s + h.target, 0) : 0;

  const hero = (compact) => `<section class="hero" aria-label="Tu día">
      <div class="card-head">
        <span class="label">${compact ? 'Tareas de hoy' : 'Tu día'}</span>
        ${criticals ? `<span class="hero-pill">${criticals} crítica${criticals === 1 ? '' : 's'}</span>` : ''}
      </div>
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
        <div class="hero-num">${doneN}<span>/${total}</span></div>
        <div class="hero-sub">${total === 1 ? 'tarea hecha' : 'tareas hechas'}</div>
      </div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Avance del día"><div style="width:${pct}%"></div></div>
    </section>`;

  const soonCard = (label, sub) => `<div class="card card-sm">
      <span class="label">${label}</span>
      <div class="big pending-val" aria-label="Sin datos">—</div>
      <div class="small">${sub}</div>
    </div>`;

  const habitsKpi = `<div class="card card-sm">
      <span class="label">Hábitos esta semana</span>
      <div class="big" style="font-size:30px">${hDone}<span style="color:#8A8C91">/${hTarget}</span></div>
      <div class="small">${habits && habits.length ? escapeHTML(habits.map(h => h.title).join(' · ')) : 'Sin hábitos'}</div>
    </div>`;

  const tasksCard = `<section class="card" aria-labelledby="ordenTitle" style="gap:4px">
      <div class="card-head" style="padding-bottom:8px">
        <h2 id="ordenTitle">Orden del día</h2>
        <a href="#tareas">Ver todo</a>
      </div>
      <div class="tasks">
        ${shown.length ? shown.map(taskRow).join('') : '<div class="empty">No hay tareas para hoy.</div>'}
        ${rows.length > MAX_ROWS ? `<div class="empty"><a href="#tareas">${rows.length - MAX_ROWS} más</a></div>` : ''}
      </div>
    </section>`;

  const habitsCard = `<section class="card" aria-labelledby="habTitle" style="gap:14px">
      <div class="card-head">
        <h2 id="habTitle">Hábitos</h2>
        <span class="muted" style="font-size:13px">esta semana</span>
      </div>
      ${habits === null ? '<div class="small">No se pudieron cargar los hábitos.</div>'
        : habits.length ? `<div class="dots-labels" aria-hidden="true">${DAY_LABELS.map(l => `<span>${l}</span>`).join('')}</div>
          <div class="habits">${habits.map(habitRow).join('')}</div>`
        : '<div class="small">Aún no tienes hábitos.</div>'}
    </section>`;

  el.innerHTML = `<div class="page">
    <header class="head">
      <div>
        <div class="eyebrow">${escapeHTML(longDate())}</div>
        <h1 class="hello">${greeting()}, <em>${escapeHTML(name)}</em></h1>
      </div>
      <a class="btn-dark round" href="../" aria-label="Nueva tarea (en la versión actual)" title="Por ahora las tareas se crean en la versión actual">${icon('plus', 2.4)}<span class="lbl">Nueva tarea</span></a>
    </header>

    <div class="mob-only">
      ${hero(false)}
      <div class="grid-2">
        ${soonCard('Gastado hoy', 'Llega en la fase 2')}
        ${soonCard('Recuperación', 'Whoop · fase 4')}
      </div>
    </div>

    <div class="kpis desk-only">
      ${hero(true)}
      ${habitsKpi}
      ${soonCard('Gastado este mes', 'Llega en la fase 2')}
      ${soonCard('Recuperación', 'Whoop · fase 4')}
    </div>

    <div class="cols">
      ${tasksCard}
      <div class="col-side">${habitsCard}</div>
    </div>
  </div>`;
}
