// Ilustraciones de ejercicios: dibujos de línea (estilo de la app) por tipo de movimiento.
// Se elige por el nombre del ejercicio y, si no reconoce el nombre, por el grupo muscular.
// Todos usan viewBox 64×64, trazo redondeado y currentColor (el color lo pone el CSS).

const H = (x, y) => `<circle cx="${x}" cy="${y}" r="4.2"/>`; // cabeza
const P = d => `<path d="${d}"/>`;
const BAR = (x1, y, x2) => `<path d="M${x1} ${y}H${x2}"/><path d="M${x1} ${y - 4}v8M${x2} ${y - 4}v8" stroke-width="4"/>`;
const DB = (x, y) => `<path d="M${x - 3.5} ${y}h7" stroke-width="3.4"/>`; // mancuerna

const ART = {
  banca: H(14, 37) + P('M18 39h22M24 39l-2 9M40 39l6 9') + P('M10 44h40M14 44v6M44 44v6') + P('M26 39v-14M34 39v-14') + BAR(14, 24, 46),
  sentadilla: H(30, 13) + BAR(14, 19, 46) + P('M30 18l-3 14 9 6-2 13M27 32l-9 5 2 14M22 19l5 1M38 19l-5 1'),
  pesomuerto: H(18, 20) + P('M21 23l16 10 2 18M37 33l-4 18M24 25l2 16M30 29l2 13') + BAR(16, 42, 46),
  gluteo: H(12, 35) + P('M6 40h14v10') + P('M16 38l14-6 12 1 4 16M30 32l-2 17') + BAR(22, 27, 42),
  remo: H(16, 22) + P('M19 25l16 6 4 20M35 31l-6 20M25 28v12') + DB(25, 42) + P('M8 51h48'),
  jalon: H(32, 26) + P('M32 30v16M32 46l-8 8M32 46l8 8M32 33l-10-14M32 33l10-14') + BAR(12, 14, 52),
  hombro: H(32, 14) + P('M32 18v20M32 38l-7 15M32 38l7 15M32 22l-10-2-2-10M32 22l10-2 2-10') + DB(20, 9) + DB(44, 9),
  lateral: H(32, 14) + P('M32 18v20M32 38l-7 15M32 38l7 15M32 22l-16 3M32 22l16 3') + DB(14, 25) + DB(50, 25),
  curl: H(30, 13) + P('M30 17v21M30 38l-6 15M30 38l6 15M30 22l6 9 5-9M30 22l-4 12') + DB(42, 21) + DB(26, 35),
  triceps: H(32, 14) + P('M32 18v20M32 38l-7 15M32 38l7 15M32 22l-4 9v9M32 22l4 9v9M32 40V4M28 40h8'),
  zancada: H(30, 10) + P('M30 14v16M30 30l-11 2v18M30 30l9 10 9 9M30 18l-5 10M30 18l5 10') + DB(25, 29) + DB(35, 29) + P('M10 51h44'),
  maquina: H(22, 18) + P('M14 14v24h14M22 22l2 14h10l8 14M24 36l14-4') + P('M10 50h44M46 30v20'),
  plancha: H(12, 34) + P('M16 37l32 4M16 37l-2 13M14 50h6M48 41l6 9') + P('M8 52h50'),
  cardio: H(34, 12) + P('M33 16l-4 16 8 6-2 13M29 32l-9 3-4 9M31 21l8 7 7-3M31 21l-7 4-3 8'),
  general: H(32, 13) + P('M32 17v21M32 38l-7 15M32 38l7 15M32 23l-11 6M32 23l11 6')
};

const BY_NAME = [
  [/press.*(banca|pecho|inclinad|declinad)|banca|bench|aperturas|fly|cruce|pec ?deck|lagartij|push ?up/i, 'banca'],
  [/sentadilla|squat|goblet|hack|búlgara|bulgara/i, 'sentadilla'],
  [/peso muerto|deadlift|rumano|good morning/i, 'pesomuerto'],
  [/hip ?thrust|puente|glúteo|gluteo|patada|kickback|abducci/i, 'gluteo'],
  [/remo|row|pull ?over/i, 'remo'],
  [/jal[oó]n|dominad|pull ?up|chin ?up|lat ?pull/i, 'jalon'],
  [/press.*(hombro|militar|arnold)|militar|overhead|shoulder press/i, 'hombro'],
  [/elevaci[oó]n|lateral|frontal|face ?pull|p[aá]jaro|deltoide post/i, 'lateral'],
  [/curl(?!.*(femoral|pierna))|b[ií]ceps|martillo|predicador/i, 'curl'],
  [/tr[ií]ceps|fondos|dips|copa|press franc[eé]s|extensi[oó]n.*(tr[ií]|polea|codo)|jal[oó]n.*tr[ií]/i, 'triceps'],
  [/zancada|lunge|desplante|step ?up|subida/i, 'zancada'],
  [/prensa|extensi[oó]n|curl.*(femoral|pierna)|femoral|cu[aá]driceps|aductor|pantorrilla|gemelo|m[aá]quina/i, 'maquina'],
  [/plancha|plank|abdom|crunch|core|oblicu|rueda|elevaci[oó]n de piernas|russian/i, 'plancha'],
  [/caminadora|cinta|bici|el[ií]ptica|correr|trote|escaladora|cardio|remo ergo|cuerda|burpee|hiit|caminar/i, 'cardio']
];
const BY_MUSCLE = { pecho: 'banca', espalda: 'remo', pierna: 'sentadilla', hombro: 'hombro', brazo: 'curl', core: 'plancha', cardio: 'cardio' };

export function exerciseArtKey(name = '', muscle = '') {
  const hit = BY_NAME.find(([re]) => re.test(name));
  return hit ? hit[1] : BY_MUSCLE[muscle] || 'general';
}

// size en px; la caja (fondo crema y color verde) la da la clase .ex-art.
export function exerciseArt(name, muscle, size = 56) {
  const k = exerciseArtKey(name, muscle);
  return `<span class="ex-art" style="width:${size}px;height:${size}px" aria-hidden="true"><svg viewBox="0 0 64 64" width="${Math.round(size * .82)}" height="${Math.round(size * .82)}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ART[k]}</svg></span>`;
}
