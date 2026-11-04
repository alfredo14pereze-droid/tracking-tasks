// Salud: Ejercicio (rutina de hoy, semana, progreso), Actividad (metas + Whoop) y Sueño.
import { dbPost, dbUpsert, dbDelete, callFunction } from '../db.js?v=202611040955';
import { escapeHTML, localDate, showToast, icon, openModal, closeModal } from '../util.js?v=202611040955';
import { comidasHTML, bindComidas, openMeasures } from './comidas.js?v=202611040955';
import * as S from '../salud.js?v=202611040955';

const TABS = { ejercicio: 'Ejercicio', comidas: 'Comidas', actividad: 'Actividad', sueno: 'Sueño' };
const DAY = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
let st = { d: null, tab: 'ejercicio', routineId: null };
let root = null;

function readTab() { try { return localStorage.getItem('v2SaludTab') || 'ejercicio'; } catch { return 'ejercicio'; } }
function saveTab(t) { try { localStorage.setItem('v2SaludTab', t); } catch { /* sin storage */ } }

export async function show(el, isCurrent = () => true) {
  const d = await S.loadSalud();
  if (!isCurrent()) return;
  root = el;
  st = { d, tab: TABS[readTab()] ? readTab() : 'ejercicio', routineId: null };
  whoopReturnToast();
  paint();
  // Whoop: sincroniza en segundo plano si hace rato que no; luego vuelve a pintar.
  if (await S.maybeSyncWhoop(d)) {
    const fresh = await S.loadSalud();
    if (isCurrent() && root === el) { st.d = fresh; paint(); }
  }
}

function whoopReturnToast() {
  const m = /[?&]whoop=([a-z]+)/.exec(location.hash);
  if (!m) return;
  const msg = { ok: ['Whoop conectado ✓', 'info'], cancelado: ['Conexión con Whoop cancelada', 'info'], vencido: ['El enlace de Whoop venció; intenta otra vez', 'error'], error: ['No se pudo conectar Whoop', 'error'] }[m[1]];
  if (msg) showToast(msg[0], msg[1]);
  history.replaceState(null, '', location.pathname + location.search + '#salud');
  if (m[1] === 'ok') st.tab = 'actividad';
}

// ── Piezas ───────────────────────────────────────────
const fmtKg = w => w == null ? '' : `${Number(w) % 1 ? Number(w).toFixed(1) : Number(w)} kg`;
const chip = (label, kind) => `<span class="chip ${kind === 'up' ? 'chip-soft' : kind === 'down' ? 'chip-alert' : 'chip-plain'}">${escapeHTML(label)}</span>`;
const minsLabel = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;

function setupCard(title, body, button) {
  return `<section class="soon"><h1 style="font-size:22px">${escapeHTML(title)}</h1><p>${body}</p>${button || ''}</section>`;
}

function heroCard(d) {
  const active = S.activeWorkout(d);
  const today = S.whoopToday(d);
  const rec = today?.recovery_score;
  const recChip = rec != null ? `<span class="hero-pill">Recuperación ${rec}%</span>` : '';
  if (active) {
    const mins = Math.round((Date.now() - new Date(active.started_at)) / 60000);
    return `<section class="hero">
      <div class="card-head"><span class="label">Entreno en curso</span>${recChip}</div>
      <div class="hero-num" style="font-size:38px">${escapeHTML(active.name)}</div>
      <div class="hero-sub">Empezaste hace ${minsLabel(mins)}</div>
      <a class="btn-light" href="#entreno">${icon('play')}Continuar entreno</a>
    </section>`;
  }
  const r = d.routines.find(x => x.id === st.routineId) || S.nextRoutine(d);
  const n = S.routineItems(d, r.id).length;
  return `<section class="hero">
    <div class="card-head"><span class="label">Hoy toca</span>${recChip}</div>
    <div style="display:flex;flex-direction:column;gap:4px">
      <div class="hero-num" style="font-size:38px">${escapeHTML(r.name)}</div>
      <div class="hero-sub">${n} ejercicio${n === 1 ? '' : 's'} · ~${S.routineMinutes(d, r)} min</div>
    </div>
    ${rec != null ? `<div class="hero-note">${escapeHTML(S.recoveryAdvice(rec))}</div>` : ''}
    <button type="button" class="btn-light" data-start="${escapeHTML(r.id)}">${icon('play')}Empezar entreno</button>
  </section>`;
}

function weekCard(d) {
  const w = S.weekSummary(d);
  const target = S.goal(d, 'workouts_week');
  return `<section class="card" aria-labelledby="semT" style="gap:14px">
    <div class="card-head"><h2 id="semT">Esta semana</h2><span class="muted" style="font-size:13px">${w.values.workouts_week} de ${target} entrenos</span></div>
    <div class="week">${w.perDay.map((x, i) => {
      const lbl = x.labels[0] ? (x.labels.length > 1 ? `${x.labels[0]} +${x.labels.length - 1}` : x.labels[0]) : (x.future ? '' : x.today ? 'Hoy' : 'Desc.');
      const cls = x.labels.length ? 'on' : x.today ? 'today' : '';
      return `<div class="wk${x.today ? ' is-today' : ''}"><span>${DAY[i]}</span><div class="wk-box ${cls}">${escapeHTML(lbl)}</div></div>`;
    }).join('')}</div>
  </section>`;
}

function routineCard(d) {
  if (S.activeWorkout(d)) return '';
  const r = d.routines.find(x => x.id === st.routineId) || S.nextRoutine(d);
  const items = S.routineItems(d, r.id);
  const rows = items.slice(0, 6).map((it, i) => {
    const opts = S.itemOptions(d, it.id);
    const ex = opts[0]?.exercise_id;
    const sug = ex ? S.suggestion(d, ex, it) : null;
    const reps = it.reps_min === it.reps_max ? it.reps_max : `${it.reps_min}–${it.reps_max}`;
    return `<div class="task">
      <div class="num">${String(i + 1).padStart(2, '0')}</div>
      <div class="task-main"><div class="task-title" style="font-weight:500">${escapeHTML(ex ? S.exName(d, ex) : 'Sin ejercicio')}</div>
        <div class="task-meta">${it.sets} × ${reps}${sug?.weight ? ' · ' + fmtKg(sug.weight) : ''}${opts.length > 1 ? ` · ${opts.length - 1} opción${opts.length > 2 ? 'es' : ''} más` : ''}</div></div>
      ${sug && sug.kind !== 'new' ? chip(sug.label, sug.kind) : ''}
    </div>`;
  }).join('');
  return `<section class="card" aria-labelledby="rutT" style="gap:4px">
    <div class="card-head" style="padding-bottom:8px"><h2 id="rutT">${escapeHTML(r.name)} · rutina</h2><button type="button" class="btn-link" data-change>Cambiar</button></div>
    ${rows || '<div class="empty">Esta rutina no tiene ejercicios. <a href="#rutina/' + escapeHTML(r.id) + '">Agregar</a></div>'}
    ${items.length > 6 ? `<div class="empty">+ ${items.length - 6} ejercicio${items.length - 6 === 1 ? '' : 's'} más</div>` : ''}
    <div class="empty"><a href="#rutinas">Editar rutinas y ejercicios</a></div>
  </section>`;
}

function progressCard(d) {
  const ex = S.mainExercise(d);
  const monthStart = localDate().slice(0, 8) + '01';
  const monthCount = S.finished(d).filter(w => localDate(new Date(w.started_at)) >= monthStart).length;
  const bw = d.body[0];
  let chart = '<div class="small">Cuando registres algunos entrenos verás aquí tu fuerza estimada.</div>';
  if (ex) {
    const t = S.strengthTrend(d, ex, 8);
    const vals = t.map(x => x.value).filter(Boolean);
    const now = t[t.length - 1].value, first = vals[0] || now;
    const max = Math.max(...t.map(x => x.value), 1), min = Math.min(...vals, max) * 0.85;
    const diff = Math.round(now - first);
    chart = `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
        <div class="big" style="font-size:30px">${Math.round(now)} kg</div>
        ${diff ? `<div style="font-size:13px;font-weight:600;color:${diff > 0 ? 'var(--positive)' : 'var(--alert)'}">${diff > 0 ? '+' : ''}${diff} kg en 8 semanas</div>` : ''}
      </div>
      <div class="bars" style="height:90px" role="img" aria-label="Fuerza estimada por semana">
        ${t.map((x, i) => `<div class="${i === t.length - 1 ? 'cur' : ''}"><i style="height:${x.value ? Math.max(6, Math.round((x.value - min) / (max - min || 1) * 80) + 6) : 4}px;${i === t.length - 1 ? '' : 'background:var(--line-2)'}"></i></div>`).join('')}
      </div>`;
  }
  return `<section class="card" aria-labelledby="progT" style="gap:14px">
    <div class="card-head"><h2 id="progT">Cómo vas</h2><span class="muted" style="font-size:13px">${ex ? escapeHTML(S.exName(d, ex)) + ' · 1RM est.' : ''}</span></div>
    ${chart}
    <div class="stats3">
      <div><span>Entrenos mes</span><strong>${monthCount}</strong></div>
      <div><span>Peso corporal</span><strong>${bw?.weight_kg ? fmtKg(bw.weight_kg) : '—'}</strong><button type="button" class="btn-link" style="min-height:32px;font-size:12px" data-weight>Registrar</button></div>
      <div><span>Récords</span><strong>${S.recordsThisMonth(d)} este mes</strong></div>
    </div>
  </section>`;
}

function historyCard(d) {
  const ws = S.finished(d).slice(0, 5);
  if (!ws.length) return '';
  return `<section class="card" aria-labelledby="histT" style="gap:4px">
    <div class="card-head" style="padding-bottom:8px"><h2 id="histT">Últimos entrenos</h2></div>
    ${ws.map(w => {
      const n = d.sets.filter(s => s.workout_id === w.id && s.done).length;
      const mins = Math.round((new Date(w.finished_at) - new Date(w.started_at)) / 60000);
      const day = new Date(w.started_at).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
      return `<div class="task"><div class="task-main"><div class="task-title">${escapeHTML(w.name)}</div><div class="task-meta">${escapeHTML(day)} · ${minsLabel(mins)} · ${n} series</div></div>
        <button type="button" class="icon-btn sm" data-wdel="${escapeHTML(w.id)}" aria-label="Borrar entreno ${escapeHTML(w.name)} del ${escapeHTML(day)}">${icon('trash')}</button></div>`;
    }).join('')}
  </section>`;
}

// Actividad: metas vs. lo real (con Whoop si está conectado).
function goalsCard(d) {
  const w = S.weekSummary(d);
  const rows = Object.entries(S.GOALS).map(([k, g]) => {
    const target = S.goal(d, k), v = w.values[k];
    const needsWhoop = ['strain_day', 'steps_day', 'sleep_hours_day'].includes(k) && !w.hasWhoop;
    const pct = v == null || !target ? 0 : Math.min(100, Math.round(v / target * 100));
    const fmt = x => x == null ? '—' : k === 'steps_day' ? Math.round(x).toLocaleString('es-MX') : k === 'strain_day' ? Number(x).toFixed(1) : k === 'sleep_hours_day' ? Number(x).toFixed(1) + ' h' : Math.round(x);
    const met = v != null && v >= target;
    return `<div class="bud">
      <div class="bud-line"><span>${escapeHTML(g.label)} <small class="muted">${escapeHTML(g.unit)}</small></span>
        <span class="${met ? '' : 'muted'}"${met ? ' style="color:var(--positive);font-weight:600"' : ''}>${needsWhoop ? 'con Whoop' : `${fmt(v)} / ${fmt(target)}`}</span></div>
      <div class="track" role="progressbar" aria-label="${escapeHTML(g.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${needsWhoop ? 0 : pct}%"></div></div>
    </div>`;
  }).join('');
  return `<section class="card" aria-labelledby="metT" style="gap:14px">
    <div class="card-head"><h2 id="metT">Metas de esta semana</h2><button type="button" class="btn-link" data-goals>Editar</button></div>
    ${rows}
    <div class="small">Entrenos cuenta los que registras aquí y los de Whoop que no coinciden con ellos. Strain, pasos y sueño son el promedio de los días que van.</div>
  </section>`;
}

function strainCard(d) {
  const days = [...d.whoop.daily].slice(0, 7).reverse();
  if (!days.length) return '';
  const target = S.goal(d, 'strain_day');
  return `<section class="card" style="gap:14px">
    <div class="card-head"><h2>Strain · últimos 7 días</h2><span class="muted" style="font-size:13px">meta ${target}</span></div>
    <div class="bars" style="height:110px" role="img" aria-label="${escapeHTML(days.map(x => `${x.day}: ${x.strain ?? 'sin dato'}`).join(', '))}">
      ${days.map(x => `<div class="${Number(x.strain) >= target ? 'cur' : ''}"><i style="height:${Math.round((Number(x.strain) || 0) / 21 * 90) + 4}px"></i><span>${escapeHTML(new Date(x.day + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short' }).slice(0, 2))}</span></div>`).join('')}
    </div>
  </section>`;
}

function whoopCard(d) {
  const w = d.whoop;
  if (!w.ready) return setupCard('Whoop', 'Falta correr <code>v2/sql/2026-11-03-ejercicio-whoop.sql</code> en Supabase.');
  const s = w.status;
  if (!s || !s.connected) {
    return `<section class="dark-card" style="gap:10px">
      <span class="label">Whoop</span>
      <div style="font-size:18px;font-weight:600">Conecta tu Whoop</div>
      <div class="muted">Trae recuperación, strain, pasos, sueño y entrenos para medir tus metas.</div>
      <div><button type="button" class="btn-light" style="width:auto;padding:0 18px" data-whoop-connect>Conectar Whoop</button></div>
    </section>`;
  }
  const t = S.whoopToday(d);
  const zone = S.recoveryZone(t?.recovery_score);
  const when = s.last_sync_at ? new Date(s.last_sync_at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'nunca';
  return `<section class="card" style="gap:12px">
    <div class="card-head"><h2>Whoop</h2><span class="chip ${s.last_error ? 'chip-alert' : 'chip-soft'}">${s.last_error ? 'Con error' : 'Conectado'}</span></div>
    ${t ? `<div class="stats3" style="border-top:none;padding-top:0">
      <div><span>Recuperación</span><strong>${t.recovery_score ?? '—'}${t.recovery_score != null ? '%' : ''}</strong>${zone ? `<small class="muted">${zone.label}</small>` : ''}</div>
      <div><span>Strain</span><strong>${t.strain ?? '—'}</strong></div>
      <div><span>Pasos</span><strong>${t.steps != null ? Number(t.steps).toLocaleString('es-MX') : '—'}</strong></div>
    </div>` : '<div class="small">Aún no hay datos sincronizados.</div>'}
    <div class="small">Última sincronización: ${escapeHTML(when)}${s.last_error ? ` · ${escapeHTML(s.last_error)}` : ''}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn-dark" data-whoop-sync>Sincronizar</button>
      <button type="button" class="btn-ghost sm" data-whoop-off>Desconectar</button>
    </div>
  </section>`;
}

function sleepCard(d) {
  const nights = d.whoop.daily.filter(x => x.sleep_minutes != null).slice(0, 7);
  if (!nights.length) return d.whoop.status?.connected ? setupCard('Sueño', 'Todavía no hay noches sincronizadas.') : whoopCard(d);
  const target = S.goal(d, 'sleep_hours_day');
  const avg = nights.reduce((s, x) => s + x.sleep_minutes, 0) / nights.length / 60;
  return `<section class="hero" aria-label="Promedio de sueño">
      <div class="card-head"><span class="label">Promedio · últimas ${nights.length} noches</span><span class="hero-pill">meta ${target} h</span></div>
      <div class="hero-num" style="font-size:44px">${minsLabel(Math.round(avg * 60))}</div>
    </section>
    <section class="card" style="gap:4px">
      <div class="card-head" style="padding-bottom:8px"><h2>Noches</h2></div>
      ${nights.map(x => {
        const h = x.sleep_minutes / 60, pct = Math.min(100, Math.round(h / target * 100));
        return `<div class="task" style="flex-wrap:wrap">
          <div class="task-main"><div class="task-title">${escapeHTML(new Date(x.day + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' }))}</div>
            <div class="task-meta">${minsLabel(x.sleep_minutes)}${x.sleep_performance != null ? ` · rendimiento ${x.sleep_performance}%` : ''}${x.recovery_score != null ? ` · recuperación ${x.recovery_score}%` : ''}</div></div>
          <div class="track" style="flex:1 1 100%"><div class="${h < target * 0.85 ? 'over' : ''}" style="width:${pct}%"></div></div>
        </div>`;
      }).join('')}
    </section>`;
}

// ── Pintar ───────────────────────────────────────────
function paint() {
  const d = st.d;
  let body;
  if (!d.ready) {
    body = setupCard('Falta un paso', 'Para usar Ejercicio corre <code>v2/sql/2026-11-03-ejercicio-whoop.sql</code> en el SQL Editor de Supabase y vuelve a abrir esta pantalla.');
  } else if (st.tab === 'ejercicio') {
    body = d.routines.length
      ? `<div class="fin-grid"><div class="fin-col">${heroCard(d)}${weekCard(d)}${historyCard(d)}</div><div class="fin-col">${routineCard(d)}${progressCard(d)}</div></div>`
      : setupCard('Tus rutinas', 'Crea las rutinas base (Push, Pull, Pierna y Full) con varias opciones de ejercicio en cada lugar. Después las puedes cambiar como quieras.',
        `<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn-dark" data-seed>Crear rutinas base</button><a class="btn-ghost sm" style="display:inline-flex;align-items:center;text-decoration:none;color:var(--text)" href="#rutinas">Hacer la mía</a></div>`);
  } else if (st.tab === 'comidas') {
    body = comidasHTML(d);
  } else if (st.tab === 'actividad') {
    body = `<div class="fin-grid"><div class="fin-col">${goalsCard(d)}</div><div class="fin-col">${whoopCard(d)}${strainCard(d)}</div></div>`;
  } else {
    body = `<div class="fin-grid"><div class="fin-col">${sleepCard(d)}</div></div>`;
  }
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center"><h1 class="hello" style="margin:0">Salud</h1></header>
    <div class="seg" role="group" aria-label="Sección">
      ${Object.entries(TABS).map(([k, v]) => `<button type="button" data-tab="${k}" aria-pressed="${k === st.tab}">${v}</button>`).join('')}
    </div>
    ${body}
  </div>`;
  bind();
}

function bind() {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach(b => b.addEventListener('click', fn));
  on('[data-tab]', e => { st.tab = e.currentTarget.dataset.tab; saveTab(st.tab); paint(); });
  on('[data-seed]', seed);
  on('[data-start]', e => startWorkout(e.currentTarget.dataset.start));
  on('[data-change]', chooseRoutine);
  on('[data-weight]', () => openMeasures(st.d, paint));
  if (st.tab === 'comidas' && st.d.ready !== undefined) bindComidas(root, st.d, paint);
  on('[data-goals]', openGoals);
  on('[data-whoop-connect]', connectWhoop);
  on('[data-whoop-sync]', syncWhoop);
  on('[data-whoop-off]', disconnectWhoop);
  on('[data-wdel]', e => deleteWorkout(e.currentTarget.dataset.wdel));
}

async function reload() { st.d = await S.loadSalud(); paint(); }

// Borra un entreno del historial (y sus series). Pide confirmar; no se puede deshacer.
function deleteWorkout(id) {
  const d = st.d, w = d.workouts.find(x => x.id === id); if (!w) return;
  const n = d.sets.filter(s => s.workout_id === id && s.done).length;
  const day = new Date(w.started_at).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });
  openModal('Borrar entreno', `<p class="small" style="margin:0">Se borra "${escapeHTML(w.name)}" del ${escapeHTML(day)} con ${n === 1 ? 'su serie' : `sus ${n} series`}. Ya no cuenta para tu progreso ni tus metas. No se puede deshacer.</p>`,
    '<button type="button" class="btn-primary" style="background:var(--over)" id="wdOk">Sí, borrar</button><button type="button" class="btn-ghost" data-close>Cancelar</button>');
  document.getElementById('wdOk').onclick = async () => {
    closeModal();
    const prevW = d.workouts, prevS = d.sets;
    d.workouts = d.workouts.filter(x => x.id !== id); d.sets = d.sets.filter(s => s.workout_id !== id); paint();
    try { await dbDelete('ex_workouts', `?id=eq.${id}`); showToast('Entreno borrado'); }
    catch { d.workouts = prevW; d.sets = prevS; paint(); showToast('No se pudo borrar', 'error'); }
  };
}

// ── Acciones ─────────────────────────────────────────
async function seed(e) {
  e.currentTarget.disabled = true;
  try { await S.seedRoutines(st.d); showToast('Rutinas creadas'); }
  catch { showToast('No se pudieron crear las rutinas', 'error'); }
  await reload();
}

async function startWorkout(routineId) {
  const r = st.d.routines.find(x => x.id === routineId);
  if (S.activeWorkout(st.d)) { location.hash = '#entreno'; return; }
  try {
    const [w] = await dbPost('ex_workouts', { routine_id: r.id, name: r.name });
    st.d.workouts.unshift(w);
    location.hash = '#entreno';
  } catch { showToast('No se pudo empezar el entreno', 'error'); }
}

function chooseRoutine() {
  const d = st.d;
  openModal('¿Qué rutina hoy?', `<div class="more-list">${d.routines.map(r =>
    `<button type="button" data-pick="${escapeHTML(r.id)}"><span style="flex:1">${escapeHTML(r.name)}</span><span class="small">${S.routineItems(d, r.id).length} ejercicios · ~${S.routineMinutes(d, r)} min</span></button>`).join('')}
    <a href="#rutinas" data-close>${icon('plus')}Crear o editar rutinas</a></div>`);
  document.querySelectorAll('#modal [data-pick]').forEach(b => b.onclick = () => { st.routineId = b.dataset.pick; closeModal(); paint(); });
  document.querySelector('#modal a[data-close]').onclick = () => closeModal();
}


function openGoals() {
  const d = st.d;
  openModal('Metas de actividad', Object.entries(S.GOALS).map(([k, g]) => `
    <label class="flabel" for="g_${k}">${escapeHTML(g.label)} · ${escapeHTML(g.unit)}</label>
    <input class="field" id="g_${k}" inputmode="decimal" autocomplete="off" value="${S.goal(d, k)}">`).join(''),
    '<button type="button" class="btn-primary" id="goalsSave">Guardar metas</button>');
  document.getElementById('goalsSave').onclick = async () => {
    const rows = [];
    for (const k of Object.keys(S.GOALS)) {
      const v = Number(String(document.getElementById('g_' + k).value).replace(',', '.'));
      if (!(v >= 0)) return showToast('Revisa las metas: deben ser números', 'error');
      rows.push({ metric: k, target: v, updated_at: new Date().toISOString() });
    }
    closeModal();
    const prev = d.goals;
    d.goals = rows; paint();
    try { await dbUpsert('activity_goals', rows, 'user_id,metric'); showToast('Metas guardadas'); }
    catch { d.goals = prev; paint(); showToast('No se pudieron guardar las metas', 'error'); }
  };
}

async function connectWhoop(e) {
  e.currentTarget.disabled = true;
  try {
    const { url } = await callFunction('whoop/start');
    location.href = url; // Whoop pide permiso y regresa a #salud?whoop=ok
  } catch (err) {
    e.currentTarget.disabled = false;
    showToast(/Failed to fetch|404/.test(err.message) ? 'Falta publicar la función "whoop" en Supabase' : 'No se pudo conectar: ' + err.message, 'error');
  }
}
async function syncWhoop(e) {
  e.currentTarget.disabled = true;
  try { const r = await callFunction('whoop/sync', { days: 14 }); showToast(`Whoop al día (${r.days} días, ${r.workouts} entrenos)`); }
  catch (err) { showToast('No se pudo sincronizar: ' + err.message, 'error'); }
  await reload();
}
async function disconnectWhoop() {
  openModal('Desconectar Whoop', '<p class="small" style="margin:0">Se borran los permisos guardados. Tus datos ya sincronizados se quedan.</p>',
    '<button type="button" class="btn-primary" id="wOff">Desconectar</button>');
  document.getElementById('wOff').onclick = async () => {
    closeModal();
    try { await callFunction('whoop/disconnect'); showToast('Whoop desconectado'); }
    catch (err) { showToast('No se pudo desconectar: ' + err.message, 'error'); }
    await reload();
  };
}

