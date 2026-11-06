// Entreno en curso: una tarjeta por ejercicio con sus series, "anterior", opciones y timer de descanso.
// Cada serie se guarda al marcarla (optimista + rollback). Lo no marcado vive en un borrador local.
import { dbPost, dbPatch, dbDelete } from '../db.js?v=202611051824';
import { escapeHTML, showToast, icon, openModal, closeModal } from '../util.js?v=202611051824';
import * as S from '../salud.js?v=202611051824';
import { exerciseArt } from '../ilustraciones.js?v=202611051824';

let st = null;     // { d, w, slots, current, restEnd, restTotal }
let root = null;
let tick = null;

const draftKey = id => 'v2Workout:' + id;
function saveDraft() {
  try {
    localStorage.setItem(draftKey(st.w.id), JSON.stringify({
      current: st.current,
      slots: st.slots.map(s => ({ itemId: s.itemId, exerciseId: s.exerciseId, sets: s.sets.map(x => ({ w: x.w, r: x.r })) }))
    }));
  } catch { /* sin storage */ }
}
function readDraft(id) { try { return JSON.parse(localStorage.getItem(draftKey(id)) || 'null'); } catch { return null; } }
function clearDraft(id) { try { localStorage.removeItem(draftKey(id)); } catch { /* sin storage */ } }

export async function show(el, isCurrent = () => true) {
  const d = await S.loadSalud();
  if (!isCurrent()) return;
  const w = S.activeWorkout(d);
  if (!d.ready || !w) { location.replace('#salud'); return; }
  root = el;
  st = { d, w, slots: buildSlots(d, w), current: 0, restEnd: null, restTotal: 0 };
  const draft = readDraft(w.id);
  if (draft) st.current = Math.min(draft.current || 0, st.slots.length - 1);
  else st.current = Math.max(0, st.slots.findIndex(s => s.sets.some(x => !x.done)));
  paint();
  clearInterval(tick);
  tick = setInterval(onTick, 1000);
  window.addEventListener('hashchange', stopTick, { once: true });
}
function stopTick() { clearInterval(tick); tick = null; }

// ── Armar ejercicios del entreno ────────────────────
function slotFromItem(d, item, exerciseId) {
  const ex = exerciseId || S.itemOptions(d, item.id)[0]?.exercise_id;
  const sug = ex ? S.suggestion(d, ex, item, st?.w?.id) : null;
  return {
    itemId: item.id, item, exerciseId: ex,
    sug,
    sets: Array.from({ length: item.sets }, () => ({ w: sug?.weight ?? '', r: '', done: false, id: null }))
  };
}
const LOOSE_ITEM = { sets: 3, reps_min: 8, reps_max: 12, rest_sec: 90 }; // ejercicio agregado fuera de la rutina

function buildSlots(d, w) {
  const items = w.routine_id ? S.routineItems(d, w.routine_id) : [];
  const saved = d.sets.filter(s => s.workout_id === w.id).sort((a, b) => a.slot - b.slot || a.set_index - b.set_index);
  const draft = readDraft(w.id);
  st = { d, w }; // para que suggestion excluya este entreno
  const slots = items.map((it, i) => {
    const mine = saved.filter(s => s.slot === i);
    const ex = mine[0]?.exercise_id || draft?.slots?.[i]?.exerciseId;
    return slotFromItem(d, it, ex);
  });
  // Ejercicios agregados (sin lugar en la rutina): vienen de series guardadas o del borrador.
  const maxSlot = Math.max(items.length - 1, ...saved.map(s => s.slot), (draft?.slots?.length || 0) - 1);
  for (let i = items.length; i <= maxSlot; i++) {
    const ex = saved.find(s => s.slot === i)?.exercise_id || draft?.slots?.[i]?.exerciseId;
    if (!ex) continue;
    slots[i] = slotFromItem(d, { ...LOOSE_ITEM, id: null }, ex);
    slots[i].itemId = null;
  }
  const clean = slots.filter(Boolean);
  // Valores escritos (borrador) y series ya guardadas.
  clean.forEach((s, i) => {
    const ds = draft?.slots?.[i];
    if (ds && ds.exerciseId === s.exerciseId) ds.sets.forEach((x, j) => { if (!s.sets[j]) s.sets[j] = { w: '', r: '', done: false, id: null }; s.sets[j].w = x.w; s.sets[j].r = x.r; });
    for (const row of saved.filter(x => x.slot === i)) {
      const j = row.set_index - 1;
      while (s.sets.length <= j) s.sets.push({ w: '', r: '', done: false, id: null });
      s.sets[j] = { w: row.weight_kg ?? '', r: row.reps ?? '', done: row.done, id: row.id };
    }
  });
  return clean;
}

// ── Pintar ───────────────────────────────────────────
const elapsed = () => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(st.w.started_at)) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0');
};
const restLeft = () => st.restEnd ? Math.max(0, Math.round((st.restEnd - Date.now()) / 1000)) : 0;
const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const slotDone = s => s.sets.length > 0 && s.sets.every(x => x.done);
const fmtKg = w => w === '' || w == null ? '' : `${Number(w) % 1 ? Number(w).toFixed(1) : Number(w)} kg`;
const repsTxt = it => it.reps_min === it.reps_max ? it.reps_max : `${it.reps_min}–${it.reps_max}`;

function onTick() {
  if (!root || !document.body.contains(root)) return stopTick();
  const c = root.querySelector('#wClock'); if (c) c.textContent = `${elapsed()} · ${st.current + 1} de ${st.slots.length}`;
  const r = root.querySelector('#restClock');
  if (r) {
    const left = restLeft();
    r.textContent = mmss(left);
    if (st.restEnd && left === 0) { st.restEnd = null; try { navigator.vibrate?.(300); } catch { /* sin vibración */ } showToast('Descanso terminado'); paint(); }
  }
}

function setRow(slot, x, j) {
  const prev = slot.sug?.prev?.[j];
  const prevTxt = prev ? `${Number(prev.weight_kg) || 0} × ${prev.reps ?? '—'}` : '—';
  const ph = slot.sug?.reps ?? slot.item.reps_max;
  return `<div class="set-row${x.done ? ' done' : ''}" data-set="${j}">
    <div class="set-n">${j + 1}</div>
    <div class="set-prev">${escapeHTML(prevTxt)}</div>
    <input class="set-in" type="number" step="any" min="0" enterkeyhint="next" aria-label="Peso serie ${j + 1}" data-f="w" value="${escapeHTML(String(x.w ?? ''))}" placeholder="kg">
    <input class="set-in" type="number" step="1" min="0" enterkeyhint="${j === slot.sets.length - 1 ? 'done' : 'next'}" aria-label="Repeticiones serie ${j + 1}" data-f="r" value="${escapeHTML(String(x.r ?? ''))}" placeholder="${escapeHTML(String(ph))}">
    <button type="button" class="set-ok${x.done ? ' on' : ''}" data-ok aria-label="${x.done ? 'Desmarcar' : 'Marcar'} serie ${j + 1}" aria-pressed="${x.done}">${x.done ? icon('check', 3) : ''}</button>
  </div>`;
}

function optionsRow(slot) {
  if (!slot.itemId) return '';
  const opts = S.itemOptions(st.d, slot.itemId);
  if (opts.length < 2) return '';
  const locked = slot.sets.some(x => x.done);
  return `<div class="opts" role="group" aria-label="Opciones de ejercicio">
    ${opts.map(o => `<button type="button" class="opt" data-opt="${escapeHTML(o.exercise_id)}" aria-pressed="${o.exercise_id === slot.exerciseId}"${locked && o.exercise_id !== slot.exerciseId ? ' disabled' : ''}>${escapeHTML(S.exName(st.d, o.exercise_id))}</button>`).join('')}
  </div>`;
}

function paint() {
  const slot = st.slots[st.current];
  const doneSlots = st.slots.filter(slotDone).length;
  const pct = st.slots.length ? Math.round(doneSlots / st.slots.length * 100) : 0;
  const it = slot?.item;
  const sug = slot?.sug;
  const left = restLeft();

  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center;gap:12px">
      <a class="icon-btn" href="#salud" aria-label="Regresar a Salud (el entreno sigue)">${icon('back')}</a>
      <div style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px">
        <div style="font-size:17px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${escapeHTML(st.w.name)}</div>
        <div id="wClock" class="muted" style="font-size:13px;font-variant-numeric:tabular-nums">${elapsed()} · ${st.current + 1} de ${st.slots.length}</div>
      </div>
      <button type="button" class="btn-primary" style="min-height:44px;padding:0 16px;border-radius:22px" data-finish>Terminar</button>
    </header>
    <div class="track" role="progressbar" aria-label="Ejercicios terminados" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>

    <div class="fin-grid"><div class="fin-col">
    ${slot ? `<section class="card" style="gap:14px" aria-labelledby="exT">
      <div class="card-head" style="align-items:flex-start;gap:12px">
        ${(() => { const e = st.d.exercises.find(x => x.id === slot.exerciseId); return exerciseArt(e?.name, e?.muscle, 64); })()}
        <div style="min-width:0;display:flex;flex-direction:column;gap:4px;flex:1">
          <h2 id="exT" style="font-size:22px;letter-spacing:-.02em;overflow-wrap:anywhere">${escapeHTML(S.exName(st.d, slot.exerciseId))}</h2>
          <div class="small" style="font-size:13px">Meta: ${slot.sets.length} × ${repsTxt(it)}${sug?.weight ? ' · ' + fmtKg(sug.weight) : ''} · descanso ${mmss(it.rest_sec)}</div>
        </div>
        ${sug && sug.kind !== 'new' ? `<span class="chip ${sug.kind === 'up' ? 'chip-soft' : sug.kind === 'down' ? 'chip-alert' : 'chip-plain'}">${escapeHTML(sug.label)}${sug.kind === 'up' && sug.weight ? ' vs última' : ''}</span>` : ''}
      </div>
      ${sug?.prev?.length ? `<div class="last-time"><span>La vez pasada · ${escapeHTML(new Date(sug.prevAt).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''))}</span>
        <b>${sug.prev.map(p => `${Number(p.weight_kg) || 0}×${p.reps ?? '—'}`).join(' · ')}</b></div>` : '<div class="last-time"><span>Primera vez con este ejercicio</span></div>'}
      ${optionsRow(slot)}
      <div class="set-row set-head" aria-hidden="true"><div>Serie</div><div>Anterior</div><div>kg</div><div>Reps</div><div></div></div>
      ${slot.sets.map((x, j) => setRow(slot, x, j)).join('')}
      <div style="display:flex;gap:8px">
        <button type="button" class="btn-dashed" data-add-set>+ Agregar serie</button>
        ${slot.sets.length > 1 && !slot.sets[slot.sets.length - 1].done ? '<button type="button" class="btn-dashed" style="flex:0 0 auto;padding:0 14px" data-del-set aria-label="Quitar la última serie">−</button>' : ''}
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px">
        <button type="button" class="btn-ghost sm" data-go="${st.current - 1}"${st.current === 0 ? ' disabled' : ''}>← Anterior</button>
        <button type="button" class="btn-ghost sm" data-go="${st.current + 1}"${st.current >= st.slots.length - 1 ? ' disabled' : ''}>Siguiente →</button>
      </div>
    </section>` : '<section class="card"><div class="small">Este entreno no tiene ejercicios. Agrega uno abajo.</div></section>'}

    ${st.restEnd ? `<section class="dark-card" style="flex-direction:row;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="display:flex;flex-direction:column;gap:2px;flex:1 1 auto">
        <span class="label">Descanso</span>
        <div id="restClock" style="font-size:30px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums" aria-live="off">${mmss(left)}</div>
      </div>
      <button type="button" class="btn-outline-light" data-rest="-15">−15 s</button>
      <button type="button" class="btn-outline-light" data-rest="15">+15 s</button>
      <button type="button" class="btn-light" style="width:auto;padding:0 16px;min-height:40px" data-rest="skip">Saltar</button>
    </section>` : ''}
    </div>

    <div class="fin-col">
    <section class="card" style="gap:4px" aria-labelledby="sigT">
      <h2 id="sigT" style="font-size:16px;font-weight:600;padding-bottom:8px">Ejercicios del entreno</h2>
      ${st.slots.map((s, i) => {
        const done = slotDone(s), n = s.sets.filter(x => x.done).length;
        return `<button type="button" class="task next-row${i === st.current ? ' cur' : ''}" data-go="${i}">
          <span class="check ${done ? 'done' : ''}" aria-hidden="true">${done ? icon('check', 3) : ''}</span>
          <span class="task-main"><span class="task-title${done ? ' struck' : ''}">${escapeHTML(S.exName(st.d, s.exerciseId))}</span>
          <span class="task-meta">${n ? `${n} de ${s.sets.length} series` : `${s.sets.length} × ${repsTxt(s.item)}${s.sug?.weight ? ' · ' + fmtKg(s.sug.weight) : ''}`}</span></span>
        </button>`;
      }).join('')}
      <button type="button" class="btn-dashed" style="margin-top:10px" data-add-ex>+ Agregar ejercicio</button>
    </section>
    </div></div>
  </div>`;
  bind();
  if (st.focus) { // después de marcar una serie con Enter, sigue en la próxima
    const el = root.querySelector(`.set-row[data-set="${st.focus.j}"] [data-f="${st.focus.f}"]`);
    if (el && !el.closest('.set-row').classList.contains('done')) el.focus({ preventScroll: false });
  }
}

// ── Eventos ──────────────────────────────────────────
function bind() {
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.go); if (i < 0 || i >= st.slots.length) return;
    st.current = i; saveDraft(); paint(); window.scrollTo(0, 0);
  });
  root.querySelector('[data-finish]').onclick = finish;
  root.querySelector('[data-add-set]')?.addEventListener('click', () => {
    const s = st.slots[st.current]; const last = s.sets[s.sets.length - 1];
    s.sets.push({ w: last?.w ?? '', r: '', done: false, id: null }); saveDraft(); paint();
  });
  root.querySelector('[data-del-set]')?.addEventListener('click', () => { st.slots[st.current].sets.pop(); saveDraft(); paint(); });
  root.querySelector('[data-add-ex]').onclick = addExercise;
  root.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => switchOption(b.dataset.opt));
  root.querySelectorAll('[data-rest]').forEach(b => b.onclick = () => {
    const v = b.dataset.rest;
    if (v === 'skip') st.restEnd = null; else st.restEnd = Math.max(Date.now(), st.restEnd + Number(v) * 1000);
    paint();
  });
  root.querySelectorAll('.set-row[data-set]').forEach(row => {
    const j = Number(row.dataset.set);
    row.querySelectorAll('.set-in').forEach(inp => {
      inp.addEventListener('input', () => { st.slots[st.current].sets[j][inp.dataset.f] = inp.value; saveDraft(); });
      inp.addEventListener('change', () => { const x = st.slots[st.current].sets[j]; if (x.done) updateSet(st.current, j); });
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const x = st.slots[st.current].sets[j];
        if (inp.dataset.f === 'w') return row.querySelector('[data-f="r"]').focus();
        // Reps: marca la serie (si no estaba) y salta al peso de la siguiente.
        st.focus = j + 1 < st.slots[st.current].sets.length ? { j: j + 1, f: 'w' } : null;
        if (!x.done) toggleSet(st.current, j); else { const nx = root.querySelector(`.set-row[data-set="${j + 1}"] [data-f="w"]`); if (nx) nx.focus(); else inp.blur(); }
      });
    });
    row.querySelector('[data-ok]').onclick = () => toggleSet(st.current, j);
  });
}

const num = v => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

async function toggleSet(si, j) {
  const s = st.slots[si], x = s.sets[j];
  if (x.done) { // desmarcar = borrar la serie guardada
    const prev = { ...x };
    x.done = false; const id = x.id; x.id = null; paint();
    if (!id) return;
    try { await dbDelete('ex_sets', `?id=eq.${id}`); }
    catch { Object.assign(x, prev); paint(); showToast('No se pudo desmarcar', 'error'); }
    return;
  }
  if (x.r === '' || x.r == null) x.r = String(s.sug?.reps ?? s.item.reps_max); // sin escribir = las reps meta
  const w = num(x.w), r = num(x.r);
  if (w === null || w < 0 || r === null || r < 0) { st.focus = null; return showToast('Revisa el peso y las reps', 'error'); }
  x.done = true;
  st.restEnd = Date.now() + (s.item.rest_sec || 90) * 1000;
  saveDraft(); paint();
  try {
    const [row] = await dbPost('ex_sets', {
      workout_id: st.w.id, item_id: s.itemId, exercise_id: s.exerciseId, slot: si, set_index: j + 1,
      weight_kg: w, reps: Math.round(r), target_reps: s.item.reps_max, done: true
    });
    x.id = row.id;
    st.d.sets.push(row);
    // Serie final del ejercicio: pasa solo al siguiente pendiente.
    if (slotDone(s) && si === st.current) {
      const nxt = st.slots.findIndex((z, k) => k > si && !slotDone(z));
      if (nxt >= 0) { st.current = nxt; st.focus = { j: 0, f: 'w' }; saveDraft(); }
    }
    paint();
  } catch {
    x.done = false; st.restEnd = null; paint(); showToast('No se pudo guardar la serie', 'error');
  }
  st.focus = null;
}

async function updateSet(si, j) {
  const x = st.slots[si].sets[j];
  const w = num(x.w), r = num(x.r);
  if (!x.id || w === null || r === null) return;
  try { await dbPatch('ex_sets', { weight_kg: w, reps: Math.round(r) }, `?id=eq.${x.id}`); }
  catch { showToast('No se pudo actualizar la serie', 'error'); }
}

function switchOption(exerciseId) {
  const s = st.slots[st.current];
  if (s.sets.some(x => x.done)) return showToast('Ya registraste series de este ejercicio', 'error');
  const fresh = slotFromItem(st.d, s.item, exerciseId);
  fresh.sets = fresh.sets.slice(0, Math.max(s.sets.length, 1));
  while (fresh.sets.length < s.sets.length) fresh.sets.push({ w: fresh.sug?.weight ?? '', r: '', done: false, id: null });
  st.slots[st.current] = fresh;
  saveDraft(); paint();
}

function addExercise() {
  const d = st.d;
  const groups = {};
  d.exercises.filter(e => !e.archived).forEach(e => (groups[e.muscle] = groups[e.muscle] || []).push(e));
  openModal('Agregar ejercicio', `
    <label class="flabel" for="addEx">Ejercicio</label>
    <select class="field" id="addEx">${Object.entries(groups).map(([m, list]) =>
      `<optgroup label="${escapeHTML(S.MUSCLES[m] || m)}">${list.map(e => `<option value="${escapeHTML(e.id)}">${escapeHTML(e.name)}</option>`).join('')}</optgroup>`).join('')}</select>
    <p class="small" style="margin:6px 0 0">Para agregar uno que no está en la lista, ve a Salud › Editar rutinas.</p>`,
    '<button type="button" class="btn-primary" id="addExOk">Agregar</button>');
  document.getElementById('addExOk').onclick = () => {
    const id = document.getElementById('addEx').value;
    if (!id) return;
    const s = slotFromItem(d, { ...LOOSE_ITEM, id: null }, id);
    s.itemId = null;
    st.slots.push(s);
    st.current = st.slots.length - 1;
    closeModal(); saveDraft(); paint();
  };
}

function finish() {
  const n = st.slots.reduce((a, s) => a + s.sets.filter(x => x.done).length, 0);
  if (!n) {
    openModal('Terminar entreno', '<p class="small" style="margin:0">No registraste ninguna serie. ¿Descartas este entreno?</p>',
      '<button type="button" class="btn-primary" id="fDiscard">Descartar entreno</button><button type="button" class="btn-ghost" data-close>Seguir entrenando</button>');
    document.getElementById('fDiscard').onclick = async () => {
      closeModal();
      try { await dbDelete('ex_workouts', `?id=eq.${st.w.id}`); clearDraft(st.w.id); stopTick(); location.hash = '#salud'; }
      catch { showToast('No se pudo descartar', 'error'); }
    };
    return;
  }
  const pending = st.slots.reduce((a, s) => a + s.sets.filter(x => !x.done).length, 0);
  openModal('Terminar entreno', `<p class="small" style="margin:0">${n} serie${n === 1 ? '' : 's'} registrada${n === 1 ? '' : 's'}${pending ? ` · ${pending} sin marcar (no se guardan)` : ''}.</p>`,
    '<button type="button" class="btn-primary" id="fOk">Terminar</button><button type="button" class="btn-ghost" data-close>Seguir entrenando</button><button type="button" class="btn-link" style="color:var(--alert)" id="fDrop">Descartar entreno (borra sus series)</button>');
  // Descartar aunque haya series (p. ej. un entreno de prueba): pide confirmar antes de borrar.
  document.getElementById('fDrop').onclick = () => {
    openModal('Descartar entreno', `<p class="small" style="margin:0">Se borran este entreno y ${n === 1 ? 'su serie' : `sus ${n} series`}. No cuenta para tu progreso ni para tus metas. No se puede deshacer.</p>`,
      '<button type="button" class="btn-primary" style="background:var(--over)" id="fDropOk">Sí, descartar</button><button type="button" class="btn-ghost" data-close>Cancelar</button>');
    document.getElementById('fDropOk').onclick = async () => {
      closeModal();
      try { await dbDelete('ex_workouts', `?id=eq.${st.w.id}`); clearDraft(st.w.id); stopTick(); showToast('Entreno descartado'); location.hash = '#salud'; }
      catch { showToast('No se pudo descartar', 'error'); }
    };
  };
  document.getElementById('fOk').onclick = async () => {
    closeModal();
    const at = new Date().toISOString();
    try {
      await dbPatch('ex_workouts', { finished_at: at }, `?id=eq.${st.w.id}`);
      clearDraft(st.w.id); stopTick();
      const k = S.workoutKcal(st.d, { ...st.w, finished_at: at });
      showToast(`¡Bien! ${st.w.name} terminado · ${elapsed()} · ~${k.kcal} kcal${k.whoop ? ' (Whoop)' : ''}`);
      location.hash = '#salud';
    } catch { showToast('No se pudo terminar el entreno', 'error'); }
  };
}
