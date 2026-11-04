// Edge Function "nutricion" — estima calorías y macros de una comida descrita en texto libre, con Claude.
// Si falta información que cambia mucho el estimado (tipo de pan, queso, cantidad), regresa hasta 3
// preguntas con opciones; con las respuestas (o en la 2.ª vuelta) siempre regresa el estimado.
//
// POST /functions/v1/nutricion  (con la sesión del usuario)
//   { text: "sándwich de jamón y queso", answers?: [{ question, answer }] }
// → { status: "questions", questions: [{ id, question, options[] }] }
// → { status: "estimate", title, items: [{ name, portion, kcal, protein_g, carbs_g, fat_g }], total, assumptions[] }
//
// Secrets: ANTHROPIC_API_KEY (obligatorio) y ALLOWED_EMAILS (opcional, separados por coma; si se pone, solo
// esos correos pueden usarla). SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen incluidos.
// "Verify JWT" puede quedarse ENCENDIDO (la app manda tu sesión).
// Escrito como JavaScript válido (sin tipos) para poder probar la lógica con Node.

const MODEL = 'claude-opus-5-5';
const env = k => (typeof Deno !== 'undefined' ? Deno.env.get(k) : globalThis.process?.env?.[k]) || '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export const SYSTEM = `Eres un nutriólogo que estima calorías y macronutrientes de comidas que una persona en Monterrey, México describe en español (escritas o dictadas, a veces con errores de dictado).

Tu trabajo: convertir la descripción en un estimado por alimento, en porciones típicas de México (tortillas de maíz de ~30 g, bolillo ~70 g, pan de caja ~28 g por rebanada, etc.), y sumar el total.

Cuándo preguntar: solo si un dato que no está en la descripción cambiaría el total más de ~15 % (por ejemplo tipo de pan, tipo de queso, cuánto aceite, tamaño o número de piezas, si la bebida tiene azúcar). Haz como máximo 3 preguntas, cortas, cada una con 2 a 5 opciones concretas en español (por ejemplo "Bolillo", "Pan de caja blanco", "Pan integral"). No preguntes lo que ya se puede suponer con razonable seguridad. Si la descripción ya es suficientemente clara, estima directo.

Si el mensaje dice que NO puedes preguntar más, estima siempre, usando las respuestas que haya y supuestos típicos para lo demás.

Al estimar: un renglón por alimento o ingrediente relevante (incluye aceites, aderezos y bebidas si se mencionan), con la porción que supusiste en texto ("2 rebanadas", "40 g", "1 cda"). kcal en enteros; proteína, carbohidratos y grasa en gramos con un decimal. Que las kcal de cada renglón sean coherentes con 4·proteína + 4·carbohidratos + 9·grasa (±10 %). En "assumptions" pon en una frase cada supuesto importante que hiciste. "title" es un nombre corto de la comida (máx. 60 caracteres) con mayúscula inicial.

Cuando status es "questions", deja items y assumptions vacíos; cuando es "estimate", deja questions vacío.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'title', 'questions', 'items', 'assumptions'],
  properties: {
    status: { type: 'string', enum: ['questions', 'estimate'] },
    title: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'question', 'options'],
        properties: { id: { type: 'string' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }
      }
    },
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'portion', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
        properties: {
          name: { type: 'string' }, portion: { type: 'string' },
          kcal: { type: 'integer' }, protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' }
        }
      }
    },
    assumptions: { type: 'array', items: { type: 'string' } }
  }
};

// Mensaje del usuario: descripción + respuestas. Con respuestas ya no se permiten más preguntas.
export function userMessage(text, answers) {
  const lines = [`Lo que comí: ${text}`];
  if (answers && answers.length) {
    lines.push('', 'Respuestas a tus preguntas:');
    for (const a of answers) lines.push(`- ${a.question}: ${a.answer || 'No sé (usa lo más típico)'}`);
    lines.push('', 'Ya NO puedes hacer más preguntas: da el estimado.');
  }
  return lines.join('\n');
}

const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
// Limpia y valida lo que regresó el modelo, y calcula el total.
export function normalize(out, mustEstimate) {
  if (!out || typeof out !== 'object') throw new Error('respuesta vacía');
  let status = out.status;
  if (mustEstimate && status === 'questions') throw new Error('el modelo volvió a preguntar');
  if (status === 'questions') {
    const qs = (out.questions || []).slice(0, 3).map((q, i) => ({
      id: String(q.id || 'q' + (i + 1)).slice(0, 20),
      question: String(q.question || '').slice(0, 160),
      options: (q.options || []).map(o => String(o).slice(0, 60)).filter(Boolean).slice(0, 5)
    })).filter(q => q.question);
    if (qs.length) return { status, questions: qs };
    status = 'estimate';
  }
  const items = (out.items || []).map(x => ({
    name: String(x.name || '').slice(0, 80), portion: String(x.portion || '').slice(0, 40),
    kcal: Math.max(0, Math.round(Number(x.kcal) || 0)),
    protein_g: Math.max(0, r1(x.protein_g)), carbs_g: Math.max(0, r1(x.carbs_g)), fat_g: Math.max(0, r1(x.fat_g))
  })).filter(x => x.name);
  if (!items.length) throw new Error('el estimado no trae alimentos');
  const total = items.reduce((t, x) => ({ kcal: t.kcal + x.kcal, protein_g: r1(t.protein_g + x.protein_g), carbs_g: r1(t.carbs_g + x.carbs_g), fat_g: r1(t.fat_g + x.fat_g) }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  if (total.kcal > 10000) throw new Error('estimado fuera de rango');
  return {
    status: 'estimate',
    title: String(out.title || '').trim().slice(0, 60) || items.map(x => x.name).join(', ').slice(0, 60),
    items, total,
    assumptions: (out.assumptions || []).map(s => String(s).slice(0, 200)).slice(0, 6)
  };
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
  // Solo en Deno (Supabase): el SDK oficial por especificador npm.
  if (!clientPromise) clientPromise = import('npm:@anthropic-ai/sdk').then(m => new m.default({ apiKey: env('ANTHROPIC_API_KEY') }));
  return clientPromise;
}

// Llama a Claude con salida JSON estructurada. client se inyecta en pruebas.
export async function estimate(text, answers, client) {
  const c = client || await defaultClient();
  const res = await c.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: userMessage(text, answers) }]
  });
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('No pude estimar esta comida. Intenta describirla de otra forma.'), { userFacing: true });
  if (res.stop_reason === 'max_tokens') throw new Error('respuesta cortada');
  const block = (res.content || []).find(b => b.type === 'text');
  if (!block) throw new Error('sin texto en la respuesta');
  return normalize(JSON.parse(block.text), !!(answers && answers.length));
}

export async function handler(req, deps = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);
  if (!env('ANTHROPIC_API_KEY') && !deps.client) return json({ error: 'Falta el secret ANTHROPIC_API_KEY en Supabase' }, 500);
  const who = await (deps.sessionEmail || sessionEmail)(req);
  if (!who) return json({ error: 'sin sesión' }, 401);
  const allowed = env('ALLOWED_EMAILS').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(who)) return json({ error: 'Este usuario no tiene permiso para usar la estimación' }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'cuerpo inválido' }, 400); }
  const text = String(body.text || '').trim();
  if (text.length < 2) return json({ error: 'Describe lo que comiste' }, 400);
  if (text.length > 1000) return json({ error: 'La descripción es muy larga (máx. 1000 caracteres)' }, 400);
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 3).map(a => ({ question: String(a.question || '').slice(0, 160), answer: String(a.answer || '').slice(0, 120) })) : [];

  try {
    return json(await estimate(text, answers, deps.client));
  } catch (e) {
    console.error('nutricion', e);
    // Un reintento si el modelo regresó algo inválido (JSON, preguntó de más, vacío).
    if (!e.userFacing && !(e && e.status)) {
      try { return json(await estimate(text, answers.length ? answers : [{ question: 'Detalles', answer: 'Usa lo más típico' }], deps.client)); }
      catch (e2) { console.error('nutricion reintento', e2); }
    }
    const status = e && e.status === 429 ? 429 : 502;
    return json({ error: e.userFacing ? e.message : status === 429 ? 'Muchas solicitudes; intenta en un momento' : 'No se pudo calcular el estimado' }, status);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(req => handler(req));
