// Inicio: tareas de hoy (marcables), hábitos de la semana (marcables), finanzas y Whoop.
import { safeGet, AuthError } from '../db.js?v=202611040938';
import * as F from '../fin.js?v=202611040938';
import * as K from '../tareas.js?v=202611040938';
import { toggleHabitDay } from '../habitos.js?v=202611040938';
import { openTaskModal } from './tareas.js?v=202611040938';
import { escapeHTML, todayStr, localDate, daysUntil, weekKey, todayIdx, longDate, greeting, icon, showToast } from '../util.js?v=202611040938';

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const CATEGORY = { trabajo: 'Trabajo', personal: 'Personal', fitness: 'Fitness', proyectos: 'Proyectos' };
const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

// ── Datos ─────────────────────────────────────────────
export async function load() {
  // Todas las tareas (igual que v1): hace falta para las recurrentes y para marcarlas aquí.
  const [, habits, weeks, fin, whoop] = await Promise.all([
    K.loadTasks(),
    safeGet('habits', '?order=created_at.asc'),
    safeGet('habit_weeks', `?week_key=eq.${weekKey()}`),
    F.loadFinance().catch(e => { if (e instanceof AuthError) throw e; return null; }),
    safeGet('whoop_daily', '?order=day.desc&limit=3')
  ]);
  return { tasks: K.T.tasks, habits, weeks, fin: fin && !fin.errors.length ? fin : null, whoop: whoop || [] };
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
    <button type="button" class="check ${st}" data-tcheck="${escapeHTML(t.id)}" aria-label="${stLabel}: ${escapeHTML(t.title)}${isClosed(t) ? ' (tocar para reabrir)' : ''}">${st === 'done' ? icon('check', 3) : st === 'missed' ? icon('x', 3) : ''}</button>
    <button type="button" class="task-main as-btn" data-tedit="${escapeHTML(t.id)}">
      <span class="task-title">${escapeHTML(t.title)}</span>
      ${meta.length ? `<span class="task-meta">${escapeHTML(meta.join(' · '))}</span>` : ''}
    </button>
    ${badge(t)}
  </div>`;
}

function habitRow(h) {
  const ti = todayIdx();
  const NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const dots = DAY_LABELS.map((l, i) =>
    `<button type="button" class="dot${h.days.includes(i) ? ' on' : ''}${i === ti ? ' today' : ''}" data-hday="${escapeHTML(h.id)}:${i}"${i > ti ? ' disabled' : ''} aria-pressed="${h.days.includes(i)}" aria-label="${escapeHTML(h.title)} el ${NAMES[i]}"></button>`).join('');
  const done = h.count >= h.target;
  return `<div class="habit" role="group" aria-label="${escapeHTML(h.title)}: ${h.count} de ${h.target} esta semana">
    <div class="habit-name">${escapeHTML(h.title)}<small>${h.count}/${h.target}${done ? ' · meta cumplida' : ''}</small></div>
    <div class="dots">${dots}</div>
  </div>`;
}

const MAX_ROWS = 8;

export function render(el, data, opts = {}) {
  paint(el, data, opts);
  bind(el, data, opts);
}

function bind(el, data, opts) {
  const again = () => { if (document.body.contains(el)) render(el, data, opts); };
  el.querySelector('[data-newtask]').onclick = () => openTaskModal(null, again);
  el.querySelectorAll('[data-tcheck]').forEach(b => b.onclick = () => K.toggleTask(b.dataset.tcheck, again));
  el.querySelectorAll('[data-tedit]').forEach(b => b.onclick = () => openTaskModal(b.dataset.tedit, again));
  el.querySelectorAll('[data-hday]').forEach(b => b.onclick = () => {
    const [hid, day] = b.dataset.hday.split(':');
    toggleHabitDay(data, hid, Number(day), again);
  });
}


function paint(el, data, { name = 'Alfredo' } = {}) {
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

  const fs = finSummary(data.fin);

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
      <button type="button" class="btn-dark round" data-newtask aria-label="Nueva tarea">${icon('plus', 2.4)}<span class="lbl">Nueva tarea</span></button>
    </header>

    <div class="mob-only">
      ${hero(false)}
      <div class="grid-2">
        ${fs ? moneyCard('Gastado hoy', F.fmtMoney0(fs.today), fs.daily ? `de ${F.fmtMoney0(fs.daily)} diarios` : 'sin presupuesto', fs.daily && fs.today > fs.daily) : soonCard('Gastado hoy', 'Sin datos de finanzas')}
        ${recoveryCard(data.whoop, false)}
      </div>
    </div>

    <div class="kpis desk-only">
      ${hero(true)}
      ${habitsKpi}
      ${fs ? moneyCard(`Gastado en ${fs.month}`, F.fmtMoney0(fs.exp), fs.budget ? `de ${F.fmtMoney0(fs.budget)} · ${fs.onTrack ? 'al día' : 'vas arriba'}` : 'sin presupuesto', fs.budget && !fs.onTrack, true) : soonCard('Gastado este mes', 'Sin datos de finanzas')}
      ${recoveryCard(data.whoop, true)}
    </div>

    <div class="cols">
      ${tasksCard}
      <div class="col-side">
        ${habitsCard}
        ${fs ? `<div class="mob-only">${budgetCard(fs)}</div>
        <div class="desk-only desk-stack">${chartCard(fs)}${payCard(fs)}</div>` : ''}
      </div>
    </div>
  </div>`;
}

// ── Finanzas en Inicio ────────────────────────────────
function finSummary(f) {
  if (!f) return null;
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const budget = F.monthBudgetTotal(f);
  const { exp } = F.totals(f, F.periodRange('mes'));
  return {
    month: F.monthName(0), budget, exp, days, daysLeft: days - day + 1,
    today: F.spentOn(f, localDate()),
    daily: budget ? Math.round(budget / days) : 0,
    onTrack: !budget || exp <= budget * day / days,
    rows: F.budgetRows(f, F.periodRange('mes')),
    chart: F.monthlySpend(f, 6),
    pay: F.nextCardPayment(f)
  };
}

function moneyCard(label, value, sub, warn, big) {
  return `<div class="card card-sm">
    <span class="label">${escapeHTML(label)}</span>
    <div class="big"${big ? ' style="font-size:30px"' : ''}>${value}</div>
    <div class="small"${warn ? ' style="color:var(--alert);font-weight:600"' : ''}>${escapeHTML(sub)}</div>
  </div>`;
}

const SHADES = ['var(--accent)', '#7FA892', '#C9C6BD'];
function budgetCard(fs) {
  const head = `<div class="card-head"><h2>Presupuesto de ${escapeHTML(fs.month)}</h2>${fs.budget ? `<span class="chip ${fs.onTrack ? 'chip-soft' : 'chip-alert'}">${fs.onTrack ? 'Al día' : 'Vas arriba'}</span>` : ''}</div>`;
  if (!fs.budget) return `<section class="card">${head}<div class="small">Aún no hay presupuesto. <a href="#finanzas">Ver finanzas</a></div></section>`;
  const segs = fs.rows.filter(r => r.spent > 0).slice(0, 3);
  const rest = Math.max(0, fs.exp - segs.reduce((s, r) => s + r.spent, 0));
  const w = c => Math.max(0, Math.min(100, c / fs.budget * 100)).toFixed(1);
  const left = fs.budget - fs.exp;
  return `<section class="card">
    ${head}
    <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap"><div class="big">${F.fmtMoney0(fs.exp)}</div><div class="muted" style="font-size:14px">de ${F.fmtMoney0(fs.budget)}</div></div>
    <div class="stack" role="img" aria-label="Gastado ${F.fmtMoney0(fs.exp)} de ${F.fmtMoney0(fs.budget)}">
      ${segs.map((r, i) => `<div style="width:${w(r.spent)}%;background:${fs.exp > fs.budget ? 'var(--over)' : SHADES[i]}" title="${escapeHTML(r.cat.name)}"></div>`).join('')}
      ${rest ? `<div style="width:${w(rest)}%;background:${fs.exp > fs.budget ? 'var(--over)' : '#E0DDD4'}"></div>` : ''}
    </div>
    <div class="small">${left >= 0 ? `Te quedan ${F.fmtMoney0(left)} para ${fs.daysLeft} día${fs.daysLeft === 1 ? '' : 's'}` : `Te pasaste por ${F.fmtMoney0(-left)}`}</div>
  </section>`;
}

function chartCard(fs) {
  const max = Math.max(1, ...fs.chart.map(m => m.value));
  return `<section class="card" style="gap:14px">
    <h2 style="font-size:16px;font-weight:600">Gastos · últimos 6 meses</h2>
    <div class="bars" role="img" aria-label="${escapeHTML(fs.chart.map(m => `${m.label} ${F.fmtMoney0(m.value)}`).join(', '))}">
      ${fs.chart.map(m => `<div class="${m.current ? 'cur' : ''}"><i style="height:${Math.round(m.value / max * 96)}px"></i><span>${escapeHTML(m.label)}</span></div>`).join('')}
    </div>
  </section>`;
}

function payCard(fs) {
  if (!fs.pay) return '';
  const d = fs.pay.date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '');
  return `<section class="dark-card">
    <span class="label">Próximo pago</span>
    <div style="font-size:22px;font-weight:600;overflow-wrap:anywhere">Tarjeta ${escapeHTML(fs.pay.account.name)} · ${escapeHTML(d)}</div>
    <div class="muted">${F.fmtMoney0(fs.pay.debt)} por pagar</div>
  </section>`;
}

// ── Whoop en Inicio ───────────────────────────────────
function recoveryCard(days, desk) {
  const t = (days || []).find(x => x.recovery_score != null);
  if (!t) return `<a class="card card-sm" href="#salud" style="text-decoration:none;color:inherit">
      <span class="label">Recuperación</span>
      <div class="big pending-val" aria-label="Sin datos">—</div>
      <div class="small">Conecta Whoop en Salud</div>
    </a>`;
  const s = t.recovery_score;
  const zone = s >= 67 ? 'día verde' : s >= 34 ? 'día amarillo' : 'día rojo';
  const color = s >= 67 ? 'var(--positive)' : s >= 34 ? '#8A6D1A' : 'var(--alert)';
  const sleep = t.sleep_minutes != null ? `Sueño ${Math.floor(t.sleep_minutes / 60)} h ${String(t.sleep_minutes % 60).padStart(2, '0')} min · Whoop` : 'Whoop';
  return `<a class="card card-sm" href="#salud" style="text-decoration:none;color:inherit">
    <span class="label">Recuperación</span>
    <div class="big"${desk ? ' style="font-size:30px"' : ''}>${s}%</div>
    <div class="small" style="color:${color};font-weight:500">${escapeHTML(desk ? sleep : 'Whoop · ' + zone)}</div>
  </a>`;
}
