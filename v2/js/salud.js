// Salud: carga de datos de ejercicio + Whoop y la lógica (progresión, rutina sugerida, metas).
import { safeGet, dbPost, callFunction } from './db.js?v=202611041029';
import { localDate, weekKey } from './util.js?v=202611041029';

const daysAgoIso = n => new Date(Date.now() - n * 86400e3).toISOString();
const daysAgoStr = n => { const d = new Date(); d.setDate(d.getDate() - n); return localDate(d); };

export async function loadSalud() {
  const [exercises, routines, items, options, workouts, sets, body, goals, wStatus, wDaily, wWorkouts, meals, dietGoals] = await Promise.all([
    safeGet('ex_exercises', '?order=name.asc'),
    safeGet('ex_routines', '?archived=eq.false&order=position.asc,created_at.asc'),
    safeGet('ex_routine_items', '?order=position.asc,created_at.asc'),
    safeGet('ex_item_options', '?order=position.asc'),
    safeGet('ex_workouts', `?started_at=gte.${daysAgoIso(200)}&order=started_at.desc&limit=400`),
    safeGet('ex_sets', `?created_at=gte.${daysAgoIso(200)}&order=created_at.asc&limit=6000`),
    safeGet('body_metrics', '?order=measured_on.desc&limit=60'),
    safeGet('activity_goals', ''),
    safeGet('whoop_status', ''),
    safeGet('whoop_daily', `?day=gte.${daysAgoStr(40)}&order=day.desc`),
    safeGet('whoop_workouts', `?day=gte.${daysAgoStr(40)}&order=started_at.desc`),
    safeGet('meals', `?eaten_on=gte.${daysAgoStr(60)}&order=eaten_on.desc,created_at.desc`),
    safeGet('diet_goals', '')
  ]);
  return {
    ready: exercises !== null && routines !== null, // false = falta correr el SQL
    exercises: exercises || [], routines: routines || [], items: items || [], options: options || [],
    workouts: workouts || [], sets: sets || [], body: body || [], goals: goals || [],
    meals: meals || [], dietGoals: dietGoals || [], dietReady: meals !== null, // false = falta el SQL de Comidas
    whoop: { status: (wStatus || [])[0] || null, daily: wDaily || [], workouts: wWorkouts || [], ready: wStatus !== null }
  };
}

// ── Catálogo y rutinas ──────────────────────────────
export const exName = (d, id) => d.exercises.find(e => e.id === id)?.name || 'Ejercicio';
export const routineItems = (d, routineId) => d.items.filter(i => i.routine_id === routineId).sort((a, b) => a.position - b.position);
export const itemOptions = (d, itemId) => d.options.filter(o => o.item_id === itemId).sort((a, b) => a.position - b.position)
  .filter(o => d.exercises.some(e => e.id === o.exercise_id && !e.archived));
export const TAGS = { push: 'Push', pull: 'Pull', pierna: 'Pierna', full: 'Full', cardio: 'Cardio', otro: 'Otro' };
export const MUSCLES = { pecho: 'Pecho', espalda: 'Espalda', pierna: 'Pierna', hombro: 'Hombro', brazo: 'Brazo', core: 'Core', cardio: 'Cardio', otro: 'Otro' };

export const finished = d => d.workouts.filter(w => w.finished_at);
export const activeWorkout = d => d.workouts.find(w => !w.finished_at && Date.now() - new Date(w.started_at) < 12 * 3600e3) || null;

// Rutina que sigue: la siguiente (por orden) a la última que terminaste.
export function nextRoutine(d) {
  if (!d.routines.length) return null;
  const last = finished(d).find(w => w.routine_id && d.routines.some(r => r.id === w.routine_id));
  if (!last) return d.routines[0];
  const i = d.routines.findIndex(r => r.id === last.routine_id);
  return d.routines[(i + 1) % d.routines.length];
}

// Minutos estimados: series × (45 s de trabajo + descanso).
export const routineMinutes = (d, r) => Math.round(routineItems(d, r.id).reduce((s, i) => s + i.sets * (45 + i.rest_sec), 0) / 60);

// ── Progresión ──────────────────────────────────────
const round25 = kg => Math.round(kg / 2.5) * 2.5;

// Sesiones (de entrenos terminados) de un ejercicio, la más reciente primero.
export function sessionsFor(d, exerciseId, excludeWorkoutId) {
  const ws = new Map(finished(d).map(w => [w.id, w]));
  const by = new Map();
  for (const s of d.sets) {
    if (s.exercise_id !== exerciseId || !s.done || !ws.has(s.workout_id) || s.workout_id === excludeWorkoutId) continue;
    if (!by.has(s.workout_id)) by.set(s.workout_id, []);
    by.get(s.workout_id).push(s);
  }
  return [...by.entries()]
    .map(([wid, sets]) => ({ workout: ws.get(wid), sets: sets.sort((a, b) => a.set_index - b.set_index) }))
    .sort((a, b) => new Date(b.workout.started_at) - new Date(a.workout.started_at));
}

const topWeight = sets => Math.max(0, ...sets.map(s => Number(s.weight_kg) || 0));
// "Completó todas las reps": hizo las series meta y cada serie de trabajo llegó al máximo del rango.
function succeeded(sess, item) {
  const top = topWeight(sess.sets);
  const work = sess.sets.filter(s => (Number(s.weight_kg) || 0) === top);
  return sess.sets.length >= item.sets && work.every(s => (s.reps || 0) >= item.reps_max);
}

// Sugerencia para la próxima vez: +2.5 kg si completó todo; −10 % si falló 2 veces seguidas con el mismo peso.
export function suggestion(d, exerciseId, item, excludeWorkoutId) {
  const ss = sessionsFor(d, exerciseId, excludeWorkoutId);
  if (!ss.length) return { weight: null, reps: item.reps_max, label: 'nuevo', kind: 'new', prev: [] };
  const last = ss[0], w = topWeight(last.sets), prev = last.sets;
  if (succeeded(last, item)) {
    return w > 0
      ? { weight: w + 2.5, reps: item.reps_min, label: '+2.5 kg', kind: 'up', prev }
      : { weight: 0, reps: item.reps_max + 1, label: '+1 rep', kind: 'up', prev };
  }
  if (ss[1] && !succeeded(ss[1], item) && topWeight(ss[1].sets) === w && w > 0) {
    return { weight: round25(w * 0.9), reps: item.reps_max, label: '−10% descarga', kind: 'down', prev };
  }
  return { weight: w, reps: item.reps_max, label: 'igual', kind: 'same', prev };
}

// 1RM estimado (Epley) por semana para un ejercicio, últimas n semanas.
const e1rm = s => (Number(s.weight_kg) || 0) * (1 + (s.reps || 0) / 30);
export function strengthTrend(d, exerciseId, n = 8) {
  const ss = sessionsFor(d, exerciseId);
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(); dt.setDate(dt.getDate() - i * 7);
    weeks.push({ key: weekKey(dt), value: 0 });
  }
  for (const s of ss) {
    const k = weekKey(new Date(s.workout.started_at));
    const wk = weeks.find(x => x.key === k);
    if (wk) wk.value = Math.max(wk.value, ...s.sets.map(e1rm));
  }
  // Semanas sin entreno toman el último valor conocido (para que la gráfica no caiga a cero).
  let last = 0;
  for (const w of weeks) { if (w.value) last = w.value; else w.value = last; }
  return weeks;
}
// El ejercicio con más sesiones (para "Cómo vas").
export function mainExercise(d) {
  const count = new Map();
  for (const s of d.sets) if (s.done && (Number(s.weight_kg) || 0) > 0) count.set(s.exercise_id, (count.get(s.exercise_id) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
// Récords del mes: ejercicios cuyo mejor 1RM de este mes supera todo lo anterior.
export function recordsThisMonth(d) {
  const ms = localDate().slice(0, 8) + '01';
  const ws = new Map(finished(d).map(w => [w.id, w]));
  const best = new Map(), bestBefore = new Map();
  for (const s of d.sets) {
    const w = ws.get(s.workout_id); if (!w || !s.done) continue;
    const v = e1rm(s); const inMonth = localDate(new Date(w.started_at)) >= ms;
    const m = inMonth ? best : bestBefore;
    m.set(s.exercise_id, Math.max(m.get(s.exercise_id) || 0, v));
  }
  return [...best.entries()].filter(([id, v]) => bestBefore.has(id) && v > bestBefore.get(id)).length;
}

// ── Semana y metas ──────────────────────────────────
export const GOALS = {
  workouts_week:   { label: 'Entrenos', unit: 'por semana', def: 4, step: 1 },
  active_min_week: { label: 'Minutos activos', unit: 'por semana (zonas 2–5)', def: 150, step: 10 },
  strain_day:      { label: 'Strain', unit: 'promedio diario', def: 12, step: 0.5 },
  steps_day:       { label: 'Pasos', unit: 'promedio diario', def: 8000, step: 500 },
  sleep_hours_day: { label: 'Sueño', unit: 'horas por noche', def: 7.5, step: 0.25 }
};
export const goal = (d, k) => Number(d.goals.find(g => g.metric === k)?.target ?? GOALS[k].def);

// Días de la semana actual (lunes a domingo) como YYYY-MM-DD.
export function weekDays() {
  const mon = new Date(weekKey(new Date()) + 'T12:00:00');
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(mon); x.setDate(mon.getDate() + i); return localDate(x); });
}

// Entrenos de Whoop que NO coinciden con un entreno registrado aquí (para no contar doble).
function extraWhoopWorkouts(d, days) {
  const mine = finished(d).map(w => [new Date(w.started_at).getTime(), new Date(w.finished_at).getTime()]);
  return d.whoop.workouts.filter(x => days.includes(x.day) && !mine.some(([a, b]) => {
    const s = new Date(x.started_at).getTime(), e = new Date(x.ended_at || x.started_at).getTime();
    return s < b + 15 * 60e3 && e > a - 15 * 60e3;
  }));
}

export function weekSummary(d) {
  const days = weekDays();
  const today = localDate();
  const mine = finished(d).filter(w => days.includes(localDate(new Date(w.started_at))));
  const extra = extraWhoopWorkouts(d, days);
  const perDay = days.map(day => ({
    day,
    future: day > today,
    today: day === today,
    labels: [
      ...mine.filter(w => localDate(new Date(w.started_at)) === day).map(w => TAGS[d.routines.find(r => r.id === w.routine_id)?.tag] || w.name),
      ...extra.filter(x => x.day === day).map(x => sportLabel(x.sport_name))
    ]
  }));
  const daily = d.whoop.daily.filter(x => days.includes(x.day) && x.day <= today);
  const avg = (arr, f) => { const v = arr.map(f).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const whoopActive = d.whoop.workouts.filter(x => days.includes(x.day)).reduce((s, x) => s + (x.active_minutes || 0), 0);
  const myMinutes = mine.reduce((s, w) => s + Math.max(0, (new Date(w.finished_at) - new Date(w.started_at)) / 60000), 0);
  return {
    perDay,
    values: {
      workouts_week: mine.length + extra.length,
      active_min_week: d.whoop.daily.length ? whoopActive : Math.round(myMinutes),
      strain_day: avg(daily, x => x.strain != null ? Number(x.strain) : null),
      steps_day: avg(daily, x => x.steps),
      sleep_hours_day: avg(daily, x => x.sleep_minutes != null ? x.sleep_minutes / 60 : null)
    },
    hasWhoop: d.whoop.daily.length > 0
  };
}

const SPORTS = { running: 'Correr', cycling: 'Bici', walking: 'Caminar', weightlifting: 'Pesas', 'functional-fitness': 'Funcional', swimming: 'Nadar', yoga: 'Yoga', hiit: 'HIIT', tennis: 'Tenis', soccer: 'Fútbol', basketball: 'Básquet', boxing: 'Box', hiking: 'Senderismo' };
export const sportLabel = s => SPORTS[String(s || '').toLowerCase()] || (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, ' ') : 'Actividad');

// Whoop de hoy (o del último día con datos).
export const whoopToday = d => d.whoop.daily.find(x => x.recovery_score != null) || d.whoop.daily[0] || null;
export function recoveryZone(score) {
  if (score == null) return null;
  return score >= 67 ? { key: 'verde', label: 'día verde' } : score >= 34 ? { key: 'amarillo', label: 'día amarillo' } : { key: 'rojo', label: 'día rojo' };
}
export function recoveryAdvice(score) {
  if (score == null) return '';
  if (score >= 67) return 'Estás en verde: es buen día para subir peso donde te toque.';
  if (score >= 34) return 'Recuperación media: entrena normal y no fuerces la última serie.';
  return 'Recuperación baja: baja el volumen (quita una serie) o haz cardio ligero.';
}

// ── Whoop: sincronizar ──────────────────────────────
// Sincroniza si pasaron más de 2 h desde la última vez. Devuelve true si trajo datos nuevos.
export async function maybeSyncWhoop(d) {
  const st = d.whoop.status;
  if (!st || !st.connected) return false;
  if (st.last_sync_at && Date.now() - new Date(st.last_sync_at) < 2 * 3600e3) return false;
  try { const r = await callFunction('whoop/sync', { days: 7 }); return !!r?.ok; } catch { return false; }
}

// ── Rutinas base ────────────────────────────────────
const EX = [ // [nombre, músculo, equipo]
  ['Press banca con barra', 'pecho', 'barra'], ['Press con mancuernas', 'pecho', 'mancuerna'], ['Press de pecho en máquina', 'pecho', 'máquina'],
  ['Press inclinado con mancuernas', 'pecho', 'mancuerna'], ['Press inclinado con barra', 'pecho', 'barra'], ['Press inclinado en máquina', 'pecho', 'máquina'],
  ['Lagartijas', 'pecho', 'peso corporal'], ['Aperturas en máquina (pec deck)', 'pecho', 'máquina'], ['Cruce de poleas', 'pecho', 'polea'],
  ['Press militar con barra', 'hombro', 'barra'], ['Press de hombro con mancuernas', 'hombro', 'mancuerna'], ['Press de hombro en máquina', 'hombro', 'máquina'],
  ['Elevaciones laterales con mancuernas', 'hombro', 'mancuerna'], ['Elevaciones laterales en polea', 'hombro', 'polea'],
  ['Face pull', 'hombro', 'polea'], ['Pájaros con mancuernas', 'hombro', 'mancuerna'],
  ['Extensión de tríceps en polea', 'brazo', 'polea'], ['Fondos en paralelas', 'brazo', 'peso corporal'], ['Press francés', 'brazo', 'barra'],
  ['Dominadas', 'espalda', 'peso corporal'], ['Jalón al pecho', 'espalda', 'polea'], ['Jalón agarre neutro', 'espalda', 'polea'],
  ['Remo con barra', 'espalda', 'barra'], ['Remo con mancuerna', 'espalda', 'mancuerna'], ['Remo en máquina', 'espalda', 'máquina'], ['Remo en polea baja', 'espalda', 'polea'],
  ['Curl con barra', 'brazo', 'barra'], ['Curl con mancuernas', 'brazo', 'mancuerna'], ['Curl martillo', 'brazo', 'mancuerna'],
  ['Sentadilla con barra', 'pierna', 'barra'], ['Sentadilla hack', 'pierna', 'máquina'], ['Sentadilla goblet', 'pierna', 'mancuerna'],
  ['Peso muerto rumano', 'pierna', 'barra'], ['Peso muerto', 'pierna', 'barra'], ['Hip thrust', 'pierna', 'barra'],
  ['Prensa', 'pierna', 'máquina'], ['Zancadas', 'pierna', 'mancuerna'], ['Sentadilla búlgara', 'pierna', 'mancuerna'],
  ['Extensión de cuádriceps', 'pierna', 'máquina'], ['Curl femoral acostado', 'pierna', 'máquina'], ['Curl femoral sentado', 'pierna', 'máquina'],
  ['Elevación de talones de pie', 'pierna', 'máquina'], ['Elevación de talones sentado', 'pierna', 'máquina'],
  ['Plancha', 'core', 'peso corporal'], ['Rueda abdominal', 'core', 'peso corporal'], ['Crunch en polea', 'core', 'polea']
];
// [rutina, tag, [[opciones…], series, repsMin, repsMax, descanso]]
const ROUTINES = [
  ['Push', 'push', [
    [['Press banca con barra', 'Press con mancuernas', 'Press de pecho en máquina'], 4, 6, 8, 150],
    [['Press inclinado con mancuernas', 'Press inclinado con barra', 'Press inclinado en máquina'], 3, 8, 10, 120],
    [['Press militar con barra', 'Press de hombro con mancuernas', 'Press de hombro en máquina'], 3, 8, 10, 120],
    [['Elevaciones laterales con mancuernas', 'Elevaciones laterales en polea'], 3, 12, 15, 60],
    [['Extensión de tríceps en polea', 'Fondos en paralelas', 'Press francés'], 3, 10, 12, 75],
    [['Aperturas en máquina (pec deck)', 'Cruce de poleas'], 2, 12, 15, 60]]],
  ['Pull', 'pull', [
    [['Dominadas', 'Jalón al pecho', 'Jalón agarre neutro'], 4, 6, 10, 120],
    [['Remo con barra', 'Remo con mancuerna', 'Remo en máquina', 'Remo en polea baja'], 4, 8, 10, 120],
    [['Remo en polea baja', 'Remo en máquina'], 3, 10, 12, 90],
    [['Face pull', 'Pájaros con mancuernas'], 3, 12, 15, 60],
    [['Curl con barra', 'Curl con mancuernas'], 3, 8, 12, 75],
    [['Curl martillo', 'Curl con mancuernas'], 2, 10, 12, 60]]],
  ['Pierna', 'pierna', [
    [['Sentadilla con barra', 'Sentadilla hack', 'Sentadilla goblet'], 4, 5, 6, 180],
    [['Peso muerto rumano', 'Peso muerto', 'Hip thrust'], 3, 8, 8, 150],
    [['Prensa', 'Sentadilla búlgara', 'Zancadas'], 3, 10, 12, 120],
    [['Extensión de cuádriceps'], 3, 12, 15, 60],
    [['Curl femoral acostado', 'Curl femoral sentado'], 3, 10, 12, 60],
    [['Elevación de talones de pie', 'Elevación de talones sentado'], 3, 12, 15, 60]]],
  ['Full', 'full', [
    [['Sentadilla goblet', 'Sentadilla con barra', 'Prensa'], 3, 8, 10, 120],
    [['Press con mancuernas', 'Press banca con barra', 'Lagartijas'], 3, 8, 10, 120],
    [['Remo con mancuerna', 'Remo en polea baja', 'Jalón al pecho'], 3, 8, 10, 90],
    [['Peso muerto rumano', 'Hip thrust'], 3, 8, 10, 120],
    [['Press de hombro con mancuernas', 'Press militar con barra'], 2, 10, 12, 90],
    [['Plancha', 'Rueda abdominal', 'Crunch en polea'], 3, 10, 15, 60]]]
];

export async function seedRoutines(d) {
  const have = new Map(d.exercises.map(e => [e.name, e]));
  const missing = EX.filter(([n]) => !have.has(n)).map(([name, muscle, equipment]) => ({ name, muscle, equipment }));
  if (missing.length) for (const e of await dbPost('ex_exercises', missing)) have.set(e.name, e);
  const base = d.routines.length;
  const rs = await dbPost('ex_routines', ROUTINES.map(([name, tag], i) => ({ name, tag, position: base + i })));
  // Se empareja por (rutina, posición), sin depender del orden en que regrese la API.
  const itemsBody = [], optSpec = new Map();
  for (const r of rs) {
    const spec = ROUTINES.find(x => x[0] === r.name)[2];
    spec.forEach(([opts, sets, rmin, rmax, rest], pi) => {
      itemsBody.push({ routine_id: r.id, position: pi, sets, reps_min: rmin, reps_max: rmax, rest_sec: rest });
      optSpec.set(`${r.id}:${pi}`, opts);
    });
  }
  const items = await dbPost('ex_routine_items', itemsBody);
  const optsBody = [];
  for (const it of items) optSpec.get(`${it.routine_id}:${it.position}`).forEach((n, pos) =>
    optsBody.push({ item_id: it.id, exercise_id: have.get(n).id, position: pos }));
  await dbPost('ex_item_options', optsBody);
}
