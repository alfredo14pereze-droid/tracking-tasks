// Rutinas: lista (#rutinas) y editor de una rutina (#rutina/<id>).
// Cada lugar de la rutina tiene series/reps/descanso y varias opciones de ejercicio.
import { dbPost, dbPatch, dbDelete } from '../db.js?v=202611032355';
import { escapeHTML, showToast, icon, openModal, closeModal } from '../util.js?v=202611032355';
import * as S from '../salud.js?v=202611032355';

let st = null;
let root = null;

export async function show(el, param, isCurrent = () => true) {
  const d = await S.loadSalud();
  if (!isCurrent()) return;
  root = el;
  st = { d, id: param || null };
  if (!d.ready) { location.replace('#salud'); return; }
  paint();
}

function paint() { st.id ? paintEditor() : paintList(); }

// ── Lista ────────────────────────────────────────────
function paintList() {
  const d = st.d;
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center;gap:12px">
      <a class="icon-btn" href="#salud" aria-label="Regresar a Salud">${icon('back')}</a>
      <h1 class="hello" style="margin:0;flex:1">Rutinas</h1>
      <button type="button" class="btn-dark" data-new>${icon('plus', 2.4)}Nueva</button>
    </header>
    <div class="fin-grid"><div class="fin-col">
    <section class="card" style="gap:4px">
      ${d.routines.length ? d.routines.map((r, i) => {
        const items = S.routineItems(d, r.id);
        return `<div class="task">
          <a class="task-main" href="#rutina/${escapeHTML(r.id)}" style="text-decoration:none;color:inherit">
            <span class="task-title" style="font-weight:600">${escapeHTML(r.name)}</span>
            <span class="task-meta">${S.TAGS[r.tag]} · ${items.length} ejercicio${items.length === 1 ? '' : 's'} · ~${S.routineMinutes(d, r)} min</span>
          </a>
          <button type="button" class="icon-btn sm" data-move="${i}:-1" aria-label="Subir ${escapeHTML(r.name)}"${i === 0 ? ' disabled' : ''}>${icon('up')}</button>
          <button type="button" class="icon-btn sm" data-move="${i}:1" aria-label="Bajar ${escapeHTML(r.name)}"${i === d.routines.length - 1 ? ' disabled' : ''}>${icon('down')}</button>
        </div>`;
      }).join('') : '<div class="small">Aún no tienes rutinas.</div>'}
      <div class="small" style="padding-top:10px">El orden es la rotación: después de terminar una, "Hoy toca" sugiere la siguiente.</div>
    </section>
    </div><div class="fin-col">
    <section class="card" style="gap:10px">
      <div class="card-head"><h2>Catálogo de ejercicios</h2><span class="muted" style="font-size:13px">${d.exercises.filter(e => !e.archived).length}</span></div>
      <button type="button" class="btn-dashed" data-new-ex>+ Nuevo ejercicio</button>
    </section>
    </div></div>
  </div>`;
  root.querySelector('[data-new]').onclick = newRoutine;
  root.querySelector('[data-new-ex]').onclick = () => newExercise();
  root.querySelectorAll('[data-move]').forEach(b => b.onclick = () => { const [i, dir] = b.dataset.move.split(':').map(Number); moveRoutine(i, dir); });
}

async function newRoutine() {
  openModal('Nueva rutina', `
    <label class="flabel" for="nrName">Nombre</label>
    <input class="field" id="nrName" maxlength="40" autocomplete="off" placeholder="Torso, Glúteo, Cardio…">
    <label class="flabel" for="nrTag">Tipo</label>
    <select class="field" id="nrTag">${Object.entries(S.TAGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`,
    '<button type="button" class="btn-primary" id="nrOk">Crear</button>');
  setTimeout(() => document.getElementById('nrName').focus(), 50);
  document.getElementById('nrOk').onclick = async () => {
    const name = document.getElementById('nrName').value.trim();
    if (!name) return showToast('Escribe el nombre', 'error');
    closeModal();
    try {
      const [r] = await dbPost('ex_routines', { name, tag: document.getElementById('nrTag').value, position: st.d.routines.length });
      location.hash = '#rutina/' + r.id;
    } catch { showToast('No se pudo crear la rutina', 'error'); }
  };
}

async function moveRoutine(i, dir) {
  const rs = st.d.routines, j = i + dir;
  if (j < 0 || j >= rs.length) return;
  [rs[i], rs[j]] = [rs[j], rs[i]];
  const changed = rs.map((r, k) => ({ r, k, prev: r.position })).filter(x => x.r.position !== x.k);
  changed.forEach(x => { x.r.position = x.k; });
  paint();
  try { await Promise.all(changed.map(x => dbPatch('ex_routines', { position: x.k }, `?id=eq.${x.r.id}`))); }
  catch { changed.forEach(x => { x.r.position = x.prev; }); rs.sort((a, b) => a.position - b.position); paint(); showToast('No se pudo reordenar', 'error'); }
}

// Nuevo ejercicio en el catálogo. Devuelve la fila creada (o null).
function newExercise(onCreated) {
  openModal('Nuevo ejercicio', `
    <label class="flabel" for="neName">Nombre</label>
    <input class="field" id="neName" maxlength="60" autocomplete="off" placeholder="Remo T, Press Arnold…">
    <label class="flabel" for="neMuscle">Grupo muscular</label>
    <select class="field" id="neMuscle">${Object.entries(S.MUSCLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <label class="flabel" for="neEq">Equipo (opcional)</label>
    <input class="field" id="neEq" maxlength="30" autocomplete="off" placeholder="barra, mancuerna, máquina…">`,
    '<button type="button" class="btn-primary" id="neOk">Guardar ejercicio</button>');
  setTimeout(() => document.getElementById('neName').focus(), 50);
  document.getElementById('neOk').onclick = async () => {
    const name = document.getElementById('neName').value.trim();
    if (!name) return showToast('Escribe el nombre', 'error');
    if (st.d.exercises.some(e => e.name.toLowerCase() === name.toLowerCase())) return showToast('Ya existe un ejercicio con ese nombre', 'error');
    try {
      const [e] = await dbPost('ex_exercises', { name, muscle: document.getElementById('neMuscle').value, equipment: document.getElementById('neEq').value.trim() || null });
      st.d.exercises.push(e); st.d.exercises.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      closeModal(); showToast('Ejercicio agregado');
      if (onCreated) onCreated(e); else paint();
    } catch { showToast('No se pudo guardar el ejercicio', 'error'); }
  };
}

// ── Editor de una rutina ─────────────────────────────
function exerciseSelect(id, excludeIds = []) {
  const groups = {};
  st.d.exercises.filter(e => !e.archived && !excludeIds.includes(e.id)).forEach(e => (groups[e.muscle] = groups[e.muscle] || []).push(e));
  return `<select class="field" id="${id}"><option value="">Elige un ejercicio…</option>${Object.entries(groups).map(([m, list]) =>
    `<optgroup label="${escapeHTML(S.MUSCLES[m] || m)}">${list.map(e => `<option value="${escapeHTML(e.id)}">${escapeHTML(e.name)}</option>`).join('')}</optgroup>`).join('')}
    <option value="__new">+ Nuevo ejercicio…</option></select>`;
}

function paintEditor() {
  const d = st.d;
  const r = d.routines.find(x => x.id === st.id);
  if (!r) { location.replace('#rutinas'); return; }
  const items = S.routineItems(d, r.id);
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center;gap:12px">
      <a class="icon-btn" href="#rutinas" aria-label="Regresar a Rutinas">${icon('back')}</a>
      <h1 class="hello" style="margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(r.name)}</h1>
    </header>
    <div class="fin-grid"><div class="fin-col">
    <section class="card" style="gap:6px">
      <label class="flabel" for="rName" style="margin-top:0">Nombre</label>
      <input class="field" id="rName" maxlength="40" value="${escapeHTML(r.name)}">
      <label class="flabel" for="rTag">Tipo</label>
      <select class="field" id="rTag">${Object.entries(S.TAGS).map(([k, v]) => `<option value="${k}"${k === r.tag ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <button type="button" class="btn-link" style="align-self:flex-start;color:var(--alert)" data-archive>Archivar rutina</button>
    </section>
    </div><div class="fin-col">
    ${items.map((it, i) => itemCard(it, i, items.length)).join('')}
    <section class="card" style="gap:6px">
      <label class="flabel" for="addItem" style="margin-top:0">Agregar ejercicio a la rutina</label>
      ${exerciseSelect('addItem')}
    </section>
    </div></div>
  </div>`;
  bindEditor(r);
}

function itemCard(it, i, total) {
  const d = st.d;
  const opts = S.itemOptions(d, it.id);
  const field = (k, label, v, min, max) => `<label class="mini"><span>${label}</span><input class="field" inputmode="numeric" data-item-field="${k}" data-item="${escapeHTML(it.id)}" value="${v}" min="${min}" max="${max}" aria-label="${label}"></label>`;
  return `<section class="card" style="gap:10px" aria-label="Ejercicio ${i + 1}">
    <div class="card-head">
      <h2 style="font-size:15px">${String(i + 1).padStart(2, '0')} · ${escapeHTML(opts[0] ? S.exName(d, opts[0].exercise_id) : 'Sin ejercicio')}</h2>
      <div style="display:flex;gap:4px">
        <button type="button" class="icon-btn sm" data-imove="${escapeHTML(it.id)}:-1" aria-label="Subir"${i === 0 ? ' disabled' : ''}>${icon('up')}</button>
        <button type="button" class="icon-btn sm" data-imove="${escapeHTML(it.id)}:1" aria-label="Bajar"${i === total - 1 ? ' disabled' : ''}>${icon('down')}</button>
        <button type="button" class="icon-btn sm" data-idel="${escapeHTML(it.id)}" aria-label="Quitar de la rutina">${icon('trash')}</button>
      </div>
    </div>
    <div class="minis">
      ${field('sets', 'Series', it.sets, 1, 10)}
      ${field('reps_min', 'Reps mín', it.reps_min, 1, 100)}
      ${field('reps_max', 'Reps máx', it.reps_max, 1, 100)}
      ${field('rest_sec', 'Descanso (s)', it.rest_sec, 0, 900)}
    </div>
    <div class="small">Opciones (la primera es la principal; al entrenar eliges cualquiera):</div>
    <div class="opts">
      ${opts.map((o, k) => `<span class="opt opt-edit" aria-pressed="${k === 0}">${escapeHTML(S.exName(d, o.exercise_id))}
        ${k > 0 ? `<button type="button" data-oprim="${escapeHTML(o.id)}" aria-label="Hacer principal">★</button>` : ''}
        ${opts.length > 1 ? `<button type="button" data-odel="${escapeHTML(o.id)}" aria-label="Quitar opción">✕</button>` : ''}</span>`).join('')}
    </div>
    <label class="sr-only" for="opt-${escapeHTML(it.id)}">Agregar opción</label>
    ${exerciseSelect('opt-' + it.id, opts.map(o => o.exercise_id)).replace('<select ', `<select data-oadd="${escapeHTML(it.id)}" `).replace('Elige un ejercicio…', '+ Agregar opción…')}
  </section>`;
}

function bindEditor(r) {
  const d = st.d;
  const patchRoutine = async (body, undo) => {
    try { await dbPatch('ex_routines', body, `?id=eq.${r.id}`); }
    catch { undo(); paint(); showToast('No se pudo guardar', 'error'); }
  };
  root.querySelector('#rName').onchange = e => {
    const name = e.target.value.trim(), prev = r.name;
    if (!name) { e.target.value = prev; return; }
    r.name = name; paint(); patchRoutine({ name }, () => { r.name = prev; });
  };
  root.querySelector('#rTag').onchange = e => { const prev = r.tag; r.tag = e.target.value; patchRoutine({ tag: r.tag }, () => { r.tag = prev; }); };
  root.querySelector('[data-archive]').onclick = () => {
    openModal('Archivar rutina', `<p class="small" style="margin:0">"${escapeHTML(r.name)}" ya no saldrá en Hoy toca. Tu historial se queda.</p>`,
      '<button type="button" class="btn-primary" id="arOk">Archivar</button>');
    document.getElementById('arOk').onclick = async () => {
      closeModal();
      try { await dbPatch('ex_routines', { archived: true }, `?id=eq.${r.id}`); location.hash = '#rutinas'; }
      catch { showToast('No se pudo archivar', 'error'); }
    };
  };

  root.querySelectorAll('[data-item-field]').forEach(inp => inp.onchange = async () => {
    const it = d.items.find(x => x.id === inp.dataset.item), k = inp.dataset.itemField;
    const v = Math.round(Number(inp.value)), min = Number(inp.min), max = Number(inp.max);
    if (!Number.isFinite(v) || v < min || v > max) { inp.value = it[k]; return showToast(`Debe estar entre ${min} y ${max}`, 'error'); }
    const body = { [k]: v };
    if (k === 'reps_min' && v > it.reps_max) body.reps_max = v;
    if (k === 'reps_max' && v < it.reps_min) body.reps_min = v;
    const prev = { ...it }; Object.assign(it, body); paint();
    try { await dbPatch('ex_routine_items', body, `?id=eq.${it.id}`); }
    catch { Object.assign(it, prev); paint(); showToast('No se pudo guardar', 'error'); }
  });

  root.querySelectorAll('[data-imove]').forEach(b => b.onclick = async () => {
    const [id, dir] = b.dataset.imove.split(':');
    const items = S.routineItems(d, r.id), i = items.findIndex(x => x.id === id), j = i + Number(dir);
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    const changed = items.map((x, k) => ({ x, k, prev: x.position })).filter(z => z.x.position !== z.k);
    changed.forEach(z => { z.x.position = z.k; }); paint();
    try { await Promise.all(changed.map(z => dbPatch('ex_routine_items', { position: z.k }, `?id=eq.${z.x.id}`))); }
    catch { changed.forEach(z => { z.x.position = z.prev; }); paint(); showToast('No se pudo reordenar', 'error'); }
  });

  root.querySelectorAll('[data-idel]').forEach(b => b.onclick = async () => {
    const it = d.items.find(x => x.id === b.dataset.idel);
    const prevItems = d.items, prevOpts = d.options;
    d.items = d.items.filter(x => x !== it); d.options = d.options.filter(o => o.item_id !== it.id); paint();
    try { await dbDelete('ex_routine_items', `?id=eq.${it.id}`); showToast('Ejercicio quitado de la rutina'); }
    catch { d.items = prevItems; d.options = prevOpts; paint(); showToast('No se pudo quitar', 'error'); }
  });

  // Opciones: hacer principal, quitar, agregar.
  root.querySelectorAll('[data-oprim]').forEach(b => b.onclick = async () => {
    const o = d.options.find(x => x.id === b.dataset.oprim);
    const sib = S.itemOptions(d, o.item_id);
    const order = [o, ...sib.filter(x => x !== o)];
    const prev = order.map(x => [x, x.position]);
    order.forEach((x, k) => { x.position = k; }); paint();
    try { await Promise.all(order.map((x, k) => dbPatch('ex_item_options', { position: k }, `?id=eq.${x.id}`))); }
    catch { prev.forEach(([x, p]) => { x.position = p; }); paint(); showToast('No se pudo cambiar', 'error'); }
  });
  root.querySelectorAll('[data-odel]').forEach(b => b.onclick = async () => {
    const o = d.options.find(x => x.id === b.dataset.odel);
    d.options = d.options.filter(x => x !== o); paint();
    try { await dbDelete('ex_item_options', `?id=eq.${o.id}`); }
    catch { d.options.push(o); paint(); showToast('No se pudo quitar la opción', 'error'); }
  });
  const addOption = async (itemId, exerciseId) => {
    const pos = S.itemOptions(d, itemId).length;
    const temp = { id: 'tmp-' + Date.now(), item_id: itemId, exercise_id: exerciseId, position: pos };
    d.options.push(temp); paint();
    try { const [row] = await dbPost('ex_item_options', { item_id: itemId, exercise_id: exerciseId, position: pos }); Object.assign(temp, row); }
    catch { d.options = d.options.filter(x => x !== temp); paint(); showToast('No se pudo agregar la opción', 'error'); }
  };
  root.querySelectorAll('[data-oadd]').forEach(sel => sel.onchange = () => {
    const itemId = sel.dataset.oadd, v = sel.value;
    if (v === '__new') return newExercise(e => addOption(itemId, e.id));
    if (v) addOption(itemId, v);
  });

  // Agregar un lugar nuevo a la rutina.
  const addItem = async exerciseId => {
    try {
      const [it] = await dbPost('ex_routine_items', { routine_id: r.id, position: S.routineItems(d, r.id).length, sets: 3, reps_min: 8, reps_max: 12, rest_sec: 90 });
      d.items.push(it);
      const [o] = await dbPost('ex_item_options', { item_id: it.id, exercise_id: exerciseId, position: 0 });
      d.options.push(o); paint(); showToast('Ejercicio agregado');
    } catch { showToast('No se pudo agregar', 'error'); st.d = await S.loadSalud(); paint(); }
  };
  root.querySelector('#addItem').onchange = e => {
    const v = e.target.value;
    if (v === '__new') return newExercise(ex => addItem(ex.id));
    if (v) addItem(v);
  };
}
