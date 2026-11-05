// Ayudante para la función "asistente" (Claude) en Supabase. Cada llamada la dispara un botón; nada corre solo.
import { callFunction } from './db.js?v=202611051626';
import { icon } from './util.js?v=202611051626';

export async function ask(action, payload) {
  try { return await callFunction('asistente', { action, ...payload }); }
  catch (e) {
    if (/Failed to fetch|Load failed|404|not found/i.test(e.message)) throw new Error('Falta publicar la función "asistente" en Supabase.');
    throw e;
  }
}

// Pone un botón en modo "pensando" mientras corre fn; regresa lo que regrese fn.
export async function withBusy(btn, label, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${label}`;
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = html; }
}

export const aiLabel = text => `${icon('spark')}${text}`;

// Caché local (por navegador) para no volver a pagar la misma respuesta.
export const cache = {
  get(k) { try { return JSON.parse(localStorage.getItem('v2ai:' + k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('v2ai:' + k, JSON.stringify({ at: new Date().toISOString(), v })); } catch { /* sin storage */ } }
};
