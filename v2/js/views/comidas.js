// Comidas (dieta): macros del día vs. metas, registro, ideas con receta, semana y peso/medidas.
// Vive como pestaña dentro de Salud; recibe los datos de loadSalud() (d.meals, d.dietGoals, d.body, d.whoop).
import { dbPost, dbDelete, dbUpsert, callFunction } from '../db.js?v=202611051619';
import { escapeHTML, localDate, showToast, icon, openModal, closeModal } from '../util.js?v=202611051619';
import { ask, withBusy, aiLabel } from '../ia.js?v=202611051619';
import { RECIPES, SLOTS, TAGS, recipe, ideasFor } from '../recetas.js?v=202611051619';

export const DIET_GOALS = {
  kcal: { label: 'Calorías', unit: 'kcal', def: 2200 },
  protein_g: { label: 'Proteína', unit: 'g', def: 150 },
  carbs_g: { label: 'Carbohidratos', unit: 'g', def: 220 },
  fat_g: { label: 'Grasa', unit: 'g', def: 70 }
};
const MEASURES = { weight_kg: ['Peso', 'kg'], body_fat_pct: ['% grasa', '%'], waist_cm: ['Cintura', 'cm'], hip_cm: ['Cadera', 'cm'], chest_cm: ['Pecho', 'cm'], arm_cm: ['Brazo', 'cm'], thigh_cm: ['Muslo', 'cm'] };
const dgoal = (d, k) => Number(d.dietGoals.find(g => g.metric === k)?.target ?? DIET_GOALS[k].def);
const sum = (list, k) => list.reduce((s, m) => s + (Number(m[k]) || 0), 0);
const r0 = n => Math.round(Number(n) || 0);
const fmt1 = n => (Math.round((Number(n) || 0) * 10) / 10).toString();
const dayLabel = ds => new Date(ds + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', '').slice(0, 2);
const lastNDays = n => Array.from({ length: n }, (_, i) => { const x = new Date(); x.setDate(x.getDate() - (n - 1 - i)); return localDate(x); });

// ── Piezas ───────────────────────────────────────────
function macroBar(label, v, target, unit) {
  const pct = target ? Math.min(100, Math.round(v / target * 100)) : 0;
  return `<div class="mbar"><div class="mbar-top"><span>${label}</span><strong>${r0(v)}<small> / ${r0(target)} ${unit}</small></strong></div>
    <div class="bar"><div style="width:${pct}%"></div></div></div>`;
}

function todayCard(d) {
  const today = localDate();
  const meals = d.meals.filter(m => m.eaten_on === today);
  const kcal = sum(meals, 'kcal'), goal = dgoal(d, 'kcal');
  const left = goal - kcal;
  const w = d.whoop.daily.find(x => x.day === today);
  const burned = w?.kilojoule ? Math.round(Number(w.kilojoule) / 4.184) : null; // Whoop da kJ
  const pct = goal ? Math.min(100, Math.round(kcal / goal * 100)) : 0;
  return `<section class="hero" aria-label="Lo que llevas hoy">
    <div class="card-head"><span class="label">Hoy</span><button type="button" class="hero-pill hero-btn" data-dgoals>Editar metas</button></div>
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <div class="hero-num" style="font-size:44px">${r0(kcal)}<span>/${r0(goal)}</span></div><div class="hero-sub">kcal</div>
    </div>
    <div class="bar" role="progressbar" aria-label="Calorías de hoy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div style="width:${pct}%"></div></div>
    <div class="hero-sub">${left >= 0 ? `Te quedan ${r0(left)} kcal` : `Te pasaste por ${r0(-left)} kcal`}${burned ? ` · quemaste ~${burned.toLocaleString('es-MX')} kcal (Whoop)` : ''}</div>
    <div class="mbars">
      ${macroBar('Proteína', sum(meals, 'protein_g'), dgoal(d, 'protein_g'), 'g')}
      ${macroBar('Carbs', sum(meals, 'carbs_g'), dgoal(d, 'carbs_g'), 'g')}
      ${macroBar('Grasa', sum(meals, 'fat_g'), dgoal(d, 'fat_g'), 'g')}
    </div>
  </section>`;
}

function mealsCard(d) {
  const today = localDate();
  const meals = d.meals.filter(m => m.eaten_on === today);
  return `<section class="card" style="gap:4px" aria-labelledby="mealsT">
    <div class="card-head" style="padding-bottom:8px"><h2 id="mealsT">Comidas de hoy</h2><button type="button" class="btn-link" data-addmeal="">+ Agregar</button></div>
    ${Object.entries(SLOTS).map(([slot, label]) => {
      const list = meals.filter(m => m.slot === slot);
      return `<div class="mslot">
        <div class="mslot-h"><span>${label}</span>${list.length ? `<span class="small">${r0(sum(list, 'kcal'))} kcal · ${r0(sum(list, 'protein_g'))} g prot.</span>` : `<button type="button" class="btn-link" style="min-height:36px" data-addmeal="${slot}">+ ${label.toLowerCase()}</button>`}</div>
        ${list.map(m => `<div class="task" style="padding:8px 0">
          <div class="task-main"><span class="task-title" style="font-size:14px">${escapeHTML(m.name)}</span>
            <span class="task-meta">${r0(m.kcal)} kcal · P ${fmt1(m.protein_g)} · C ${fmt1(m.carbs_g)} · G ${fmt1(m.fat_g)}</span></div>
          <button type="button" class="icon-btn sm" data-delmeal="${escapeHTML(m.id)}" aria-label="Borrar ${escapeHTML(m.name)}">${icon('trash')}</button>
        </div>`).join('')}
      </div>`;
    }).join('')}
  </section>`;
}

function ideasCard(d) {
  const today = localDate();
  const meals = d.meals.filter(m => m.eaten_on === today);
  const protLeft = dgoal(d, 'protein_g') - sum(meals, 'protein_g');
  const ideas = ideasFor(today, protLeft);
  return `<section class="card" style="gap:10px" aria-labelledby="ideasT">
    <div class="card-head"><h2 id="ideasT">Ideas para hoy</h2><button type="button" class="btn-link" data-recipes>Ver recetas</button></div>
    ${protLeft > 60 ? `<div class="small">Te faltan ${r0(protLeft)} g de proteína: te sugiero opciones altas en proteína.</div>` : ''}
    <div class="ideas">${ideas.map(r => ideaTile(r)).join('')}</div>
    <button type="button" class="btn-ghost sm ai-btn" style="align-self:flex-start" data-ai-ideas>${aiLabel('Ideas a mi medida (IA)')}</button>
  </section>`;
}
const ideaTile = r => `<button type="button" class="idea" data-recipe="${escapeHTML(r.key)}">
  <span class="idea-slot">${SLOTS[r.slot]}</span>
  <span class="idea-name">${escapeHTML(r.name)}</span>
  <span class="small">${r.kcal} kcal · ${r.protein} g prot. · ${r.mins} min</span>
</button>`;

function weekCard(d) {
  const days = lastNDays(7);
  const goal = dgoal(d, 'kcal'), pgoal = dgoal(d, 'protein_g');
  const per = days.map(day => { const m = d.meals.filter(x => x.eaten_on === day); return { day, kcal: sum(m, 'kcal'), prot: sum(m, 'protein_g'), n: m.length }; });
  const logged = per.filter(x => x.n);
  if (!logged.length) return '';
  const avgK = sum(logged, 'kcal') / logged.length, avgP = sum(logged, 'prot') / logged.length;
  const max = Math.max(goal * 1.2, ...per.map(x => x.kcal), 1);
  return `<section class="card" style="gap:14px" aria-labelledby="dweekT">
    <div class="card-head"><h2 id="dweekT">Últimos 7 días</h2><span class="muted" style="font-size:13px">${logged.length} día${logged.length === 1 ? '' : 's'} registrado${logged.length === 1 ? '' : 's'}</span></div>
    <div class="stats3" style="border-top:none;padding-top:0">
      <div><span>Promedio</span><strong>${r0(avgK)} kcal</strong><small class="muted">meta ${r0(goal)}</small></div>
      <div><span>Proteína</span><strong>${r0(avgP)} g</strong><small class="muted">meta ${r0(pgoal)}</small></div>
      <div><span>En meta</span><strong>${logged.filter(x => Math.abs(x.kcal - goal) <= goal * 0.1).length} días</strong><small class="muted">±10 %</small></div>
    </div>
    <div class="bars" style="height:100px" role="img" aria-label="${escapeHTML(per.map(x => `${x.day}: ${r0(x.kcal)} kcal`).join(', '))}">
      ${per.map(x => `<div class="${x.day === localDate() ? 'cur' : ''}"><i style="height:${Math.round(x.kcal / max * 80) + 4}px;${x.kcal > goal * 1.1 ? 'background:var(--over)' : ''}"></i><span>${escapeHTML(dayLabel(x.day))}</span></div>`).join('')}
    </div>
  </section>`;
}

function bodyCard(d) {
  const rows = [...d.body].sort((a, b) => a.measured_on < b.measured_on ? -1 : 1);
  const weights = rows.filter(x => x.weight_kg != null).slice(-12);
  const last = [...rows].reverse();
  const latest = k => last.find(x => x[k] != null);
  const w = latest('weight_kg');
  const ref = weights.find(x => (new Date(w?.measured_on) - new Date(x.measured_on)) / 864e5 <= 31) || weights[0];
  const diff = w && ref && ref !== w ? Number(w.weight_kg) - Number(ref.weight_kg) : null;
  let chart = '';
  if (weights.length > 1) {
    const vals = weights.map(x => Number(x.weight_kg)), min = Math.min(...vals) - 1, max = Math.max(...vals) + 1;
    const W = 300, H = 80, step = W / (vals.length - 1);
    const pts = vals.map((v, i) => `${Math.round(i * step)},${Math.round(H - (v - min) / (max - min) * H)}`).join(' ');
    chart = `<svg class="wline" viewBox="-6 -6 ${W + 12} ${H + 12}" preserveAspectRatio="none" role="img" aria-label="Peso: ${escapeHTML(weights.map(x => `${x.measured_on} ${x.weight_kg} kg`).join(', '))}">
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      ${vals.map((v, i) => `<circle cx="${Math.round(i * step)}" cy="${Math.round(H - (v - min) / (max - min) * H)}" r="3" fill="var(--accent)" vector-effect="non-scaling-stroke"/>`).join('')}
    </svg>`;
  }
  const meas = Object.entries(MEASURES).filter(([k]) => k !== 'weight_kg').map(([k, [label, unit]]) => {
    const x = latest(k); return x ? `<div><span>${label}</span><strong>${fmt1(x[k])} ${unit}</strong></div>` : '';
  }).filter(Boolean);
  return `<section class="card" style="gap:12px" aria-labelledby="bodyT">
    <div class="card-head"><h2 id="bodyT">Peso y medidas</h2><button type="button" class="btn-link" data-measure>Registrar</button></div>
    ${w ? `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
        <div class="big" style="font-size:30px">${fmt1(w.weight_kg)} kg</div>
        ${diff != null && Math.abs(diff) >= 0.05 ? `<div style="font-size:13px;font-weight:600;color:var(--text-2)">${diff > 0 ? '+' : ''}${fmt1(diff)} kg desde ${escapeHTML(new Date(ref.measured_on + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }))}</div>` : ''}
      </div>${chart}` : '<div class="small">Registra tu peso para ver cómo cambia.</div>'}
    ${meas.length ? `<div class="stats3">${meas.join('')}</div>` : ''}
  </section>`;
}

export function comidasHTML(d) {
  if (!d.dietReady) {
    return `<section class="soon"><h1 style="font-size:22px">Falta un paso</h1><p>Para usar Comidas corre <code>v2/sql/2026-11-04-comidas.sql</code> en el SQL Editor de Supabase y vuelve a abrir esta pantalla.</p></section>`;
  }
  return `<div class="fin-grid"><div class="fin-col">${todayCard(d)}${mealsCard(d)}${weekCard(d)}</div><div class="fin-col">${ideasCard(d)}${bodyCard(d)}</div></div>`;
}

// ── Acciones ─────────────────────────────────────────
export function bindComidas(root, d, repaint) {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach(b => b.addEventListener('click', fn));
  on('[data-addmeal]', e => openMeal(d, repaint, { slot: e.currentTarget.dataset.addmeal || slotNow() }));
  on('[data-delmeal]', e => deleteMeal(d, e.currentTarget.dataset.delmeal, repaint));
  on('[data-recipe]', e => openRecipe(d, e.currentTarget.dataset.recipe, repaint));
  on('[data-recipes]', () => openRecipeBrowser(d, repaint));
  on('[data-ai-ideas]', () => openAiIdeas(d, repaint));
  on('[data-dgoals]', () => openDietGoals(d, repaint));
  on('[data-measure]', () => openMeasures(d, repaint));
}

function slotNow() { const h = new Date().getHours(); return h < 11 ? 'desayuno' : h < 17 ? 'comida' : 'cena'; }

// Recientes: nombres distintos que ya registraste (para agregar con un toque).
function recents(d) {
  const seen = new Set(), out = [];
  for (const m of [...d.meals].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    const k = m.name.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(m); if (out.length >= 8) break;
  }
  return out;
}

async function saveMeal(d, body, repaint) {
  const temp = { ...body, id: 'tmp-' + Date.now(), created_at: new Date().toISOString() };
  d.meals.unshift(temp); repaint();
  try { const [row] = await dbPost('meals', body); Object.assign(temp, row); repaint(); showToast(`${body.name} agregado`); }
  catch { d.meals = d.meals.filter(m => m !== temp); repaint(); showToast('No se pudo guardar la comida', 'error'); }
}

function openMeal(d, repaint, pre = {}) {
  const num = v => Number(String(v ?? '').replace(',', '.'));
  const rec = recents(d);
  const canDictate = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  openModal('Agregar comida', `
    <section class="ai-box" aria-labelledby="aiLbl">
      <label class="flabel" id="aiLbl" for="aiText" style="margin-top:0">Escribe o dicta lo que comiste</label>
      <div class="ai-row">
        <textarea class="field" id="aiText" rows="2" maxlength="1000" placeholder="Ej. sándwich de jamón y queso con un café con leche"></textarea>
        ${canDictate ? `<button type="button" class="icon-btn ai-mic" id="aiMic" aria-label="Dictar" aria-pressed="false">${icon('mic')}</button>` : ''}
      </div>
      ${canDictate ? '' : '<p class="small" style="margin:0">Para dictar, usa el micrófono del teclado.</p>'}
      <button type="button" class="btn-dark" id="aiGo" style="width:100%">${icon('spark')}Estimar calorías y macros</button>
      <div id="aiOut" aria-live="polite"></div>
    </section>
    <div class="ai-or"><span>o captúralo tú</span></div>
    ${rec.length ? `<span class="flabel" style="margin-top:0">Recientes</span><div class="opts">${rec.map((m, i) => `<button type="button" class="opt" data-recent="${i}">${escapeHTML(m.name)} · ${r0(m.kcal)}</button>`).join('')}</div>` : ''}
    <label class="flabel" for="mName">¿Qué comiste?</label>
    <input class="field" id="mName" maxlength="120" autocomplete="off" placeholder="Ej. 2 tacos de pollo" value="${escapeHTML(pre.name || '')}">
    <div class="row2">
      <div><label class="flabel" for="mSlot">Tiempo</label><select class="field" id="mSlot">${Object.entries(SLOTS).map(([k, v]) => `<option value="${k}"${k === pre.slot ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="flabel" for="mDay">Día</label><input class="field" id="mDay" type="date" value="${pre.day || localDate()}"></div>
    </div>
    <div class="row2">
      <div><label class="flabel" for="mKcal">Calorías</label><input class="field" id="mKcal" inputmode="numeric" value="${pre.kcal ?? ''}" placeholder="0"></div>
      <div><label class="flabel" for="mP">Proteína (g)</label><input class="field" id="mP" inputmode="decimal" value="${pre.protein ?? ''}" placeholder="0"></div>
    </div>
    <div class="row2">
      <div><label class="flabel" for="mC">Carbohidratos (g)</label><input class="field" id="mC" inputmode="decimal" value="${pre.carbs ?? ''}" placeholder="0"></div>
      <div><label class="flabel" for="mF">Grasa (g)</label><input class="field" id="mF" inputmode="decimal" value="${pre.fat ?? ''}" placeholder="0"></div>
    </div>
    <p class="small" style="margin:6px 0 0">Si solo sabes las calorías, deja los macros en 0. Si pones los macros y dejas calorías vacías, las calculo.</p>`,
    '<button type="button" class="btn-primary" id="mSave">Guardar</button>');
  bindEstimate();
  document.querySelectorAll('#modal [data-recent]').forEach(b => b.onclick = () => {
    const m = rec[Number(b.dataset.recent)];
    const set = (id, v) => { document.getElementById(id).value = v; };
    set('mName', m.name); set('mKcal', r0(m.kcal)); set('mP', fmt1(m.protein_g)); set('mC', fmt1(m.carbs_g)); set('mF', fmt1(m.fat_g));
  });
  document.getElementById('mSave').onclick = () => {
    const name = document.getElementById('mName').value.trim();
    const p = num(document.getElementById('mP').value || 0), c = num(document.getElementById('mC').value || 0), f = num(document.getElementById('mF').value || 0);
    let kcal = document.getElementById('mKcal').value.trim() === '' ? Math.round(4 * p + 4 * c + 9 * f) : num(document.getElementById('mKcal').value);
    if (!name) return showToast('Escribe qué comiste', 'error');
    if (![p, c, f, kcal].every(x => Number.isFinite(x) && x >= 0) || kcal > 10000) return showToast('Revisa los números', 'error');
    closeModal();
    saveMeal(d, { name, slot: document.getElementById('mSlot').value, eaten_on: document.getElementById('mDay').value || localDate(),
      kcal: Math.round(kcal), protein_g: p, carbs_g: c, fat_g: f, recipe_key: pre.recipe_key || null }, repaint);
  };
}

// ── Estimar con IA (función "nutricion" en Supabase) ──
function bindEstimate() {
  const $ = id => document.getElementById(id);
  const out = $('aiOut');
  let lastText = '';
  const errMsg = e => /Failed to fetch|404|Load failed/i.test(e.message) ? 'Falta publicar la función "nutricion" en Supabase.' : e.message;
  const busy = (on, label) => { $('aiGo').disabled = on; $('aiGo').innerHTML = on ? `<span class="spin" aria-hidden="true"></span>${label}` : `${icon('spark')}Estimar calorías y macros`; };

  async function run(answers) {
    const text = $('aiText').value.trim();
    if (text.length < 2) return showToast('Escribe o dicta lo que comiste', 'error');
    lastText = text;
    busy(true, answers ? 'Calculando…' : 'Pensando…');
    try {
      const r = await callFunction('nutricion', { text, answers });
      if (r.status === 'questions') renderQuestions(r.questions); else renderEstimate(r);
    } catch (e) { out.innerHTML = `<div class="error-box">${escapeHTML(errMsg(e))}</div>`; }
    finally { busy(false); }
  }

  function renderQuestions(qs) {
    out.innerHTML = `<div class="ai-qs"><p class="small" style="margin:0">Para estimarlo mejor:</p>
      ${qs.map((q, i) => `<fieldset class="ai-q" data-q="${i}"><legend>${escapeHTML(q.question)}</legend>
        <div class="opts">${q.options.map(o => `<button type="button" class="opt" data-opt="${escapeHTML(o)}" aria-pressed="false">${escapeHTML(o)}</button>`).join('')}
          <button type="button" class="opt" data-opt="" aria-pressed="false">No sé</button></div>
        <label class="sr-only" for="aiOther${i}">Otra respuesta</label><input class="field ai-other" id="aiOther${i}" placeholder="Otra (escríbela)" maxlength="120" autocomplete="off">
      </fieldset>`).join('')}
      <button type="button" class="btn-primary" id="aiCalc" style="width:100%">Calcular</button></div>`;
    out.querySelectorAll('.ai-q').forEach(fs => {
      fs.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
        fs.querySelectorAll('[data-opt]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        fs.querySelector('.ai-other').value = '';
      });
      fs.querySelector('.ai-other').oninput = () => fs.querySelectorAll('[data-opt]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    });
    $('aiCalc').onclick = () => {
      if ($('aiText').value.trim() !== lastText) return run(); // cambió la descripción: empezar de nuevo
      run(qs.map((q, i) => {
        const fs = out.querySelector(`[data-q="${i}"]`);
        const pick = fs.querySelector('[data-opt][aria-pressed="true"]');
        return { question: q.question, answer: fs.querySelector('.ai-other').value.trim() || (pick ? pick.dataset.opt : '') };
      }));
    };
  }

  function renderEstimate(r) {
    const set = (id, v) => { $(id).value = v; };
    set('mName', r.title); set('mKcal', r0(r.total.kcal)); set('mP', fmt1(r.total.protein_g)); set('mC', fmt1(r.total.carbs_g)); set('mF', fmt1(r.total.fat_g));
    out.innerHTML = `<div class="ai-est">
      <div class="ai-total"><strong>${r0(r.total.kcal)} kcal</strong><span>P ${fmt1(r.total.protein_g)} g · C ${fmt1(r.total.carbs_g)} g · G ${fmt1(r.total.fat_g)} g</span></div>
      ${r.items.map(x => `<div class="ai-item"><span>${escapeHTML(x.name)}<small>${escapeHTML(x.portion)}</small></span><span>${r0(x.kcal)} kcal</span></div>`).join('')}
      ${r.assumptions.length ? `<ul class="ai-assump">${r.assumptions.map(a => `<li>${escapeHTML(a)}</li>`).join('')}</ul>` : ''}
      <p class="small" style="margin:0">Es un estimado: ajusta abajo si quieres y toca Guardar.</p></div>`;
  }

  $('aiGo').onclick = () => run();
  $('aiText').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); });

  // Dictado con el reconocimiento de voz del navegador (Safari/Chrome), en español de México.
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('aiMic');
  if (Rec && mic) {
    let rec = null;
    mic.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new Rec(); rec.lang = 'es-MX'; rec.interimResults = true; rec.continuous = false;
      const base = $('aiText').value.trim();
      rec.onresult = e => { const t = [...e.results].map(x => x[0].transcript).join(' '); $('aiText').value = (base ? base + ' ' : '') + t; };
      rec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') showToast('No pude usar el micrófono: ' + e.error, 'error'); };
      rec.onend = () => { rec = null; mic.setAttribute('aria-pressed', 'false'); mic.classList.remove('on'); };
      try { rec.start(); mic.setAttribute('aria-pressed', 'true'); mic.classList.add('on'); } catch { rec = null; }
    };
  }
}

async function deleteMeal(d, id, repaint) {
  const m = d.meals.find(x => String(x.id) === String(id)); if (!m) return;
  const i = d.meals.indexOf(m);
  d.meals.splice(i, 1); repaint();
  if (String(m.id).startsWith('tmp-')) return;
  try { await dbDelete('meals', `?id=eq.${m.id}`); showToast('Comida borrada', 'info', { label: 'Deshacer', onClick: () => { const { id: _x, ...rest } = m; saveMeal(d, rest, repaint); } }); }
  catch { d.meals.splice(i, 0, m); repaint(); showToast('No se pudo borrar', 'error'); }
}

function openRecipe(d, key, repaint) {
  const r = recipe(key); if (!r) return;
  openModal(r.name, `
    <div class="opts" style="margin-bottom:4px"><span class="chip chip-soft">${SLOTS[r.slot]}</span><span class="chip chip-plain">${r.mins} min</span>${r.tags.map(t => `<span class="chip chip-plain">${TAGS[t]}</span>`).join('')}</div>
    <div class="stats3 four"><div><span>kcal</span><strong>${r.kcal}</strong></div><div><span>Proteína</span><strong>${r.protein} g</strong></div><div><span>Carbs</span><strong>${r.carbs} g</strong></div><div><span>Grasa</span><strong>${r.fat} g</strong></div></div>
    <span class="flabel">Ingredientes (1 porción)</span>
    <ul class="recipe-list">${r.ingredients.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ul>
    <span class="flabel">Preparación</span>
    <ol class="recipe-list">${r.steps.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ol>
    <p class="small" style="margin:4px 0 0">Macros aproximados; cambian según marcas y porciones.</p>`,
    '<button type="button" class="btn-primary" id="rAdd">Agregar a hoy</button>');
  document.getElementById('rAdd').onclick = () => {
    closeModal();
    if (!d.dietReady) return showToast('Primero corre el SQL de Comidas', 'error');
    saveMeal(d, { name: r.name, slot: r.slot, eaten_on: localDate(), kcal: r.kcal, protein_g: r.protein, carbs_g: r.carbs, fat_g: r.fat, recipe_key: r.key }, repaint);
  };
}

// Ideas con IA: 3 opciones para lo que te falta del día (la función nunca propone pescado ni mariscos).
function openAiIdeas(d, repaint) {
  const today = localDate();
  const meals = d.meals.filter(m => m.eaten_on === today);
  const remaining = {}, goals = {};
  for (const k of Object.keys(DIET_GOALS)) { goals[k] = r0(dgoal(d, k)); remaining[k] = Math.max(0, r0(dgoal(d, k) - sum(meals, k === 'kcal' ? 'kcal' : k))); }
  const recent = [...new Set(d.meals.filter(m => m.eaten_on >= lastNDays(5)[0]).map(m => m.name))].slice(0, 25);
  openModal('Ideas a tu medida', `
    <p class="small" style="margin:0">Te faltan hoy ${remaining.kcal} kcal y ${remaining.protein_g} g de proteína.</p>
    <span class="flabel">¿Para qué comida?</span>
    <div class="opts">${Object.entries(SLOTS).map(([k, v]) => `<button type="button" class="opt" data-islot="${k}" aria-pressed="${k === slotNow()}">${v}</button>`).join('')}</div>
    <button type="button" class="btn-dark ai-btn" id="iaGo" style="width:100%;margin-top:8px">${aiLabel('Darme 3 ideas')}</button>
    <div id="iaOut" aria-live="polite"></div>`);
  let slot = slotNow(), ideas = [];
  document.querySelectorAll('#modal [data-islot]').forEach(b => b.onclick = () => { slot = b.dataset.islot; document.querySelectorAll('#modal [data-islot]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  document.getElementById('iaGo').onclick = async e => {
    try {
      const res = await withBusy(e.currentTarget, 'Pensando…', () => ask('ideas', { slot, remaining, goals, recent }));
      ideas = res.ideas || [];
      document.getElementById('iaOut').innerHTML = `<div class="ia-list">${ideas.map((x, i) => `<details class="ia-idea">
        <summary><span class="idea-name">${escapeHTML(x.name)}</span><span class="small">${r0(x.kcal)} kcal · ${fmt1(x.protein_g)} g prot. · ${x.mins} min</span><span class="small" style="color:var(--accent)">${escapeHTML(x.why)}</span></summary>
        <span class="flabel">Ingredientes</span><ul class="recipe-list">${(x.ingredients || []).map(y => `<li>${escapeHTML(y)}</li>`).join('')}</ul>
        <span class="flabel">Preparación</span><ol class="recipe-list">${(x.steps || []).map(y => `<li>${escapeHTML(y)}</li>`).join('')}</ol>
        <button type="button" class="btn-primary sm" style="margin-top:8px" data-iadd="${i}">Agregar a hoy</button>
      </details>`).join('')}</div>`;
      document.querySelectorAll('#modal [data-iadd]').forEach(b => b.onclick = () => {
        const x = ideas[Number(b.dataset.iadd)];
        if (!d.dietReady) return showToast('Primero corre el SQL de Comidas', 'error');
        closeModal();
        saveMeal(d, { name: x.name.slice(0, 120), slot: SLOTS[x.slot] ? x.slot : slot, eaten_on: localDate(), kcal: r0(x.kcal), protein_g: Number(fmt1(x.protein_g)), carbs_g: Number(fmt1(x.carbs_g)), fat_g: Number(fmt1(x.fat_g)), recipe_key: null }, repaint);
      });
    } catch (err) { showToast(err.message, 'error'); }
  };
}

function openRecipeBrowser(d, repaint) {
  let slot = '', tag = '';
  const list = () => RECIPES.filter(r => (!slot || r.slot === slot) && (!tag || r.tags.includes(tag)));
  const render = () => {
    const body = document.querySelector('#modal .modal-body');
    body.innerHTML = `
      <div class="opts">${[['', 'Todas'], ...Object.entries(SLOTS)].map(([k, v]) => `<button type="button" class="opt" data-fslot="${k}" aria-pressed="${slot === k}">${v}</button>`).join('')}</div>
      <div class="opts">${Object.entries(TAGS).map(([k, v]) => `<button type="button" class="opt" data-ftag="${k}" aria-pressed="${tag === k}">${v}</button>`).join('')}</div>
      <div class="ideas" style="margin-top:6px">${list().map(ideaTile).join('') || '<div class="small">Ninguna receta con esos filtros.</div>'}</div>`;
    body.querySelectorAll('[data-fslot]').forEach(b => b.onclick = () => { slot = b.dataset.fslot; render(); });
    body.querySelectorAll('[data-ftag]').forEach(b => b.onclick = () => { tag = tag === b.dataset.ftag ? '' : b.dataset.ftag; render(); });
    body.querySelectorAll('[data-recipe]').forEach(b => b.onclick = () => openRecipe(d, b.dataset.recipe, repaint));
  };
  openModal('Recetas saludables', '');
  render();
}

function openDietGoals(d, repaint) {
  openModal('Metas de dieta (diarias)', Object.entries(DIET_GOALS).map(([k, g]) => `
    <label class="flabel" for="dg_${k}">${g.label} (${g.unit})</label>
    <input class="field" id="dg_${k}" inputmode="numeric" autocomplete="off" value="${r0(dgoal(d, k))}">`).join('')
    + '<p class="small" style="margin:6px 0 0">Una referencia común: proteína de 1.6–2.2 g por kg de peso. Si tienes nutriólogo, usa sus números.</p>',
    '<button type="button" class="btn-primary" id="dgSave">Guardar metas</button>');
  document.getElementById('dgSave').onclick = async () => {
    const rows = [];
    for (const k of Object.keys(DIET_GOALS)) {
      const v = Number(String(document.getElementById('dg_' + k).value).replace(',', '.'));
      if (!(v >= 0)) return showToast('Revisa las metas: deben ser números', 'error');
      rows.push({ metric: k, target: v, updated_at: new Date().toISOString() });
    }
    closeModal();
    const prev = d.dietGoals; d.dietGoals = rows; repaint();
    try { await dbUpsert('diet_goals', rows, 'user_id,metric'); showToast('Metas guardadas'); }
    catch { d.dietGoals = prev; repaint(); showToast('No se pudieron guardar las metas', 'error'); }
  };
}

// Registrar peso y medidas del día (todas opcionales). También lo usa Ejercicio › "Registrar".
export function openMeasures(d, repaint) {
  const today = localDate();
  const row = d.body.find(x => x.measured_on === today) || {};
  const last = [...d.body].sort((a, b) => a.measured_on < b.measured_on ? 1 : -1);
  const ph = k => last.find(x => x[k] != null)?.[k] ?? '';
  openModal('Peso y medidas', `
    <label class="flabel" for="msDate" style="margin-top:0">Fecha</label>
    <input class="field" id="msDate" type="date" value="${today}">
    ${Object.entries(MEASURES).map(([k, [label, unit]], i) => `${i % 2 === 0 ? '<div class="row2">' : ''}
      <div><label class="flabel" for="ms_${k}">${label} (${unit})</label><input class="field" id="ms_${k}" inputmode="decimal" autocomplete="off" value="${row[k] ?? ''}" placeholder="${ph(k) !== '' ? fmt1(ph(k)) : ''}"></div>
    ${i % 2 === 1 || i === Object.keys(MEASURES).length - 1 ? '</div>' : ''}`).join('')}
    <p class="small" style="margin:6px 0 0">Llena solo lo que mediste. El número gris es tu última medida.</p>`,
    '<button type="button" class="btn-primary" id="msSave">Guardar</button>');
  document.getElementById('msSave').onclick = async () => {
    const day = document.getElementById('msDate').value || today;
    const body = { measured_on: day };
    for (const k of Object.keys(MEASURES)) {
      const raw = document.getElementById('ms_' + k).value.trim();
      if (raw === '') continue;
      const v = Number(raw.replace(',', '.'));
      const max = k === 'body_fat_pct' ? 80 : k === 'weight_kg' ? 400 : 300;
      if (!(v > 0 && v <= max)) return showToast(`Revisa ${MEASURES[k][0].toLowerCase()}`, 'error');
      body[k] = v;
    }
    if (Object.keys(body).length === 1) return showToast('Escribe al menos una medida', 'error');
    closeModal();
    const prev = d.body;
    const old = d.body.find(x => x.measured_on === day);
    d.body = [{ ...(old || {}), ...body }, ...d.body.filter(x => x.measured_on !== day)];
    repaint();
    try { await dbUpsert('body_metrics', body, 'user_id,measured_on'); showToast('Medidas guardadas'); }
    catch (e) {
      d.body = prev; repaint();
      showToast(/hip_cm|chest_cm|arm_cm|thigh_cm/.test(e.message) ? 'Falta correr el SQL de Comidas (medidas nuevas)' : 'No se pudo guardar', 'error');
    }
  };
}
