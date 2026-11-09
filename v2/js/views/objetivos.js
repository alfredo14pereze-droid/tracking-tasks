// Objetivos (semana/mes/año) y Hábitos (meta por semana, historial). Mismas reglas que la versión clásica:
// vencido = no completado y ya pasó su periodo (por created_at); archivado = completado y ya pasó su periodo;
// "pasar al periodo actual" reescribe created_at.
import { dbPost, dbPatch, dbDelete, safeGet } from '../db.js?v=202611091124';
import { escapeHTML, weekKey, todayIdx, showToast, icon, openModal, closeModal } from '../util.js?v=202611091124';
import { toggleHabitDay, habitCount } from '../habitos.js?v=202611091124';

const PERIODS = { week: ['Esta semana', 'Lo que quieres avanzar en los próximos 7 días'], month: ['Este mes', 'Metas para las próximas semanas'], year: ['Este año', 'Los objetivos grandes, a largo plazo'] };
const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
let st = { goals: [], habits: [], weeks: [], tab: 'objetivos', archive: false, openHist: {} };
let root = null;
const ls = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage */ } } };

export async function show(el, isCurrent = () => true) {
  const [goals, habits, weeks] = await Promise.all([
    safeGet('goals', '?order=position.asc,created_at.desc'),
    safeGet('habits', '?order=created_at.asc'),
    safeGet('habit_weeks', '?order=week_key.desc')
  ]);
  if (!isCurrent()) return;
  root = el;
  st = { goals: goals || [], habits: habits || [], weeks: weeks || [], tab: ls.get('v2GoalsTab', 'objetivos'), archive: false, openHist: {} };
  paint();
}

// ── Reglas ───────────────────────────────────────────
function periodElapsed(g) {
  if (!g.created_at) return false;
  const c = new Date(g.created_at), now = new Date();
  if (g.period === 'week') return weekKey(now) !== weekKey(c);
  if (g.period === 'month') return now.getFullYear() !== c.getFullYear() || now.getMonth() !== c.getMonth();
  if (g.period === 'year') return now.getFullYear() !== c.getFullYear();
  return false;
}
const goalExpired = g => g.status !== 'done' && periodElapsed(g);
const goalArchived = g => g.status === 'done' && periodElapsed(g);
function weekRange(monday) {
  const m = new Date(monday + 'T12:00:00'), s = new Date(m); s.setDate(s.getDate() + 6);
  const f = d => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '');
  return `${f(m)} – ${f(s)}`;
}

// ── Objetivos ────────────────────────────────────────
function goalRow(g, archived) {
  const done = g.status === 'done', late = goalExpired(g);
  return `<div class="goal${done ? ' done' : ''}${late ? ' late' : ''}" data-goal="${escapeHTML(g.id)}">
    <button type="button" class="check ${done ? 'done' : ''}" data-gcheck aria-label="${done ? 'Reabrir' : 'Completar'}: ${escapeHTML(g.title)}">${done ? icon('check', 3) : ''}</button>
    <div class="task-main"><span class="task-title">${escapeHTML(g.title)}</span>
      ${g.is_critical || late || archived ? `<span class="opts" style="gap:4px">${archived ? `<span class="chip chip-plain">${PERIODS[g.period]?.[0].replace('Esta ', '').replace('Este ', '') || ''}</span>` : ''}${g.is_critical ? '<span class="chip chip-soft">Crítico</span>' : ''}${late ? '<span class="chip chip-alert">Vencido</span>' : ''}</span>` : ''}</div>
    <button type="button" class="icon-btn sm${g.is_critical ? ' on' : ''}" data-gcrit aria-pressed="${!!g.is_critical}" aria-label="${g.is_critical ? 'Quitar crítico' : 'Marcar como crítico'}">${icon('star')}</button>
    ${!archived && !done ? `<button type="button" class="icon-btn sm" data-grenew aria-label="Pasar al periodo actual" title="Pasar al periodo actual">${icon('arrow')}</button>` : ''}
    <button type="button" class="icon-btn sm" data-gdel aria-label="Eliminar ${escapeHTML(g.title)}">${icon('trash')}</button>
  </div>`;
}

function goalsHTML() {
  if (st.archive) {
    const list = st.goals.filter(goalArchived).sort((a, b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at));
    return `<div><button type="button" class="btn-ghost sm" data-archive>← Volver a objetivos</button></div>
      <section class="card" style="gap:0">${list.map(g => goalRow(g, true)).join('') || '<div class="small">Todavía no tienes objetivos completados de periodos pasados.</div>'}</section>`;
  }
  const n = st.goals.filter(goalArchived).length;
  return `<div><button type="button" class="btn-ghost sm" data-archive>Completados${n ? ` (${n})` : ''}</button></div>
    <div class="goal-cols">${Object.entries(PERIODS).map(([k, [label, hint]]) => {
      const items = st.goals.filter(g => g.period === k && !goalArchived(g))
        .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (b.is_critical ? 1 : 0) - (a.is_critical ? 1 : 0));
      const active = items.filter(g => g.status !== 'done').length;
      return `<section class="card" style="gap:6px" aria-labelledby="g_${k}">
        <div class="card-head"><div><h2 id="g_${k}">${label}</h2><div class="small">${hint}</div></div><span class="chip chip-plain">${active}</span></div>
        ${items.map(g => goalRow(g, false)).join('') || '<div class="small" style="padding:6px 0">Sin objetivos todavía.</div>'}
        <form class="qadd" data-gadd="${k}"><label class="sr-only" for="gIn_${k}">Nuevo objetivo de ${label.toLowerCase()}</label><input class="field" id="gIn_${k}" placeholder="Agregar objetivo…" maxlength="200" autocomplete="off"><button type="submit" class="btn-primary sm" aria-label="Agregar">${icon('plus', 2.4)}</button></form>
      </section>`;
    }).join('')}</div>`;
}

// ── Hábitos ──────────────────────────────────────────
function habitCard(h) {
  const wk = weekKey(), ti = todayIdx();
  const row = st.weeks.find(w => String(w.habit_id) === String(h.id) && w.week_key === wk);
  const days = row && Array.isArray(row.days) ? row.days : [];
  const count = habitCount(row), target = h.target_per_week || 1;
  const status = count >= target ? ['done', 'Meta cumplida esta semana'] : count > 0 ? ['partial', 'Vas bien, sigue así'] : ['none', 'Aún no marcas esta semana'];
  const open = !!st.openHist[h.id];
  const hist = st.weeks.filter(w => String(w.habit_id) === String(h.id) && w.week_key !== wk).sort((a, b) => b.week_key.localeCompare(a.week_key));
  return `<section class="card" style="gap:12px" data-habit="${escapeHTML(h.id)}">
    <div class="card-head"><div style="min-width:0"><h2 style="overflow-wrap:anywhere">${escapeHTML(h.title)}</h2><div class="small">Meta: ${target} por semana · <b>${count}/${target}</b></div></div>
      <div style="display:flex;gap:4px"><button type="button" class="icon-btn sm" data-hedit aria-label="Editar ${escapeHTML(h.title)}">${icon('edit')}</button><button type="button" class="icon-btn sm" data-hdel aria-label="Eliminar ${escapeHTML(h.title)}">${icon('trash')}</button></div></div>
    <div class="hdays">${DAYS.map((l, i) => `<div class="hday${i === ti ? ' today' : ''}"><span>${l}</span>
      <button type="button" class="dot${days.includes(i) ? ' on' : ''}" data-hday="${i}"${i > ti ? ' disabled' : ''} aria-pressed="${days.includes(i)}" aria-label="${escapeHTML(h.title)} el ${DAY_NAMES[i]}"></button></div>`).join('')}</div>
    <div class="hstatus ${status[0]}">${status[1]}</div>
    <button type="button" class="btn-link" style="align-self:flex-start" data-hhist>${open ? 'Ocultar historial' : 'Ver semanas anteriores'}</button>
    ${open ? (hist.length ? `<div>${hist.map(w => { const c = habitCount(w), s = c >= target ? 'Cumplido' : c > 0 ? 'Parcial' : 'No cumplido';
      return `<div class="hhist"><span>${weekRange(w.week_key)}</span><span class="muted">${Array.isArray(w.days) ? DAYS.map((l, i) => w.days.includes(i) ? l : '·').join(' ') : ''}</span><span>${c}/${target} · ${s}</span></div>`; }).join('')}</div>` : '<div class="small">Todavía no hay semanas anteriores.</div>') : ''}
  </section>`;
}

function habitsHTML() {
  return `<section class="card" style="gap:8px">
      <form class="hadd" data-hadd>
        <div style="flex:1 1 200px;min-width:0;display:flex;flex-direction:column"><label class="flabel" for="hTitle" style="margin-top:0">Nuevo hábito</label><input class="field" id="hTitle" placeholder="Ej. Ir al gimnasio" maxlength="80" autocomplete="off"></div>
        <div style="width:120px;display:flex;flex-direction:column"><label class="flabel" for="hTarget" style="margin-top:0">Veces/semana</label><input class="field" id="hTarget" inputmode="numeric" value="3"></div>
        <button type="submit" class="btn-primary" style="align-self:flex-end;padding:0 18px">Agregar</button>
      </form>
    </section>
    <div class="goal-cols">${st.habits.map(habitCard).join('') || '<div class="small">Sin hábitos todavía.</div>'}</div>`;
}

// ── Pintar ───────────────────────────────────────────
function paint() {
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center"><h1 class="hello" style="margin:0">Objetivos y hábitos</h1></header>
    <div class="seg" role="group" aria-label="Sección" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <button type="button" data-tab="objetivos" aria-pressed="${st.tab === 'objetivos'}">Objetivos</button>
      <button type="button" data-tab="habitos" aria-pressed="${st.tab === 'habitos'}">Hábitos</button>
    </div>
    ${st.tab === 'objetivos' ? goalsHTML() : habitsHTML()}
  </div>`;
  bind();
}
const again = () => { if (root && document.body.contains(root)) paint(); };

function bind() {
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; ls.set('v2GoalsTab', st.tab); paint(); });
  root.querySelector('[data-archive]')?.addEventListener('click', () => { st.archive = !st.archive; paint(); });
  root.querySelectorAll('[data-gadd]').forEach(f => f.onsubmit = e => { e.preventDefault(); const i = f.querySelector('input'), t = i.value.trim(); if (t) addGoal(f.dataset.gadd, t); });
  root.querySelectorAll('[data-goal]').forEach(row => {
    const g = st.goals.find(x => String(x.id) === row.dataset.goal);
    row.querySelector('[data-gcheck]').onclick = () => patchGoal(g, g.status === 'done' ? { status: 'active', completed_at: null } : { status: 'done', completed_at: new Date().toISOString() });
    row.querySelector('[data-gcrit]').onclick = () => patchGoal(g, { is_critical: !g.is_critical });
    row.querySelector('[data-grenew]')?.addEventListener('click', () => patchGoal(g, { created_at: new Date().toISOString() }, 'Objetivo movido al periodo actual'));
    row.querySelector('[data-gdel]').onclick = () => deleteGoal(g);
  });
  const hadd = root.querySelector('[data-hadd]');
  if (hadd) hadd.onsubmit = e => { e.preventDefault(); addHabit(); };
  root.querySelectorAll('[data-habit]').forEach(card => {
    const h = st.habits.find(x => String(x.id) === card.dataset.habit);
    card.querySelectorAll('[data-hday]').forEach(b => b.onclick = () => toggleHabitDay(st, h.id, Number(b.dataset.hday), again));
    card.querySelector('[data-hhist]').onclick = () => { st.openHist[h.id] = !st.openHist[h.id]; paint(); };
    card.querySelector('[data-hdel]').onclick = () => deleteHabit(h);
    card.querySelector('[data-hedit]').onclick = () => editHabit(h);
  });
}

// ── Acciones ─────────────────────────────────────────
async function addGoal(period, title) {
  const temp = { id: 'temp-' + Date.now(), title, period, status: 'active', created_at: new Date().toISOString() };
  st.goals.unshift(temp); paint(); root.querySelector(`#gIn_${period}`)?.focus();
  try { const [g] = await dbPost('goals', { title, period, status: 'active' }); Object.assign(temp, g); showToast('Objetivo agregado'); }
  catch { st.goals = st.goals.filter(x => x !== temp); again(); showToast('No se pudo guardar el objetivo', 'error'); }
}
async function patchGoal(g, patch, msg) {
  const prev = {}; for (const k of Object.keys(patch)) prev[k] = g[k];
  Object.assign(g, patch); paint();
  if (String(g.id).startsWith('temp-')) return;
  try { await dbPatch('goals', patch, `?id=eq.${g.id}`); if (msg) showToast(msg); }
  catch { Object.assign(g, prev); again(); showToast('No se pudo actualizar el objetivo', 'error'); }
}
async function deleteGoal(g) {
  const i = st.goals.indexOf(g);
  st.goals.splice(i, 1); paint();
  try {
    await dbDelete('goals', `?id=eq.${g.id}`);
    showToast('Objetivo eliminado', 'info', { label: 'Deshacer', onClick: async () => {
      const { id, ...rest } = g;
      try { const [n] = await dbPost('goals', rest); st.goals.splice(Math.min(i, st.goals.length), 0, n); again(); } catch { showToast('No se pudo restaurar', 'error'); }
    } });
  } catch { st.goals.splice(i, 0, g); again(); showToast('No se pudo eliminar', 'error'); }
}

async function addHabit() {
  const title = root.querySelector('#hTitle').value.trim();
  const target = Math.max(1, Math.min(14, parseInt(root.querySelector('#hTarget').value, 10) || 1));
  if (!title) return showToast('Escribe el hábito', 'error');
  try { const [h] = await dbPost('habits', { title, target_per_week: target }); st.habits.push(h); paint(); showToast('Hábito agregado'); }
  catch { showToast('No se pudo guardar el hábito', 'error'); }
}
function editHabit(h) {
  openModal('Editar hábito', `
    <label class="flabel" for="ehTitle" style="margin-top:0">Nombre</label><input class="field" id="ehTitle" maxlength="80" value="${escapeHTML(h.title)}">
    <label class="flabel" for="ehTarget">Veces por semana</label><input class="field" id="ehTarget" inputmode="numeric" value="${h.target_per_week || 1}">`,
    '<button type="button" class="btn-primary" id="ehSave">Guardar</button>');
  document.getElementById('ehSave').onclick = async () => {
    const title = document.getElementById('ehTitle').value.trim();
    const target = parseInt(document.getElementById('ehTarget').value, 10);
    if (!title || !(target >= 1 && target <= 14)) return showToast('Revisa el nombre y las veces (1 a 14)', 'error');
    closeModal();
    const prev = { title: h.title, target_per_week: h.target_per_week };
    Object.assign(h, { title, target_per_week: target }); paint();
    try { await dbPatch('habits', { title, target_per_week: target }, `?id=eq.${h.id}`); showToast('Hábito actualizado'); }
    catch { Object.assign(h, prev); again(); showToast('No se pudo guardar', 'error'); }
  };
}
function deleteHabit(h) {
  openModal('Eliminar hábito', `<p class="small" style="margin:0">Se borra "${escapeHTML(h.title)}" con todo su historial de semanas. No se puede deshacer.</p>`,
    '<button type="button" class="btn-primary" style="background:var(--over)" id="hdOk">Sí, eliminar</button><button type="button" class="btn-ghost" data-close>Cancelar</button>');
  document.getElementById('hdOk').onclick = async () => {
    closeModal();
    const prevH = st.habits, prevW = st.weeks;
    st.habits = st.habits.filter(x => x !== h); st.weeks = st.weeks.filter(w => String(w.habit_id) !== String(h.id)); paint();
    try { await dbDelete('habits', `?id=eq.${h.id}`); showToast('Hábito eliminado'); }
    catch { st.habits = prevH; st.weeks = prevW; again(); showToast('No se pudo eliminar', 'error'); }
  };
}
