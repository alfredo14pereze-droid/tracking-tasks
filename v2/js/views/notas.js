// Notas (tabla notes: title opcional, content). Mosaico de 2 columnas (1 en móvil) con edición en el lugar,
// como en la clásica: cada nota recuerda su columna para no brincar al editar; ⌘/Ctrl+Enter guarda, Esc cancela.
import { dbPost, dbPatch, dbDelete, safeGet } from '../db.js?v=202611051834';
import { escapeHTML, showToast, icon } from '../util.js?v=202611051834';
import { uploadPhotos, removePhotos, fillPhotos, thumbsHTML, photoButton } from '../fotos.js?v=202611051834';

let notes = [], editing = null, search = '';
let pending = [];          // fotos elegidas para la nota nueva (File)
let editPhotos = null;     // { keep: [rutas], add: [File] } mientras editas
let root = null;
let colOf = new Map(), colCount = 0;

export async function show(el, isCurrent = () => true) {
  const rows = await safeGet('notes', '?order=created_at.desc');
  if (!isCurrent()) return;
  root = el; notes = rows || []; editing = null; search = ''; pending = [];
  paint();
}

const autosize = ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

function card(n) {
  if (editing === n.id) {
    return `<div class="card note editing" data-note="${escapeHTML(n.id)}">
      <label class="sr-only" for="enTitle">Título</label><input class="note-title-in" id="enTitle" placeholder="Título (para encontrarla después)" value="${escapeHTML(n.title || '')}" maxlength="120">
      <label class="sr-only" for="enText">Nota</label><textarea class="note-text-in" id="enText" rows="2">${escapeHTML(n.content || '')}</textarea>
      ${thumbsHTML(editPhotos.keep, { removable: true })}
      ${editPhotos.add.length ? `<div class="small">${editPhotos.add.length} foto${editPhotos.add.length === 1 ? '' : 's'} nueva${editPhotos.add.length === 1 ? '' : 's'} por subir</div>` : ''}
      <div style="display:flex">${photoButton('enPhoto')}</div>
      <div class="card-head"><span class="small">⌘/Ctrl + Enter para guardar</span>
        <span style="display:flex;gap:8px"><button type="button" class="btn-ghost sm" data-ncancel>Cancelar</button><button type="button" class="btn-primary sm" data-nsave>Guardar</button></span></div>
    </div>`;
  }
  const d = new Date(n.created_at);
  const when = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '') + ' · ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return `<div class="card note" data-note="${escapeHTML(n.id)}">
    ${n.title ? `<h2 style="font-size:16px;overflow-wrap:anywhere">${escapeHTML(n.title)}</h2>` : ''}
    ${n.content ? `<div class="note-text">${escapeHTML(n.content)}</div>` : ''}
    ${thumbsHTML(n.images)}
    <div class="card-head"><span class="small">${escapeHTML(when)}</span>
      <span style="display:flex;gap:4px"><button type="button" class="icon-btn sm" data-nedit aria-label="Editar nota o cambiarle el título" title="Editar o cambiar título">${icon('edit')}</button><button type="button" class="icon-btn sm" data-ndel aria-label="Eliminar nota">${icon('trash')}</button></span></div>
  </div>`;
}

function layout() {
  const wrap = root.querySelector('#ncols'); if (!wrap) return;
  const count = window.innerWidth < 900 ? 1 : 2;
  if (count !== colCount) { colOf = new Map(); colCount = count; }
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const shown = search ? notes.filter(n => norm((n.title || '') + ' ' + (n.content || '')).includes(norm(search))) : notes;
  wrap.innerHTML = Array.from({ length: count }, () => '<div class="ncol"></div>').join('');
  const cols = [...wrap.children];
  const put = (n, col, top) => { const t = document.createElement('template'); t.innerHTML = card(n).trim(); top ? col.prepend(t.content.firstChild) : col.appendChild(t.content.firstChild); };
  const initial = colOf.size === 0;
  shown.filter(n => colOf.has(n.id)).forEach(n => put(n, cols[colOf.get(n.id)] || cols[0]));
  const fresh = shown.filter(n => !colOf.has(n.id));
  (initial ? fresh : fresh.reverse()).forEach(n => {
    let best = 0; cols.forEach((c, i) => { if (c.offsetHeight < cols[best].offsetHeight) best = i; });
    colOf.set(n.id, best); put(n, cols[best], !initial);
  });
  if (!shown.length) wrap.innerHTML = `<div class="card"><div class="small">${search ? 'Ninguna nota coincide.' : 'Sin notas todavía.'}</div></div>`;
  fillPhotos(wrap);
}

function paint() {
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center"><h1 class="hello" style="margin:0">Notas</h1></header>
    <section class="card" style="gap:8px">
      <label class="sr-only" for="nTitle">Título</label><input class="field" id="nTitle" placeholder="Título (opcional)" maxlength="120" autocomplete="off">
      <label class="sr-only" for="nText">Nota</label><textarea class="field note-new" id="nText" placeholder="Escribe una nota…" rows="3"></textarea>
      ${pending.length ? `<div class="thumbs">${pending.map((f, i) => `<span class="thumb"><span class="thumb-img"><img src="${escapeHTML(f._url)}" alt=""></span><button type="button" class="thumb-x" data-pend-x="${i}" aria-label="Quitar foto">${icon('x')}</button></span>`).join('')}</div>` : ''}
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">${photoButton('nPhoto')}<button type="button" class="btn-primary" style="padding:0 18px" data-nadd>Guardar nota</button></div>
    </section>
    <label class="sr-only" for="nSearch">Buscar notas</label><input class="field" id="nSearch" type="search" placeholder="🔎 Buscar en tus notas…" value="${escapeHTML(search)}" autocomplete="off">
    <div class="ncols" id="ncols"></div>
  </div>`;
  layout();
  bind();
}
const again = () => { if (root && document.body.contains(root)) paint(); };

function bind() {
  root.querySelector('[data-nadd]').onclick = add;
  const keepDraft = () => ({ t: root.querySelector('#nTitle').value, x: root.querySelector('#nText').value });
  const restore = d => { root.querySelector('#nTitle').value = d.t; root.querySelector('#nText').value = d.x; };
  root.querySelector('#nPhoto').onchange = e => {
    const d = keepDraft();
    for (const f of e.target.files) { f._url = URL.createObjectURL(f); pending.push(f); }
    paint(); restore(d);
  };
  root.querySelectorAll('[data-pend-x]').forEach(b => b.onclick = () => { const d = keepDraft(); pending.splice(Number(b.dataset.pendX), 1); paint(); restore(d); });
  const s = root.querySelector('#nSearch');
  if (s) s.oninput = () => { search = s.value.trim().toLowerCase(); layout(); bindCards(); };
  bindCards();
}
function bindCards() {
  root.querySelectorAll('[data-note]').forEach(el => {
    const n = notes.find(x => String(x.id) === el.dataset.note);
    el.querySelector('[data-nedit]')?.addEventListener('click', () => { editing = n.id; editPhotos = { keep: [...(n.images || [])], add: [] }; paint(); });
    el.querySelector('[data-ndel]')?.addEventListener('click', () => del(n));
    el.querySelector('[data-ncancel]')?.addEventListener('click', () => { editing = null; editPhotos = null; paint(); });
    el.querySelector('[data-nsave]')?.addEventListener('click', () => save(n));
  });
  const ta = root.querySelector('#enText');
  if (ta) {
    const keepE = () => ({ t: root.querySelector('#enTitle').value, x: ta.value });
    const restoreE = d => { root.querySelector('#enTitle').value = d.t; root.querySelector('#enText').value = d.x; };
    root.querySelector('#enPhoto').onchange = e => { const d = keepE(); editPhotos.add.push(...e.target.files); paint(); restoreE(d); };
    root.querySelectorAll('[data-photo-remove]').forEach(b => b.onclick = e => { e.stopPropagation(); const d = keepE(); editPhotos.keep = editPhotos.keep.filter(p => p !== b.dataset.photoRemove); paint(); restoreE(d); });
    autosize(ta); ta.addEventListener('input', () => autosize(ta));
    const keys = e => { if (e.key === 'Escape') { editing = null; editPhotos = null; paint(); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(notes.find(x => x.id === editing)); };
    ta.addEventListener('keydown', keys); root.querySelector('#enTitle').addEventListener('keydown', keys);
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

async function add() {
  const title = root.querySelector('#nTitle').value.trim() || null;
  const content = root.querySelector('#nText').value.trim();
  if (!content && !pending.length) return showToast('Escribe la nota o agrega una foto', 'error');
  const btn = root.querySelector('[data-nadd]'); btn.disabled = true; btn.textContent = pending.length ? 'Subiendo fotos…' : 'Guardando…';
  try {
    const images = pending.length ? await uploadPhotos(pending) : [];
    const [n] = await dbPost('notes', images.length ? { title, content: content || null, images } : { title, content: content || null });
    pending.forEach(f => URL.revokeObjectURL(f._url)); pending = [];
    notes.unshift(n); paint(); showToast('Nota guardada');
  } catch (e) { btn.disabled = false; btn.textContent = 'Guardar nota'; showToast(/Falta correr/.test(e.message) ? e.message : 'No se pudo guardar la nota', 'error'); }
}
async function save(n) {
  const title = root.querySelector('#enTitle').value.trim() || null;
  const content = root.querySelector('#enText').value.trim() || null;
  const ep = editPhotos || { keep: n.images || [], add: [] };
  if (!content && !ep.keep.length && !ep.add.length) return showToast('La nota no puede quedar vacía', 'error');
  let added = [];
  if (ep.add.length) {
    const b = root.querySelector('[data-nsave]'); if (b) { b.disabled = true; b.textContent = 'Subiendo…'; }
    try { added = await uploadPhotos(ep.add); }
    catch (e) { if (b) { b.disabled = false; b.textContent = 'Guardar'; } return showToast(/Falta correr/.test(e.message) ? e.message : 'No se pudieron subir las fotos', 'error'); }
  }
  const images = [...ep.keep, ...added];
  const removed = (n.images || []).filter(p => !images.includes(p));
  const body = (n.images || images.length) ? { title, content, images } : { title, content };
  const prev = { title: n.title, content: n.content, images: n.images };
  Object.assign(n, body); editing = null; editPhotos = null; paint();
  try { await dbPatch('notes', body, `?id=eq.${n.id}`); removePhotos(removed).catch(() => {}); }
  catch { Object.assign(n, prev); again(); showToast('No se pudo actualizar la nota', 'error'); }
}
async function del(n) {
  const i = notes.indexOf(n);
  notes.splice(i, 1); paint();
  try {
    await dbDelete('notes', `?id=eq.${n.id}`);
    showToast('Nota eliminada', 'info', { label: 'Deshacer', onClick: async () => {
      const { id, ...rest } = n;
      try { const [r] = await dbPost('notes', rest); notes.splice(Math.min(i, notes.length), 0, r); again(); } catch { showToast('No se pudo restaurar', 'error'); }
    } });
  } catch { notes.splice(i, 0, n); again(); showToast('No se pudo eliminar', 'error'); }
}

window.addEventListener('resize', () => {
  if (root && document.body.contains(root) && root.querySelector('#ncols') && !editing && (window.innerWidth < 900 ? 1 : 2) !== colCount) layout(), bindCards();
});
