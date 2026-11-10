// Fotos para Notas y Recordatorios: se guardan en el bucket privado "adjuntos" de Supabase,
// dentro de la carpeta del usuario (adjuntos/<user id>/…). Se achican antes de subir (máx. 1600 px, JPEG)
// para ahorrar espacio y datos. Para verlas se piden URLs firmadas que duran 1 hora.
import { sb, AuthError } from './db.js?v=202611100956';
import { escapeHTML, openModal, icon } from './util.js?v=202611100956';

const BUCKET = 'adjuntos';
const MAX = 1600;
const urlCache = new Map(); // ruta → { url, until }

async function uid() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new AuthError('Sesión expirada');
  return session.user.id;
}

// Achica la foto (si el navegador puede leerla); si no, sube el archivo tal cual.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.type === 'image/jpeg' && file.size < 900 * 1024) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
    return blob || file;
  } catch { return file; }
}

// Sube varias fotos y regresa sus rutas.
export async function uploadPhotos(files) {
  const me = await uid(), out = [];
  for (const f of files) {
    const blob = await shrink(f);
    const ext = blob.type === 'image/jpeg' ? 'jpg' : (f.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${me}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || f.type || 'image/jpeg', upsert: false });
    if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Falta correr v2/sql/2026-11-05-fotos.sql en Supabase' : error.message);
    out.push(path);
  }
  return out;
}

export async function removePhotos(paths) {
  if (!paths?.length) return;
  await sb.storage.from(BUCKET).remove(paths);
  paths.forEach(p => urlCache.delete(p));
}

export async function signedUrls(paths) {
  const now = Date.now(), need = paths.filter(p => !(urlCache.get(p)?.until > now + 60000));
  if (need.length) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need, 3600);
    (data || []).forEach(x => { if (x.signedUrl) urlCache.set(x.path, { url: x.signedUrl, until: now + 3600 * 1000 }); });
  }
  return paths.map(p => urlCache.get(p)?.url || '');
}

// Miniaturas: pinta los <img data-photo="ruta"> que haya dentro de el.
export async function fillPhotos(el) {
  const imgs = [...el.querySelectorAll('img[data-photo]')].filter(i => !i.src);
  if (!imgs.length) return;
  try {
    const urls = await signedUrls([...new Set(imgs.map(i => i.dataset.photo))]);
    const map = new Map([...new Set(imgs.map(i => i.dataset.photo))].map((p, i) => [p, urls[i]]));
    imgs.forEach(i => { const u = map.get(i.dataset.photo); if (u) i.src = u; });
  } catch { /* sin conexión: se quedan vacías */ }
  el.querySelectorAll('[data-photo-open]').forEach(b => b.onclick = e => { e.stopPropagation(); openPhoto(b.dataset.photoOpen); });
}

// small: miniaturas chiquitas sin botón (para ponerlas dentro de otro botón, p. ej. la fila de un recordatorio).
export function thumbsHTML(paths, { removable = false, small = false } = {}) {
  if (!paths?.length) return '';
  if (small) return `<span class="thumbs sm">${paths.map(p => `<span class="thumb"><span class="thumb-img"><img data-photo="${escapeHTML(p)}" alt="" loading="lazy"></span></span>`).join('')}</span>`;
  return `<div class="thumbs">${paths.map(p => `<span class="thumb">
    <button type="button" class="thumb-img" data-photo-open="${escapeHTML(p)}" aria-label="Ver foto"><img data-photo="${escapeHTML(p)}" alt="" loading="lazy"></button>
    ${removable ? `<button type="button" class="thumb-x" data-photo-remove="${escapeHTML(p)}" aria-label="Quitar foto">${icon('x')}</button>` : ''}
  </span>`).join('')}</div>`;
}

async function openPhoto(path) {
  const [url] = await signedUrls([path]);
  openModal('Foto', `<img src="${escapeHTML(url)}" alt="" style="width:100%;height:auto;border-radius:16px;display:block">
    <a class="btn-link" href="${escapeHTML(url)}" target="_blank" rel="noopener" style="align-self:flex-start;margin-top:8px">Abrir en grande</a>`);
}

// Botón de cámara/galería: abre el selector y llama onPick(files).
export function photoButton(id) {
  return `<label class="btn-ghost sm photo-btn" for="${id}">${icon('camera')}Foto<input type="file" id="${id}" accept="image/*" multiple hidden></label>`;
}
