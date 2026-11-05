// Shell de v2: sesión, router por hash y navegación (inferior en móvil, lateral en escritorio).
import { sb, AuthError } from './db.js?v=202611051619';
import { escapeHTML, showToast } from './util.js?v=202611051619';
import * as inicio from './views/inicio.js?v=202611051619';
import * as pendiente from './views/pendiente.js?v=202611051619';
import * as finClasica from './finclasica.js?v=202611051619';
import * as finanzas from './views/finanzas.js?v=202611051619';
import * as salud from './views/salud.js?v=202611051619';
import * as entreno from './views/entreno.js?v=202611051619';
import * as rutinas from './views/rutinas.js?v=202611051619';
import * as objetivosView from './views/objetivos.js?v=202611051619';
import * as recordatoriosView from './views/recordatorios.js?v=202611051619';
import * as calendarioView from './views/calendario.js?v=202611051619';
import * as estadisticasView from './views/estadisticas.js?v=202611051619';
import * as notasView from './views/notas.js?v=202611051619';
import * as tareasView from './views/tareas.js?v=202611051619';
import { checkRecurring } from './tareas.js?v=202611051619';

const ROUTES = ['inicio', 'tareas', 'calendario', 'finanzas', 'salud', 'entreno', 'rutinas', 'rutina', 'objetivos', 'recordatorios', 'notas', 'estadisticas', 'mas'];
// Pantallas de Salud que marcan la pestaña Salud.
const SALUD = ['salud', 'entreno', 'rutinas', 'rutina'];
const $ = id => document.getElementById(id);
const main = $('main');
let started = false;
let renderSeq = 0;

// "#rutina/abc?x=1" → { route: 'rutina', param: 'abc' }
function parseHash() {
  const [r, param] = location.hash.replace(/^#\/?/, '').split(/[?&]/)[0].split('/');
  return ROUTES.includes(r) ? { route: r, param: param ? decodeURIComponent(param) : null } : { route: 'inicio', param: null };
}
const currentRoute = () => parseHash().route;

function markNav(route) {
  // En móvil, las secciones que viven en "Más" marcan la pestaña Más.
  const base = SALUD.includes(route) ? 'salud' : route;
  const tabRoute = ['calendario', 'objetivos', 'recordatorios', 'notas', 'estadisticas'].includes(base) ? 'mas' : base;
  document.querySelectorAll('[data-route]').forEach(a => {
    const on = a.closest('.tabbar') ? a.dataset.route === tabRoute : a.dataset.route === base;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function skeleton() {
  main.innerHTML = `<div class="page" aria-busy="true">
    <div class="skeleton" style="height:64px;max-width:320px"></div>
    <div class="skeleton" style="height:150px"></div>
    <div class="skeleton" style="height:260px"></div>
  </div>`;
}

async function renderRoute() {
  const route = currentRoute();
  const seq = ++renderSeq;
  markNav(route);
  if (!(route === 'finanzas' && parseHash().param)) finClasica.unmount(); // esconde el + de finanzas avanzada
  window.scrollTo(0, 0);
  if (route === 'inicio') {
    skeleton();
    try {
      const data = await inicio.load();
      if (seq !== renderSeq) return; // el usuario ya cambió de sección
      inicio.render(main, data);
      updateTaskCount(data);
      // Igual que v1 al abrir: genera las recurrentes de hoy + 7 días (una vez por sesión).
      if (await checkRecurring() && seq === renderSeq) { inicio.render(main, data); updateTaskCount(data); }
    } catch (e) {
      if (seq !== renderSeq) return;
      if (e instanceof AuthError) return showLogin();
      main.innerHTML = `<div class="page"><div class="error-box">No se pudo conectar con Supabase.<br><small>${escapeHTML(e.message)}</small></div></div>`;
    }
  } else if (route === 'finanzas' && parseHash().param && finClasica.FIN_TABS[parseHash().param]) {
    // Finanzas avanzada (misma lógica que la clásica): movimientos, cuentas, patrimonio, recurrentes…
    main.innerHTML = `<div class="page">
      <header class="head" style="align-items:center"><h1 class="hello" id="viewTitle" style="margin:0">Finanzas</h1><a class="btn-ghost sm" style="display:inline-flex;align-items:center;text-decoration:none;color:var(--text)" href="#finanzas">← Resumen</a></header>
      <div class="fc" id="fcHost"></div></div>`;
    try { await finClasica.mount(document.getElementById('fcHost'), parseHash().param, () => seq === renderSeq); }
    catch (e) {
      if (seq !== renderSeq) return;
      if (e instanceof AuthError) return showLogin();
      main.innerHTML = `<div class="page"><div class="error-box">No se pudieron cargar las finanzas.<br><small>${escapeHTML(e.message)}</small></div></div>`;
    }
  } else if (route === 'finanzas') {
    skeleton();
    try {
      await finanzas.show(main, () => seq === renderSeq);
    } catch (e) {
      if (seq !== renderSeq) return;
      if (e instanceof AuthError) return showLogin();
      main.innerHTML = `<div class="page"><div class="error-box">No se pudieron cargar las finanzas.<br><small>${escapeHTML(e.message)}</small></div></div>`;
    }
  } else if (route === 'tareas') {
    skeleton();
    try { await tareasView.show(main, parseHash().param, () => seq === renderSeq); }
    catch (e) {
      if (seq !== renderSeq) return;
      if (e instanceof AuthError) return showLogin();
      main.innerHTML = `<div class="page"><div class="error-box">No se pudieron cargar las tareas.<br><small>${escapeHTML(e.message)}</small></div></div>`;
    }
  } else if (SALUD.includes(route)) {
    skeleton();
    const isCurrent = () => seq === renderSeq;
    try {
      if (route === 'salud') await salud.show(main, isCurrent);
      else if (route === 'entreno') await entreno.show(main, isCurrent);
      else await rutinas.show(main, route === 'rutina' ? parseHash().param : null, isCurrent);
    } catch (e) {
      if (seq !== renderSeq) return;
      if (e instanceof AuthError) return showLogin();
      main.innerHTML = `<div class="page"><div class="error-box">No se pudo cargar Salud.<br><small>${escapeHTML(e.message)}</small></div></div>`;
    }
  } else if (['objetivos', 'recordatorios', 'notas', 'calendario', 'estadisticas'].includes(route)) {
    skeleton();
    const view = { objetivos: objetivosView, recordatorios: recordatoriosView, notas: notasView, calendario: calendarioView, estadisticas: estadisticasView }[route];
    try { await view.show(main, () => seq === renderSeq); }
    catch (e) {
      if (seq !== renderSeq) return;
      if (e instanceof AuthError) return showLogin();
      main.innerHTML = `<div class="page"><div class="error-box">No se pudo cargar.<br><small>${escapeHTML(e.message)}</small></div></div>`;
    }
  } else if (route === 'mas') {
    pendiente.renderMore(main);
  } else {
    pendiente.render(main, route);
  }
  main.focus({ preventScroll: true });
}

function updateTaskCount(data) {
  const { open } = inicio.todayTasks(data.tasks);
  const el = $('sideTaskCount');
  if (el) el.textContent = open.length || '';
}

// ── Sesión ───────────────────────────────────────────
function showLogin() {
  $('app').hidden = true;
  $('login').hidden = false;
}
function startApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  if (started) return;
  started = true;
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

function loginMsg(text, isError) {
  const m = $('loginMsg');
  m.textContent = text;
  m.classList.toggle('error', !!isError);
}
function showCodeStep(show) {
  $('loginEmailStep').hidden = show;
  $('loginCodeStep').hidden = !show;
  $('loginHint').textContent = show
    ? 'Revisa tu correo y abre el enlace. Si el correo trae un código, escríbelo aquí.'
    : 'Entra con tu contraseña o pide un enlace a tu correo.';
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!email) return;
  if (!password) return loginMsg('Escribe tu contraseña o usa "Enviarme un enlace".', true);
  const btn = $('loginPwBtn');
  btn.disabled = true; loginMsg('Entrando…');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  if (error) return loginMsg(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : 'No se pudo entrar: ' + error.message, true);
  loginMsg('');
});
$('loginLinkBtn').addEventListener('click', async () => {
  const input = $('loginEmail');
  const email = input.value.trim();
  if (!email || !input.checkValidity()) return loginMsg('Escribe un correo válido.', true);
  const btn = $('loginLinkBtn');
  btn.disabled = true; loginMsg('Enviando…');
  // El enlace regresa a /v2/ (no a v1).
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  btn.disabled = false;
  if (error) return loginMsg('No se pudo enviar: ' + error.message, true);
  loginMsg(''); showCodeStep(true);
});
$('loginCodeBtn').addEventListener('click', async () => {
  const email = $('loginEmail').value.trim();
  const token = $('loginCode').value.trim();
  if (!token) return;
  loginMsg('Verificando…');
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) loginMsg('Código inválido o vencido', true); else loginMsg('');
});
$('loginBack').addEventListener('click', () => { loginMsg(''); showCodeStep(false); });

document.addEventListener('click', async e => {
  if (!e.target.closest('[data-logout]')) return;
  await sb.auth.signOut();
  location.replace(location.pathname);
});

sb.auth.onAuthStateChange((event, session) => {
  if (session) startApp();
  else if (event === 'SIGNED_OUT') showLogin();
});

sb.auth.getSession().then(({ data: { session } }) => {
  // Limpia el hash del enlace mágico para que no lo lea el router.
  const linkError = location.hash.includes('error=');
  if (location.hash.includes('access_token') || linkError) history.replaceState(null, '', location.pathname + location.search);
  if (linkError && !session) loginMsg('El enlace venció o ya se usó. Pide uno nuevo.', true);
  if (session) startApp(); else showLogin();
}).catch(() => { showLogin(); showToast('No se pudo leer la sesión', 'error'); });
