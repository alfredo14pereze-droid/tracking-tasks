// Notificaciones push: activar en este dispositivo, escoger qué avisos y mandar una prueba.
// En iPhone solo funciona con la app instalada en la pantalla de inicio (iOS 16.4+).
// La llave pública VAPID va aquí (es pública por diseño); la privada vive en los secrets de Supabase.
import { dbGet, dbPost, dbDelete, dbUpsert, callFunction } from '../db.js?v=202611051834';
import { escapeHTML, showToast, icon } from '../util.js?v=202611051834';

const VAPID_PUBLIC = 'BGBq0xMkvm588dD4XU1ZtF64jrL0KYyK0RyoB3jwS91slP-bkMA3v8Sb7CDIalEeKjU_YeXIRNnP_cumRwkaaJ8';
const OPTS = [
  ['reminders', 'Recordatorios', 'A la hora que les pusiste.'],
  ['tasks', 'Tareas con hora', '10 minutos antes.'],
  ['cards', 'Pago de tarjetas', '3 días y 1 día antes, a las 9:00, con cuánto pagar.'],
  ['morning', 'Resumen de la mañana', 'Tareas, recordatorios y qué entreno toca.']
];

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64ToBytes = s => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };

let root = null, st = { prefs: null, sub: null, devices: 0, missing: false };

export async function show(el, isCurrent = () => true) {
  root = el;
  let prefs = null, devices = [], missing = false;
  try { [prefs] = await dbGet('push_prefs', ''); devices = await dbGet('push_subscriptions', '?select=id,device,endpoint,created_at'); }
  catch { missing = true; }
  let sub = null;
  if (supported()) { try { const reg = await navigator.serviceWorker.getRegistration('../'); sub = reg ? await reg.pushManager.getSubscription() : null; } catch { /* sin SW */ } }
  if (!isCurrent()) return;
  st = { prefs: prefs || { reminders: true, tasks: true, cards: true, morning: true, morning_time: '08:00:00' }, sub, devices, missing };
  paint();
}

function statusHTML() {
  if (st.missing) return `<div class="error-box">Falta correr <code>v2/sql/2026-11-05-notificaciones.sql</code> en Supabase.</div>`;
  if (isIOS && !standalone()) return `<p class="small" style="margin:0">En iPhone las notificaciones solo funcionan desde la app instalada. Abre TaskTracker desde el ícono de tu pantalla de inicio y entra aquí otra vez.</p>`;
  if (!supported()) return `<p class="small" style="margin:0">Este navegador no permite notificaciones push.</p>`;
  if (Notification.permission === 'denied') return `<p class="small" style="margin:0;color:var(--alert)">Las bloqueaste. En el iPhone: Ajustes › Notificaciones › TaskTracker › Permitir notificaciones. Luego vuelve aquí.</p>`;
  const here = !!(st.sub && st.devices.some(d => d.endpoint === st.sub.endpoint));
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
    ${here ? `<span class="chip chip-soft">Activas en este dispositivo</span>
      <button type="button" class="btn-ghost sm" data-test>Mandar prueba</button>
      <button type="button" class="btn-link" style="color:var(--alert)" data-off>Desactivar aquí</button>`
    : `<button type="button" class="btn-primary" data-on>${icon('bell')}Activar en este dispositivo</button>`}
  </div>
  ${st.devices.length ? `<p class="small" style="margin:6px 0 0">${st.devices.length} dispositivo${st.devices.length === 1 ? '' : 's'} recibiendo avisos.</p>` : ''}`;
}

function paint() {
  const p = st.prefs;
  root.innerHTML = `<div class="page">
    <header class="head" style="align-items:center"><h1 class="hello" style="margin:0">Notificaciones</h1></header>
    <section class="card" style="gap:10px">${statusHTML()}</section>
    ${st.missing ? '' : `<section class="card" aria-labelledby="nT" style="gap:4px">
      <h2 id="nT" style="font-size:16px;font-weight:600;padding-bottom:8px">¿Qué quieres que te avise?</h2>
      ${OPTS.map(([k, t, sub]) => `<label class="notif-opt"><span class="task-main"><span class="task-title">${escapeHTML(t)}</span><span class="task-meta">${escapeHTML(sub)}</span></span>
        <input type="checkbox" class="switch" data-pref="${k}"${p[k] ? ' checked' : ''}></label>`).join('')}
      <label class="notif-opt"><span class="task-main"><span class="task-title">Hora del resumen</span></span>
        <input class="field" type="time" data-mtime value="${escapeHTML(String(p.morning_time || '08:00').slice(0, 5))}" style="width:auto;height:42px"></label>
    </section>
    <p class="small" style="margin:0 4px">Los avisos se revisan cada 5 minutos, así que pueden llegar con unos minutos de diferencia.</p>`}
  </div>`;
  root.querySelector('[data-on]')?.addEventListener('click', turnOn);
  root.querySelector('[data-off]')?.addEventListener('click', turnOff);
  root.querySelector('[data-test]')?.addEventListener('click', test);
  root.querySelectorAll('[data-pref]').forEach(c => c.onchange = () => savePrefs({ [c.dataset.pref]: c.checked }));
  root.querySelector('[data-mtime]')?.addEventListener('change', e => { if (e.target.value) savePrefs({ morning_time: e.target.value }); });
}

async function savePrefs(change) {
  const prev = { ...st.prefs };
  Object.assign(st.prefs, change);
  try { const [row] = await dbUpsert('push_prefs', { ...pick(st.prefs), updated_at: new Date().toISOString() }, 'user_id'); if (row) st.prefs = row; showToast('Guardado'); }
  catch { st.prefs = prev; paint(); showToast('No se pudo guardar', 'error'); }
}
const pick = p => ({ reminders: !!p.reminders, tasks: !!p.tasks, cards: !!p.cards, morning: !!p.morning, morning_time: String(p.morning_time || '08:00').slice(0, 5) });

async function turnOn(e) {
  const btn = e.currentTarget; btn.disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { btn.disabled = false; return showToast('Sin permiso no te puedo avisar', 'error'); }
    const reg = await navigator.serviceWorker.register('../service-worker.js', { scope: '../' });
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
    const j = sub.toJSON();
    await dbUpsert('push_subscriptions', { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: isIOS ? 'iPhone' : navigator.platform || 'web' }, 'endpoint');
    if (!st.prefs.user_id) await savePrefs({});
    showToast('Notificaciones activadas'); await show(root);
  } catch (err) { btn.disabled = false; showToast('No se pudieron activar: ' + (err.message || err), 'error'); }
}

async function turnOff() {
  try {
    if (st.sub) { await dbDelete('push_subscriptions', `?endpoint=eq.${encodeURIComponent(st.sub.endpoint)}`); await st.sub.unsubscribe(); }
    showToast('Desactivadas en este dispositivo'); await show(root);
  } catch { showToast('No se pudo desactivar', 'error'); }
}

async function test(e) {
  const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Enviando…';
  try { const r = await callFunction('notificaciones', { mode: 'test' }); showToast(r.sent ? 'Listo: revisa tu notificación' : 'No llegó a ningún dispositivo', r.sent ? 'info' : 'error'); }
  catch (err) { showToast(/404|Failed|Load failed/i.test(err.message) ? 'Falta publicar la función "notificaciones" en Supabase' : err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Mandar prueba'; }
}
