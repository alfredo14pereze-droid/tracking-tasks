// Secciones que todavía no existen en v2: explican en qué fase llegan y llevan a la versión clásica.
import { escapeHTML, icon } from '../util.js?v=202611041323';

export const SECTIONS = {
  calendario: { title: 'Calendario', phase: 'Por ahora sigue en la versión clásica.' },
  objetivos:  { title: 'Objetivos y hábitos', phase: 'Por ahora se editan en la versión clásica.' },
  notas:      { title: 'Notas', phase: '' },
  recordatorios: { title: 'Recordatorios', phase: '' },
  estadisticas: { title: 'Estadísticas', phase: '' }
};

export function render(el, route) {
  const s = SECTIONS[route];
  el.innerHTML = `<div class="page">
    <section class="soon">
      <div class="eyebrow">v2 · en construcción</div>
      <h1>${escapeHTML(s.title)}</h1>
      <p>${escapeHTML(s.phase)}</p>
      <a class="btn-dark" href="#inicio">Ir a Inicio</a>
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
      ${link('recordatorios', 'bell')}
      ${link('notas', 'notas')}
      ${link('estadisticas', 'chart')}
      <button type="button" data-logout>${icon('salir')}Cerrar sesión</button>
    </nav>
  </div>`;
}
