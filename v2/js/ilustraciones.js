// Ilustraciones de ejercicios: dibujos de línea (estilo de la app), uno por ejercicio o por variante.
// Cada dibujo = una figura armada con articulaciones (cabeza, hombro, cadera, rodilla, tobillo, codo, mano)
// + el equipo (barra, mancuernas, banca, máquina, polea). viewBox 64×64, trazo redondeado, currentColor.

const pt = p => `${p[0]} ${p[1]}`;
const line = (...ps) => `<path d="M${ps.map(pt).join('L')}"/>`;
const head = (p, r = 4.2) => `<circle cx="${p[0]}" cy="${p[1]}" r="${r}"/>`;
// Figura: sh = hombro, hip = cadera; legs/arms = [[rodilla|codo, tobillo|mano], …]
function fig({ h, sh, hip, legs = [], arms = [] }) {
  return head(h) + line(sh, hip) + legs.map(([k, a]) => line(hip, k, a)).join('') + arms.map(([e, w]) => line(sh, e, w)).join('');
}
// Equipo
const plate = (p, r = 5) => `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" stroke-width="3"/>`;          // barra vista de lado
const barH = (x1, y, x2) => `<path d="M${x1} ${y}H${x2}"/><path d="M${x1} ${y - 4}v8M${x2} ${y - 4}v8" stroke-width="3.6"/>`; // barra de frente
const db = (p, vert = false) => vert ? `<path d="M${p[0]} ${p[1] - 3.5}v7" stroke-width="3.6"/>` : `<path d="M${p[0] - 3.5} ${p[1]}h7" stroke-width="3.6"/>`;
const floor = (y = 54, x1 = 6, x2 = 58) => `<path d="M${x1} ${y}H${x2}" stroke-width="2"/>`;
const bench = (x1, x2, y) => `<path d="M${x1} ${y}H${x2}" stroke-width="3"/><path d="M${x1 + 4} ${y}v8M${x2 - 4} ${y}v8" stroke-width="2"/>`;
const cable = (from, to) => `<path d="M${pt(from)}L${pt(to)}" stroke-width="1.4" stroke-dasharray="2 2.5"/>` + `<circle cx="${from[0]}" cy="${from[1]}" r="2"/>`;
const frame = d => `<path d="${d}" stroke-width="2"/>`;
const arrowUp = (x, y) => `<path d="M${x} ${y}v-8M${x - 3} ${y - 5}l3-3 3 3" stroke-width="1.8"/>`;

const ART = {
  // ── Pecho ──
  banca_barra: bench(8, 48, 42) + fig({ h: [12, 37], sh: [17, 38], hip: [36, 39], legs: [[[45, 39], [48, 52]]], arms: [[[20, 30], [21, 22]]] }) + plate([21, 19]),
  banca_mancuernas: bench(8, 48, 42) + fig({ h: [12, 37], sh: [17, 38], hip: [36, 39], legs: [[[45, 39], [48, 52]]], arms: [[[22, 31], [21, 23]]] }) + db([21, 21]),
  inclinado_barra: frame('M38 44L16 22M38 44H46M40 44v10M20 26l-4 28') + fig({ h: [15, 20], sh: [20, 26], hip: [36, 41], legs: [[[47, 41], [49, 53]]], arms: [[[28, 20], [31, 12]]] }) + plate([31, 9]),
  inclinado_mancuernas: frame('M38 44L16 22M38 44H46M40 44v10M20 26l-4 28') + fig({ h: [15, 20], sh: [20, 26], hip: [36, 41], legs: [[[47, 41], [49, 53]]], arms: [[[28, 21], [30, 13]]] }) + db([30, 11]),
  inclinado_maquina: frame('M14 54V14M14 20l6 26M44 8v46M40 22h8') + fig({ h: [22, 18], sh: [24, 24], hip: [28, 42], legs: [[[38, 42], [38, 53]]], arms: [[[32, 24], [42, 18]]] }),
  pecho_maquina: frame('M14 54V14M14 20v26M46 10v44M42 24h8') + fig({ h: [22, 18], sh: [22, 24], hip: [24, 42], legs: [[[34, 42], [34, 53]]], arms: [[[32, 26], [44, 24]]] }),
  pec_deck: frame('M32 46v8M24 46h16M10 8v46M54 8v46') + head([32, 14]) + line([32, 18], [32, 40]) + line([32, 21], [21, 23], [21, 11]) + line([32, 21], [43, 23], [43, 11]) + line([32, 40], [27, 52]) + line([32, 40], [37, 52]) + '<path d="M18 9v8M46 9v8" stroke-width="4"/>',
  cruce_poleas: cable([6, 6], [30, 34]) + cable([58, 6], [34, 34]) + head([32, 13]) + line([32, 17], [32, 36]) + line([32, 20], [26, 28], [30, 34]) + line([32, 20], [38, 28], [34, 34]) + line([32, 36], [27, 53]) + line([32, 36], [37, 53]) + floor(),
  lagartijas: floor(50) + fig({ h: [12, 31], sh: [17, 33], hip: [37, 38], legs: [[[47, 41], [56, 44]]], arms: [[[18, 41], [17, 49]]] }),
  // ── Pierna ──
  sentadilla_barra: floor() + fig({ h: [28, 13], sh: [26, 19], hip: [20, 35], legs: [[[34, 40], [30, 53]]], arms: [[[32, 22], [28, 18]]] }) + plate([26, 16]),
  sentadilla_goblet: floor() + fig({ h: [28, 13], sh: [26, 19], hip: [20, 35], legs: [[[34, 40], [30, 53]]], arms: [[[32, 26], [33, 22]]] }) + db([34, 22], true),
  sentadilla_bulgara: floor() + bench(40, 58, 40) + fig({ h: [26, 11], sh: [26, 17], hip: [28, 33], legs: [[[18, 40], [18, 53]], [[36, 46], [46, 40]]], arms: [[[25, 25], [24, 33]]] }) + db([24, 35], true),
  sentadilla_hack: frame('M12 54L40 10M40 10h6M44 54v-8') + fig({ h: [32, 15], sh: [28, 21], hip: [22, 36], legs: [[[34, 42], [38, 52]]], arms: [[[27, 16], [30, 13]]] }) + frame('M30 50h14'),
  prensa: frame('M8 50L22 30M22 30h-6M44 10l10 10M42 12l10 10') + fig({ h: [14, 28], sh: [17, 33], hip: [27, 44], legs: [[[36, 28], [46, 18]]], arms: [[[22, 40], [27, 44]]] }),
  peso_muerto: floor() + fig({ h: [17, 21], sh: [22, 25], hip: [38, 32], legs: [[[35, 42], [38, 53]]], arms: [[[25, 34], [27, 42]]] }) + plate([27, 46], 6),
  peso_muerto_rumano: floor() + fig({ h: [16, 22], sh: [21, 26], hip: [38, 28], legs: [[[39, 41], [39, 53]]], arms: [[[24, 33], [27, 40]]] }) + plate([27, 42], 5),
  hip_thrust: floor() + bench(4, 18, 34) + fig({ h: [10, 28], sh: [15, 31], hip: [32, 27], legs: [[[44, 30], [46, 53]]], arms: [[[22, 25], [30, 24]]] }) + plate([31, 22]),
  zancadas: floor() + fig({ h: [30, 10], sh: [30, 15], hip: [30, 31], legs: [[[20, 33], [20, 53]], [[38, 46], [48, 53]]], arms: [[[28, 23], [27, 31]]] }) + db([27, 33], true),
  extension_cuadriceps: frame('M14 54V14M14 40h22M20 40v14') + fig({ h: [20, 16], sh: [20, 22], hip: [24, 38], legs: [[[36, 38], [52, 36]]], arms: [[[22, 30], [28, 38]]] }) + '<path d="M52 32v8" stroke-width="4"/>',
  curl_femoral_acostado: bench(8, 46, 40) + fig({ h: [12, 33], sh: [17, 35], hip: [33, 36], legs: [[[44, 37], [46, 24]]], arms: [[[16, 40], [13, 46]]] }) + '<path d="M42 22h8" stroke-width="4"/>',
  curl_femoral_sentado: frame('M14 54V14M14 40h22M20 40v14') + fig({ h: [20, 16], sh: [20, 22], hip: [24, 38], legs: [[[38, 38], [33, 50]]], arms: [[[24, 30], [32, 34]]] }) + '<path d="M32 33h10" stroke-width="4"/>',
  talones_pie: frame('M22 50h16v4') + fig({ h: [32, 10], sh: [32, 15], hip: [32, 31], legs: [[[32, 41], [30, 48]]], arms: [[[30, 23], [29, 31]]] }) + arrowUp(44, 46),
  talones_sentado: frame('M10 40h16M14 40v14') + fig({ h: [16, 16], sh: [17, 22], hip: [20, 38], legs: [[[34, 37], [36, 49]]], arms: [[[24, 30], [32, 34]]] }) + '<path d="M28 33h12" stroke-width="4"/>' + frame('M32 51h8v3') + arrowUp(48, 46),
  // ── Espalda ──
  dominadas: '<path d="M10 8H54" stroke-width="3"/>' + head([32, 19]) + line([32, 23], [32, 40]) + line([32, 25], [22, 18], [20, 8]) + line([32, 25], [42, 18], [44, 8]) + line([32, 40], [28, 49], [34, 54]) + line([32, 40], [36, 49], [42, 52]),
  jalon_pecho: cable([32, 4], [32, 12]) + barH(14, 14, 50) + frame('M18 46h22M24 46v8') + head([32, 24]) + line([32, 28], [32, 44]) + line([32, 30], [22, 26], [18, 14]) + line([32, 30], [42, 26], [46, 14]) + line([32, 44], [40, 46], [42, 54]),
  jalon_neutro: cable([32, 4], [32, 12]) + '<path d="M27 14h10M27 11v6M37 11v6" stroke-width="3"/>' + frame('M18 46h22M24 46v8') + head([32, 24]) + line([32, 28], [32, 44]) + line([32, 30], [26, 24], [28, 14]) + line([32, 30], [38, 24], [36, 14]) + line([32, 44], [40, 46], [42, 54]),
  remo_barra: floor() + fig({ h: [16, 19], sh: [21, 24], hip: [38, 30], legs: [[[33, 41], [37, 53]]], arms: [[[28, 32], [26, 38]]] }) + plate([26, 40]),
  remo_mancuerna: floor() + bench(30, 58, 40) + fig({ h: [16, 22], sh: [22, 26], hip: [42, 30], legs: [[[44, 40], [40, 40]], [[38, 42], [34, 53]]], arms: [[[24, 33], [22, 38]], [[30, 26], [38, 34]]] }) + db([22, 40], true),
  remo_maquina: frame('M10 18v36M44 14v40M38 44h12M44 44v10') + frame('M30 22v12') + fig({ h: [38, 18], sh: [38, 24], hip: [42, 42], legs: [[[32, 42], [30, 53]]], arms: [[[28, 28], [20, 26]]] }),
  remo_polea_baja: cable([6, 44], [22, 30]) + frame('M30 44h22M6 38v10') + fig({ h: [40, 20], sh: [38, 26], hip: [42, 42], legs: [[[30, 40], [18, 44]]], arms: [[[30, 32], [22, 30]]] }),
  // ── Hombro ──
  militar_barra: floor() + fig({ h: [32, 16], sh: [32, 21], hip: [32, 37], legs: [[[31, 46], [31, 54]]], arms: [[[30, 14], [32, 8]]] }) + plate([32, 6]),
  hombro_mancuernas: frame('M18 40h28M24 40v14') + head([32, 16]) + line([32, 20], [32, 38]) + line([32, 23], [21, 23], [20, 11]) + line([32, 23], [43, 23], [44, 11]) + line([32, 38], [26, 44], [26, 54]) + line([32, 38], [38, 44], [38, 54]) + db([20, 9]) + db([44, 9]),
  hombro_maquina: frame('M10 8v46M54 8v46M10 8h44') + head([32, 18]) + line([32, 22], [32, 40]) + line([32, 25], [22, 24], [20, 14]) + line([32, 25], [42, 24], [44, 14]) + line([32, 40], [26, 46], [26, 54]) + line([32, 40], [38, 46], [38, 54]) + '<path d="M16 14h8M40 14h8" stroke-width="4"/>',
  laterales_mancuernas: floor() + head([32, 13]) + line([32, 17], [32, 36]) + line([32, 21], [17, 24]) + line([32, 21], [47, 24]) + line([32, 36], [27, 54]) + line([32, 36], [37, 54]) + db([15, 25]) + db([49, 25]),
  laterales_polea: floor() + cable([8, 52], [46, 26]) + head([32, 13]) + line([32, 17], [32, 36]) + line([32, 21], [46, 26]) + line([32, 21], [28, 30], [27, 36]) + line([32, 36], [27, 54]) + line([32, 36], [37, 54]),
  face_pull: floor() + cable([56, 12], [34, 18]) + fig({ h: [24, 14], sh: [24, 20], hip: [24, 36], legs: [[[24, 45], [22, 54]], [[26, 45], [30, 54]]], arms: [[[30, 14], [34, 18]]] }),
  pajaros: floor() + head([32, 24]) + line([32, 28], [32, 36]) + line([32, 29], [18, 24]) + line([32, 29], [46, 24]) + line([32, 36], [26, 54]) + line([32, 36], [38, 54]) + db([16, 23], true) + db([48, 23], true),
  // ── Brazo ──
  curl_barra: floor() + fig({ h: [30, 12], sh: [30, 17], hip: [30, 34], legs: [[[30, 44], [29, 54]]], arms: [[[30, 27], [38, 20]]] }) + plate([40, 19], 4.5),
  curl_mancuernas: floor() + fig({ h: [30, 12], sh: [30, 17], hip: [30, 34], legs: [[[30, 44], [29, 54]]], arms: [[[30, 27], [38, 20]], [[30, 26], [31, 34]]] }) + db([40, 19]) + db([31, 36]),
  curl_martillo: floor() + fig({ h: [30, 12], sh: [30, 17], hip: [30, 34], legs: [[[30, 44], [29, 54]]], arms: [[[30, 27], [38, 20]], [[30, 26], [31, 34]]] }) + db([39, 19], true) + db([31, 37], true),
  triceps_polea: floor() + cable([40, 4], [36, 34]) + fig({ h: [28, 13], sh: [28, 18], hip: [28, 35], legs: [[[28, 45], [27, 54]]], arms: [[[30, 27], [36, 34]]] }) + '<path d="M33 34h6" stroke-width="3"/>',
  press_frances: bench(10, 50, 42) + fig({ h: [14, 37], sh: [19, 38], hip: [38, 39], legs: [[[46, 39], [49, 52]]], arms: [[[19, 24], [12, 26]]] }) + plate([11, 26], 4.5),
  fondos: '<path d="M14 26h36M18 26v28M46 26v28" stroke-width="2.4"/>' + fig({ h: [32, 14], sh: [32, 20], hip: [33, 36], legs: [[[30, 44], [36, 48]]], arms: [[[24, 22], [20, 26]], [[40, 22], [44, 26]]] }),
  // ── Core ──
  plancha: floor(50) + fig({ h: [12, 34], sh: [17, 37], hip: [36, 40], legs: [[[46, 43], [56, 46]]], arms: [[[17, 47], [26, 48]]] }),
  rueda: floor(50) + fig({ h: [24, 37], sh: [28, 38], hip: [40, 34], legs: [[[44, 46], [56, 48]]], arms: [[[20, 44], [14, 46]]] }) + '<circle cx="12" cy="46" r="4" stroke-width="2.6"/>',
  crunch_polea: floor() + cable([30, 4], [26, 22]) + fig({ h: [22, 26], sh: [28, 28], hip: [40, 36], legs: [[[40, 50], [54, 52]]], arms: [[[24, 22], [22, 24]]] }),
  // ── Cardio y genérico ──
  cardio: floor() + fig({ h: [34, 12], sh: [33, 17], hip: [30, 33], legs: [[[37, 40], [35, 52]], [[23, 39], [18, 46]]], arms: [[[38, 24], [44, 20]], [[27, 23], [24, 30]]] }),
  bici: '<circle cx="18" cy="44" r="8" stroke-width="2.2"/><circle cx="48" cy="44" r="8" stroke-width="2.2"/>' + frame('M18 44l10-14h14l6 14M30 30l-4-6h6M42 30v-8') + fig({ h: [40, 12], sh: [36, 17], hip: [28, 26], legs: [[[34, 34], [30, 42]]], arms: [[[40, 22], [42, 22]]] }),
  general: floor() + head([32, 13]) + line([32, 17], [32, 36]) + line([32, 21], [22, 28]) + line([32, 21], [42, 28]) + line([32, 36], [27, 54]) + line([32, 36], [37, 54])
};

// Del más específico al más general. Se prueba contra el nombre sin acentos.
const BY_NAME = [
  [/pec ?deck|aperturas en maquina|contractora/, 'pec_deck'],
  [/cruce|crossover|aperturas en polea/, 'cruce_poleas'],
  [/aperturas|fly/, 'pec_deck'],
  [/press (de )?banca.*mancuerna|press con mancuernas|press plano.*mancuerna/, 'banca_mancuernas'],
  [/inclinad.*mancuerna/, 'inclinado_mancuernas'],
  [/inclinad.*maquina/, 'inclinado_maquina'],
  [/inclinad/, 'inclinado_barra'],
  [/press (de )?pecho.*maquina|chest press/, 'pecho_maquina'],
  [/press (de )?banca|bench/, 'banca_barra'],
  [/lagartija|push ?up/, 'lagartijas'],
  [/goblet/, 'sentadilla_goblet'],
  [/bulgara|split/, 'sentadilla_bulgara'],
  [/hack/, 'sentadilla_hack'],
  [/sentadilla|squat/, 'sentadilla_barra'],
  [/prensa|leg press/, 'prensa'],
  [/rumano|rdl|piernas rigidas/, 'peso_muerto_rumano'],
  [/peso muerto|deadlift/, 'peso_muerto'],
  [/hip ?thrust|puente/, 'hip_thrust'],
  [/zancada|lunge|desplante|step ?up/, 'zancadas'],
  [/extension de cuadriceps|leg extension/, 'extension_cuadriceps'],
  [/curl femoral (acostado|tumbado)|femoral acostado/, 'curl_femoral_acostado'],
  [/curl femoral|femoral sentado|leg curl/, 'curl_femoral_sentado'],
  [/talones sentado|pantorrilla sentado|gemelo sentado/, 'talones_sentado'],
  [/talones|pantorrilla|gemelo|calf/, 'talones_pie'],
  [/dominada|pull ?up|chin ?up/, 'dominadas'],
  [/jalon.*(neutro|cerrado|v)/, 'jalon_neutro'],
  [/jalon|lat ?pull/, 'jalon_pecho'],
  [/remo.*polea|remo bajo|seated row/, 'remo_polea_baja'],
  [/remo.*maquina/, 'remo_maquina'],
  [/remo.*mancuerna/, 'remo_mancuerna'],
  [/remo/, 'remo_barra'],
  [/face ?pull/, 'face_pull'],
  [/pajaro|deltoide post|reverse fly/, 'pajaros'],
  [/lateral.*polea/, 'laterales_polea'],
  [/lateral|elevacion(es)? frontal/, 'laterales_mancuernas'],
  [/press (de )?hombro.*maquina|shoulder press machine/, 'hombro_maquina'],
  [/press (de )?hombro|arnold/, 'hombro_mancuernas'],
  [/militar|overhead/, 'militar_barra'],
  [/martillo|hammer/, 'curl_martillo'],
  [/curl.*barra|curl predicador/, 'curl_barra'],
  [/curl|biceps/, 'curl_mancuernas'],
  [/frances|skull/, 'press_frances'],
  [/fondos|dips/, 'fondos'],
  [/triceps|extension.*polea/, 'triceps_polea'],
  [/crunch.*polea|abdominal.*polea/, 'crunch_polea'],
  [/rueda|ab wheel/, 'rueda'],
  [/plancha|plank|abdom|crunch|core/, 'plancha'],
  [/bici|spinning/, 'bici'],
  [/caminadora|cinta|eliptica|correr|trote|escaladora|cardio|caminar|remo ergo/, 'cardio']
];
const BY_MUSCLE = { pecho: 'banca_barra', espalda: 'remo_barra', pierna: 'sentadilla_barra', hombro: 'hombro_mancuernas', brazo: 'curl_mancuernas', core: 'plancha', cardio: 'cardio' };
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function exerciseArtKey(name = '', muscle = '') {
  const n = norm(name);
  const hit = BY_NAME.find(([re]) => re.test(n));
  return hit ? hit[1] : BY_MUSCLE[muscle] || 'general';
}

// size en px; la caja (fondo verde suave y trazo verde) la da la clase .ex-art.
export function exerciseArt(name, muscle, size = 56) {
  const k = exerciseArtKey(name, muscle);
  return `<span class="ex-art" style="width:${size}px;height:${size}px" aria-hidden="true"><svg viewBox="0 0 64 64" width="${Math.round(size * .86)}" height="${Math.round(size * .86)}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ART[k]}</svg></span>`;
}
export const ART_KEYS = Object.keys(ART);
