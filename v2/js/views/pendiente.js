// Secciones que todavía no existen en v2: explican en qué fase llegan y llevan a v1.
import { escapeHTML, icon } from '../util.js';

export const SECTIONS = {
  tareas:     { title: 'Tareas', phase: 'Por ahora sigue en la versión actual.' },
  calendario: { title: 'Calendario', phase: 'Por ahora sigue en la versión actual.' },
  finanzas:   { title: 'Finanzas', phase: 'Llega en la fase 2 con cuentas, presupuesto y captura desde Apple Pay.' },
  objetivos:  { title: 'Objetivos y hábitos', phase: 'Por ahora se editan en la versión actual.' },
  notas:      { title: 'Notas', phase: 'Por ahora siguen en la versión actual.' }
};

export function render(el, route) {
  const s = SECTIONS[route];
  el.innerHTML = `<div class="page">
    <section class="soon">
      <div class="eyebrow">v2 · en construcción</div>
      <h1>${escapeHTML(s.title)}</h1>
      <p>${escapeHTML(s.phase)}</p>
      <a class="btn-dark" href="../">Abrir la versión actual</a>
    </section>
  </div>`;
}

// "Más" en móvil: lo que en escritorio está en la barra lateral.
export function renderMore(el) {
  const link = (r, ic) => `<a href="#${r}">${icon(ic)}${escapeHTML(SECTIONS[r].title)}</a>`;
  el.innerHTML = `<div class="page">
    <h1 class="hello" style="font-size:28px">Más</h1>
    <nav class="card more-list" aria-label="Más secciones">
      ${link('calendario', 'calendario')}
      ${link('objetivos', 'objetivos')}
      ${link('notas', 'notas')}
      <a href="../">${icon('volver')}Volver a la versión actual</a>
      <button type="button" data-logout>${icon('salir')}Cerrar sesión</button>
    </nav>
  </div>`;
}
