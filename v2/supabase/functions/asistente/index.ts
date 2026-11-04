// Edge Function "asistente" — funciones de IA de TaskTracker con Claude. Una sola función, varias acciones:
//   gym          → sugerencias de progresión/estancamiento y, si conviene, una rutina nueva
//   estado       → lee un estado de cuenta en PDF y regresa los movimientos (nuevos vs. ya registrados)
//   categorias   → sugiere la categoría de pagos de Apple Pay por revisar
//   ideas        → 3 ideas de comida para lo que falta del día (sin pescado ni mariscos)
//   semana       → resumen de la semana con 2–3 cosas a mejorar
// POST /functions/v1/asistente  { action, ...datos }   (con la sesión del usuario)
// La app manda los datos ya resumidos; la función no lee la base de datos.
// Secrets: ANTHROPIC_API_KEY (obligatorio) y ALLOWED_EMAILS (opcional). "Verify JWT" puede quedar encendido.
// Escrito como JavaScript válido (sin tipos) para poder probar la lógica con Node.

const MODEL = 'claude-opus-5-5';
const env = k => (typeof Deno !== 'undefined' ? Deno.env.get(k) : globalThis.process?.env?.[k]) || '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const S = (props, extra = {}) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props, ...extra });
const str = { type: 'string' }, int = { type: 'integer' }, num = { type: 'number' }, bool = { type: 'boolean' };
const arr = items => ({ type: 'array', items });
const enm = (...v) => ({ type: 'string', enum: v });

const PERSONA = 'Hablas con Alfredo, que vive en Monterrey, México. Responde en español de México, claro y directo, sin rodeos ni frases de relleno.';

// ── Acciones: prompt, esquema y límites ─────────────────
export const ACTIONS = {
  gym: {
    effort: 'medium', maxTokens: 8000,
    system: `${PERSONA}
Eres su entrenador de fuerza. Recibes su historial reciente por ejercicio (fecha, peso de trabajo, reps por serie), su rutina con los ids de cada lugar, su recuperación de Whoop y su peso corporal.
Tu trabajo:
1. Detecta estancamientos (3+ sesiones sin subir peso ni reps), caídas, ejercicios que van bien y desbalances de volumen entre grupos.
2. Da de 2 a 5 sugerencias concretas y accionables. Si una sugerencia cambia series o reps de un lugar de la rutina, pon su item_id y los valores nuevos (0 = sin cambio). Si no aplica a un lugar concreto, item_id vacío.
3. Solo si hay una razón clara (estancamiento general, rutina muy desbalanceada o lo pide), propone una rutina nueva (include=true) usando de preferencia ejercicios de su catálogo; si no, include=false y deja items vacío.
Sé conservador con la carga cuando la recuperación es baja. No inventes datos que no están en el historial.`,
    schema: S({
      headline: str, analysis: str,
      suggestions: arr(S({ kind: enm('subir', 'mantener', 'descarga', 'cambiar_ejercicio', 'volumen', 'nota'), exercise: str, text: str, item_id: str, new_sets: int, new_reps_min: int, new_reps_max: int })),
      new_routine: S({ include: bool, name: str, tag: enm('push', 'pull', 'pierna', 'full', 'cardio', 'otro'), reason: str,
        items: arr(S({ exercise: str, muscle: enm('pecho', 'espalda', 'pierna', 'hombro', 'brazo', 'core', 'cardio', 'otro'), sets: int, reps_min: int, reps_max: int, rest_sec: int, alternatives: arr(str) })) })
    }),
    user: d => `Datos de entrenamiento (JSON):\n${JSON.stringify(d.data)}${d.note ? `\n\nNota de Alfredo: ${d.note}` : ''}`
  },
  estado: {
    effort: 'low', maxTokens: 32000, stream: true,
    system: `${PERSONA}
Eres su asistente de finanzas. Recibes el PDF de un estado de cuenta, la cuenta a la que pertenece, sus categorías y los movimientos que YA registró en esas fechas.
Tu trabajo:
1. Extrae TODOS los movimientos del periodo (fecha YYYY-MM-DD, descripción breve tal como aparece pero legible, monto positivo en pesos con centavos, tipo).
   Tipos: expense (compra o cargo), income (abono, depósito, devolución), payment (pago a la tarjeta), transfer_out / transfer_in (envíos entre sus cuentas), fee (comisión, interés o IVA de comisión).
2. Para cada uno, compara con los ya registrados: "ya_registrado" si hay uno con mismo monto y fecha ±3 días; "posible_duplicado" si se parece pero no estás seguro; "nuevo" si no aparece. En matched_note explica brevemente con cuál lo emparejaste (vacío si es nuevo).
3. Sugiere la categoría usando EXACTAMENTE uno de los nombres de su lista (vacío si ninguno aplica o es payment/transfer).
4. Resume: totales de gastos (expense+fee) e ingresos (income), gasto por categoría y 1–4 notas útiles (cargos raros, comisiones, suscripciones repetidas).
No inventes movimientos. Si el PDF no es un estado de cuenta, regresa transactions vacío y explícalo en notes.`,
    schema: S({
      period: str,
      transactions: arr(S({ date: str, description: str, amount: num, type: enm('expense', 'income', 'payment', 'transfer_out', 'transfer_in', 'fee'), category: str, match: enm('nuevo', 'ya_registrado', 'posible_duplicado'), matched_note: str })),
      summary: S({ total_expenses: num, total_income: num, by_category: arr(S({ category: str, amount: num })), notes: arr(str) })
    }),
    user: d => [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.pdf } },
      { type: 'text', text: `Cuenta: ${d.account}\nCategorías de gasto: ${(d.categories || []).join(', ')}\nCategorías de ingreso: ${(d.incomeCategories || []).join(', ')}\nMovimientos ya registrados en esa cuenta (JSON): ${JSON.stringify(d.existing || [])}` }
    ]
  },
  categorias: {
    effort: 'low', maxTokens: 4000,
    system: `${PERSONA}
Clasificas pagos con tarjeta (Apple Pay) en sus categorías de gasto. Recibes cada pago con su id, comercio, monto y tarjeta, la lista de categorías (id y nombre) y ejemplos de cómo clasificó comercios antes.
Para cada pago regresa su id, el category_id más probable (de la lista; vacío si de verdad no sabes) y tu confianza. Respeta sus ejemplos: si ya clasificó ese comercio, usa la misma categoría.`,
    schema: S({ results: arr(S({ id: str, category_id: str, confidence: enm('alta', 'media', 'baja') })) }),
    user: d => `Pagos: ${JSON.stringify(d.payments)}\nCategorías: ${JSON.stringify(d.categories)}\nEjemplos anteriores: ${JSON.stringify(d.examples || [])}`
  },
  ideas: {
    effort: 'low', maxTokens: 8000,
    system: `${PERSONA}
Eres su nutriólogo. Propón exactamente 3 ideas de comida saludables y fáciles para el tiempo de comida indicado, que le ayuden a cumplir lo que le falta del día (sobre todo proteína) sin pasarse de calorías.
Reglas: NUNCA pescado ni mariscos (ni atún, salmón, camarón, surimi, etc.) — no le gustan. Ingredientes fáciles de conseguir en México. No repitas lo que comió los últimos días. Porciones para 1 persona.
Macros aproximados por porción, coherentes con kcal ≈ 4·P + 4·C + 9·G. "why" en una frase: por qué le conviene hoy.`,
    schema: S({ ideas: arr(S({ name: str, slot: enm('desayuno', 'comida', 'cena', 'snack'), mins: int, kcal: int, protein_g: num, carbs_g: num, fat_g: num, why: str, ingredients: arr(str), steps: arr(str) })) }),
    user: d => `Tiempo de comida: ${d.slot}\nLe falta hoy: ${JSON.stringify(d.remaining)}\nMetas diarias: ${JSON.stringify(d.goals)}\nComió los últimos días: ${(d.recent || []).join('; ') || 'sin registro'}`
  },
  semana: {
    effort: 'low', maxTokens: 6000,
    system: `${PERSONA}
Escribes su resumen semanal a partir de sus números (tareas, hábitos, entrenos, sueño y recuperación de Whoop, comida y gastos).
Da: un título corto (máx. 60 caracteres), 2–4 logros o datos destacados con números concretos, 2–3 cosas a mejorar la próxima semana (concretas y realistas) y un enfoque de una frase. Si falta un área (por ejemplo sin Whoop o sin comidas registradas), no la inventes: ignórala.`,
    schema: S({ title: str, highlights: arr(str), improvements: arr(str), focus: str }),
    user: d => `Números de la semana (JSON):\n${JSON.stringify(d.stats)}`
  }
};

// Validación y recorte de lo que manda la app (evita payloads enormes o raros).
export function validate(action, body) {
  const a = ACTIONS[action];
  if (!a) return 'acción desconocida';
  const size = JSON.stringify(body).length;
  if (action === 'estado') {
    if (typeof body.pdf !== 'string' || body.pdf.length < 100) return 'Falta el PDF';
    if (body.pdf.length > 14_000_000) return 'El PDF es muy grande (máx. ~10 MB)';
    if (!/^[A-Za-z0-9+/=]+$/.test(body.pdf.slice(0, 2000))) return 'El PDF no viene en base64';
    if (!body.account) return 'Elige la cuenta';
  } else if (size > 200_000) return 'Demasiados datos';
  if (action === 'gym' && !body.data) return 'Faltan datos de entrenamiento';
  if (action === 'categorias' && !(Array.isArray(body.payments) && body.payments.length)) return 'No hay pagos para clasificar';
  if (action === 'categorias' && body.payments.length > 60) return 'Máximo 60 pagos a la vez';
  if (action === 'ideas' && !body.slot) return 'Falta el tiempo de comida';
  if (action === 'semana' && !body.stats) return 'Faltan los números de la semana';
  return '';
}

// Ajustes finales: no confiar ciegamente en el modelo.
const FISH = /pescado|at[uú]n|salm[oó]n|tilapia|camar[oó]n|marisc|surimi|sardina|pulpo|calamar|mojarra|bacalao|jaiba|ostion|anchoa/i;
export function finish(action, out) {
  if (action === 'ideas') {
    out.ideas = (out.ideas || []).filter(i => !FISH.test(`${i.name} ${(i.ingredients || []).join(' ')}`)).slice(0, 3);
    if (!out.ideas.length) throw new Error('sin ideas válidas');
  }
  if (action === 'estado') {
    out.transactions = (out.transactions || []).filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number(t.amount) > 0)
      .map(t => ({ ...t, amount: Math.round(Number(t.amount) * 100) / 100 }));
  }
  if (action === 'gym') {
    out.suggestions = (out.suggestions || []).slice(0, 6);
    if (!out.new_routine?.include && out.new_routine) out.new_routine.items = [];
  }
  return out;
}

async function sessionEmail(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? (u.email || '').toLowerCase() || u.id : null;
}

let clientPromise = null;
async function defaultClient() {
  if (!clientPromise) clientPromise = import('npm:@anthropic-ai/sdk').then(m => new m.default({ apiKey: env('ANTHROPIC_API_KEY') }));
  return clientPromise;
}

export async function run(action, body, client) {
  const a = ACTIONS[action];
  const c = client || await defaultClient();
  const params = {
    model: MODEL,
    max_tokens: a.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: a.effort, format: { type: 'json_schema', schema: a.schema } },
    system: a.system,
    messages: [{ role: 'user', content: a.user(body) }]
  };
  // Las respuestas largas (estado de cuenta) van con streaming para no topar con timeouts del SDK.
  const res = a.stream ? await c.beta.messages.stream(params).finalMessage() : await c.beta.messages.create(params);
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('Claude no pudo procesar esta solicitud.'), { userFacing: true });
  if (res.stop_reason === 'max_tokens') throw Object.assign(new Error('La respuesta salió demasiado larga. Prueba con menos datos (por ejemplo un estado de cuenta más corto).'), { userFacing: true });
  const block = (res.content || []).find(b => b.type === 'text');
  if (!block) throw new Error('sin texto en la respuesta');
  return finish(action, JSON.parse(block.text));
}

export async function handler(req, deps = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);
  if (!env('ANTHROPIC_API_KEY') && !deps.client) return json({ error: 'Falta el secret ANTHROPIC_API_KEY en Supabase' }, 500);
  const who = await (deps.sessionEmail || sessionEmail)(req);
  if (!who) return json({ error: 'sin sesión' }, 401);
  const allowed = env('ALLOWED_EMAILS').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(who)) return json({ error: 'Este usuario no tiene permiso para usar el asistente' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'cuerpo inválido' }, 400); }
  const action = String(body.action || '');
  const bad = validate(action, body);
  if (bad) return json({ error: bad }, 400);

  try { return json(await run(action, body, deps.client)); }
  catch (e) {
    console.error('asistente', action, e);
    if (!e.userFacing && !(e && e.status) && action !== 'estado') { // un reintento si regresó algo inválido
      try { return json(await run(action, body, deps.client)); } catch (e2) { console.error('asistente reintento', e2); }
    }
    const status = e && e.status === 429 ? 429 : 502;
    return json({ error: e.userFacing ? e.message : status === 429 ? 'Muchas solicitudes; intenta en un momento' : 'No se pudo completar. Intenta de nuevo.' }, status);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(req => handler(req));
