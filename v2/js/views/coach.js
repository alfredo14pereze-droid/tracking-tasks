// "Sugerencia de Claude" en Salud › Ejercicio: analiza el historial y sugiere ajustes o una rutina nueva.
// Solo corre al tocar el botón; la última sugerencia se guarda en este navegador.
import { dbPost, dbPatch } from '../db.js?v=202611041452';
import { escapeHTML, localDate, showToast } from '../util.js?v=202611041452';
import { ask, withBusy, aiLabel, cache } from '../ia.js?v=202611041452';
import * as S from '../salud.js?v=202611041452';

const KIND = { subir: 'Subir', mantener: 'Mantener', descarga: 'Descarga', cambiar_ejercicio: 'Cambiar ejercicio', volumen: 'Volumen', nota: 'Nota' };

// Resumen compacto que se manda a Claude (sin ids internos salvo los de los lugares de la rutina).
export function coachPayload(d) {
  const sinceDay = (() => { const x = new Date(); x.setDate(x.getDate() - 84); return localDate(x); })();
  const routines = d.routines.map(r => ({
    rutina: r.name, tipo: r.tag,
    lugares: S.routineItems(d, r.id).map(it => ({
      item_id: it.id, opciones: S.itemOptions(d, it.id).map(o => S.exName(d, o.exercise_id)),
      series: it.sets, reps: `${it.reps_min}-${it.reps_max}`, descanso_s: it.rest_sec
    }))
  }));
  const used = [...new Set(d.sets.filter(s => s.done).map(s => s.exercise_id))];
  const historial = used.map(ex => ({
    ejercicio: S.exName(d, ex),
    sesiones: S.sessionsFor(d, ex).filter(s => localDate(new Date(s.workout.started_at)) >= sinceDay).slice(0, 8).reverse()
      .map(s => ({ fecha: localDate(new Date(s.workout.started_at)), series: s.sets.map(x => [Number(x.weight_kg) || 0, x.reps || 0]) }))
  })).filter(h => h.sesiones.length);
  return {
    hoy: localDate(),
    rutinas: routines,
    historial,
    entrenos_por_semana_meta: S.goal(d, 'workouts_week'),
    entrenos_ultimas_4_semanas: S.finished(d).filter(w => (Date.now() - new Date(w.started_at)) < 28 * 864e5).length,
    recuperacion_whoop: d.whoop.daily.slice(0, 7).map(x => ({ dia: x.day, recuperacion: x.recovery_score, sueno_h: x.sleep_minutes != null ? Math.round(x.sleep_minutes / 6) / 10 : null, strain: x.strain })),
    peso_kg: d.body.find(x => x.weight_kg)?.weight_kg ?? null,
    catalogo: d.exercises.filter(e => !e.archived).map(e => e.name)
  };
}

export function coachHTML(d) {
  if (!d.routines.length) return '';
  const c = cache.get('gym');
  const tip = c?.v;
  const when = c ? new Date(c.at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '';
  return `<section class="dark-card coach" aria-labelledby="coachT" style="gap:10px">
    <div class="card-head"><span class="label" id="coachT">✦ Sugerencia de Claude</span>${tip ? `<span class="muted" style="font-size:12px">${escapeHTML(when)}</span>` : ''}</div>
    ${tip ? `<div style="font-size:17px;font-weight:600;line-height:1.35">${escapeHTML(tip.headline)}</div>
      ${tip.analysis ? `<div class="muted" style="font-size:13px;line-height:1.45">${escapeHTML(tip.analysis)}</div>` : ''}
      <div class="coach-list">${(tip.suggestions || []).map((s, i) => {
        const it = s.item_id && d.items.find(x => x.id === s.item_id);
        const change = it && (s.new_sets || s.new_reps_min || s.new_reps_max);
        const applied = c.applied?.includes(i);
        return `<div class="coach-item"><span class="coach-kind">${escapeHTML(KIND[s.kind] || 'Nota')}${s.exercise ? ' · ' + escapeHTML(s.exercise) : ''}</span>
          <span>${escapeHTML(s.text)}</span>
          ${change ? `<button type="button" class="btn-outline-light" data-coach-apply="${i}"${applied ? ' disabled' : ''}>${applied ? 'Aplicado ✓' : `Aplicar: ${s.new_sets || it.sets} × ${s.new_reps_min || it.reps_min}–${s.new_reps_max || it.reps_max}`}</button>` : ''}</div>`;
      }).join('')}</div>
      ${tip.new_routine?.include && tip.new_routine.items?.length ? `<div class="coach-item"><span class="coach-kind">Rutina nueva · ${escapeHTML(tip.new_routine.name)}</span><span>${escapeHTML(tip.new_routine.reason)}</span>
        <span class="muted" style="font-size:12px">${escapeHTML(tip.new_routine.items.map(x => `${x.exercise} ${x.sets}×${x.reps_min}–${x.reps_max}`).join(' · '))}</span>
        <button type="button" class="btn-light" style="width:auto;padding:0 16px;min-height:40px" data-coach-routine${c.routineCreated ? ' disabled' : ''}>${c.routineCreated ? 'Rutina creada ✓' : 'Crear esta rutina'}</button></div>` : ''}`
      : '<div class="muted" style="font-size:14px;line-height:1.45">Analiza tu historial: estancamientos, cuándo subir peso o hacer descarga, y si te conviene una rutina nueva.</div>'}
    <label class="sr-only" for="coachNote">Algo que quieras que tome en cuenta</label>
    <input class="field coach-note" id="coachNote" placeholder="Opcional: “me duele el hombro”, “quiero más pierna”…" maxlength="200" autocomplete="off">
    <button type="button" class="btn-light" style="width:auto;padding:0 18px;min-height:44px;align-self:flex-start" data-coach-ask>${aiLabel(tip ? 'Pedir otra sugerencia' : 'Pedir sugerencia')}</button>
  </section>`;
}

export function bindCoach(root, d, repaint, reload) {
  root.querySelector('[data-coach-ask]')?.addEventListener('click', async e => {
    try {
      const note = root.querySelector('#coachNote')?.value.trim();
      const tip = await withBusy(e.currentTarget, 'Analizando…', () => ask('gym', { data: coachPayload(d), note }));
      cache.set('gym', tip); repaint();
    } catch (err) { showToast(err.message, 'error'); }
  });
  root.querySelectorAll('[data-coach-apply]').forEach(b => b.addEventListener('click', async () => {
    const c = cache.get('gym'); const i = Number(b.dataset.coachApply); const s = c.v.suggestions[i];
    const it = d.items.find(x => x.id === s.item_id); if (!it) return showToast('Ese ejercicio ya no está en la rutina', 'error');
    const body = {};
    if (s.new_sets >= 1 && s.new_sets <= 10) body.sets = s.new_sets;
    if (s.new_reps_min >= 1 && s.new_reps_min <= 100) body.reps_min = s.new_reps_min;
    if (s.new_reps_max >= 1 && s.new_reps_max <= 100) body.reps_max = s.new_reps_max;
    if ((body.reps_min ?? it.reps_min) > (body.reps_max ?? it.reps_max)) body.reps_max = body.reps_min ?? it.reps_min;
    if (!Object.keys(body).length) return;
    const prev = { sets: it.sets, reps_min: it.reps_min, reps_max: it.reps_max };
    Object.assign(it, body);
    try {
      await dbPatch('ex_routine_items', body, `?id=eq.${it.id}`);
      localStorage.setItem('v2ai:gym', JSON.stringify({ ...c, applied: [...(c.applied || []), i] }));
      repaint(); showToast('Rutina actualizada');
    } catch { Object.assign(it, prev); repaint(); showToast('No se pudo aplicar', 'error'); }
  }));
  root.querySelector('[data-coach-routine]')?.addEventListener('click', async e => {
    const c = cache.get('gym'); const nr = c.v.new_routine;
    try {
      await withBusy(e.currentTarget, 'Creando…', () => createRoutine(d, nr));
      localStorage.setItem('v2ai:gym', JSON.stringify({ ...c, routineCreated: true }));
      showToast(`Rutina "${nr.name}" creada`); await reload();
    } catch { showToast('No se pudo crear la rutina', 'error'); }
  });
}

// Crea la rutina sugerida: usa ejercicios del catálogo por nombre y crea los que falten.
async function createRoutine(d, nr) {
  const byName = new Map(d.exercises.map(e => [e.name.toLowerCase(), e]));
  const names = [...new Set(nr.items.flatMap(x => [x.exercise, ...(x.alternatives || [])]).map(n => n.trim()).filter(Boolean))];
  const missing = names.filter(n => !byName.has(n.toLowerCase())).map(n => {
    const it = nr.items.find(x => x.exercise === n || (x.alternatives || []).includes(n));
    return { name: n, muscle: it?.muscle || 'otro' };
  });
  if (missing.length) for (const e of await dbPost('ex_exercises', missing)) byName.set(e.name.toLowerCase(), e);
  const tag = Object.keys(S.TAGS).includes(nr.tag) ? nr.tag : 'otro';
  const [r] = await dbPost('ex_routines', { name: nr.name.slice(0, 40) || 'Rutina nueva', tag, position: d.routines.length });
  const clamp = (v, lo, hi, def) => Number.isFinite(+v) && +v >= lo && +v <= hi ? Math.round(+v) : def;
  const items = await dbPost('ex_routine_items', nr.items.map((x, i) => {
    const rmin = clamp(x.reps_min, 1, 100, 8), rmax = Math.max(rmin, clamp(x.reps_max, 1, 100, 12));
    return { routine_id: r.id, position: i, sets: clamp(x.sets, 1, 10, 3), reps_min: rmin, reps_max: rmax, rest_sec: clamp(x.rest_sec, 0, 900, 90) };
  }));
  const opts = [];
  for (const it of items) {
    const spec = nr.items[it.position];
    [...new Set([spec.exercise, ...(spec.alternatives || [])])].forEach((n, pos) => {
      const ex = byName.get(String(n).trim().toLowerCase()); if (ex) opts.push({ item_id: it.id, exercise_id: ex.id, position: pos });
    });
  }
  if (opts.length) await dbPost('ex_item_options', opts);
}
