// Notas (tabla notes: title opcional, content). Mosaico de 2 columnas (1 en móvil) con edición en el lugar,
// como en la clásica: cada nota recuerda su columna para no brincar al editar; ⌘/Ctrl+Enter guarda, Esc cancela.
import { dbPost, dbPatch, dbDelete, safeGet } from '../db.js?v=202611051626';
import { escapeHTML, showToast, icon } from '../util.js?v=202611051626';

let notes = [], editing = null, search = '';
let root = null;
let colOf = new Map(), colCount = 0;

export async function show(el, isCurrent = () => true) {
  const rows = await safeGet('notes', '?order=created_at.desc');
  if (!isCurrent()) return;
  root = el; notes = rows || []; editing = null; search = '';
  paint();
}

const autosize = ta => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

function card(n) {
  if (editing === n.id) {
    return `<div class="card note editing" data-note="${escapeHTML(n.id)}">
      <label class="sr-only" for="enTitle">Título</label><input class="note-title-in" id="enTitle" placeholder="Título (opcional)" value="${escapeHTML(n.title || '')}" maxlength="120">
      <label class="sr-only" for="enText">Nota</label><textarea class="note-text-in" id="enText" rows="2">${escapeHTML(n.content)}</textarea>
      <div class="card-head"><span class="small">⌘/Ctrl + Enter para guardar</span>
        <span style="display:flex;gap:8px"><button type="button" class="btn-ghost sm" data-ncancel>Cancelar</button><button type="button" class="btn-primary sm" data-nsave>Guardar</button></span></div>
    </div>`;
  }
  const d = new Date(n.created_at);
  const when = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '') + ' · ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return `<div class="card note" data-note="${escapeHTML(n.id)}">
    ${n.title ? `<h2 style="font-size:16px;overflow-wrap:anywhere">${escapeHTML(n.title)}</h2>` : ''}
    <div class="note-text">${escapeHTML(n.content)}</div>
    <div class="card-head"><span class="small">${escapeHTML(when)}</span>
      <span style="display:flex;gap:4px"><button type="button" class="icon-btn sm" data-nedit aria-label="Editar nota">${icon('edit')}</button><button type="button" class="icon-btn sm" data-ndel aria-label="Eliminar nota">${icon('trash')}</button></span></div>
  </div>`;
}

function layout() {
  const wrap = root.querySelector('#ncols'); if (!wrap) return;
  const count = window.innerWidth < 900 ? 1 : 2;
  if (count !== colCount) { colOf = new Map(); colCount = count; }
  const shown = search ? notes.filter(n => ((n.title || '') + ' ' + n.content).toLowerCase().includes(search)) : notes;
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
}

function paint() {
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center"><h1 class="hello" style="margin:0">Notas</h1></header>
    <section class="card" style="gap:8px">
      <label class="sr-only" for="nTitle">Título</label><input class="field" id="nTitle" placeholder="Título (opcional)" maxlength="120" autocomplete="off">
      <label class="sr-only" for="nText">Nota</label><textarea class="field note-new" id="nText" placeholder="Escribe una nota…" rows="3"></textarea>
      <div style="display:flex;justify-content:flex-end"><button type="button" class="btn-primary" style="padding:0 18px" data-nadd>Guardar nota</button></div>
    </section>
    ${notes.length > 3 ? `<label class="sr-only" for="nSearch">Buscar notas</label><input class="field" id="nSearch" type="search" placeholder="Buscar en notas…" value="${escapeHTML(search)}" autocomplete="off">` : ''}
    <div class="ncols" id="ncols"></div>
  </div>`;
  layout();
  bind();
}
const again = () => { if (root && document.body.contains(root)) paint(); };

function bind() {
  root.querySelector('[data-nadd]').onclick = add;
  const s = root.querySelector('#nSearch');
  if (s) s.oninput = () => { search = s.value.trim().toLowerCase(); layout(); bindCards(); };
  bindCards();
}
function bindCards() {
  root.querySelectorAll('[data-note]').forEach(el => {
    const n = notes.find(x => String(x.id) === el.dataset.note);
    el.querySelector('[data-nedit]')?.addEventListener('click', () => { editing = n.id; paint(); });
    el.querySelector('[data-ndel]')?.addEventListener('click', () => del(n));
    el.querySelector('[data-ncancel]')?.addEventListener('click', () => { editing = null; paint(); });
    el.querySelector('[data-nsave]')?.addEventListener('click', () => save(n));
  });
  const ta = root.querySelector('#enText');
  if (ta) {
    autosize(ta); ta.addEventListener('input', () => autosize(ta));
    const keys = e => { if (e.key === 'Escape') { editing = null; paint(); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(notes.find(x => x.id === editing)); };
    ta.addEventListener('keydown', keys); root.querySelector('#enTitle').addEventListener('keydown', keys);
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

async function add() {
  const title = root.querySelector('#nTitle').value.trim() || null;
  const content = root.querySelector('#nText').value.trim();
  if (!content) return showToast('Escribe la nota', 'error');
  try { const [n] = await dbPost('notes', { title, content }); notes.unshift(n); paint(); showToast('Nota guardada'); }
  catch { showToast('No se pudo guardar la nota', 'error'); }
}
async function save(n) {
  const title = root.querySelector('#enTitle').value.trim() || null;
  const content = root.querySelector('#enText').value.trim();
  if (!content) return showToast('La nota no puede quedar vacía', 'error');
  const prev = { title: n.title, content: n.content };
  Object.assign(n, { title, content }); editing = null; paint();
  try { await dbPatch('notes', { title, content }, `?id=eq.${n.id}`); }
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
