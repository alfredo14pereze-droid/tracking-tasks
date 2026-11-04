// Edge Function "whoop" — conecta Whoop (OAuth 2.0) y sincroniza datos a whoop_daily / whoop_workouts.
//
// Rutas (todas bajo https://<proyecto>.supabase.co/functions/v1/whoop):
//   POST /start       (sesión del usuario) → { url } para autorizar en Whoop
//   GET  /callback    (redirige Whoop)     → guarda tokens, sincroniza 30 días y regresa a la app
//   POST /sync        (sesión del usuario) → sincroniza los últimos días
//   POST /sync        (header x-cron-secret) → sincroniza a todos los usuarios conectados
//   POST /disconnect  (sesión del usuario) → borra tokens
//
// Secrets (Supabase › Edge Functions › Secrets): WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, APP_URL,
// y opcional CRON_SECRET. SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen incluidos.
// "Verify JWT" debe estar APAGADO (Whoop llama /callback sin sesión); la función valida la sesión sola.
//
// Escrito como JavaScript válido (sin tipos) para poder probar la lógica con Node.

const WHOOP_AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API = 'https://api.prod.whoop.com/developer/v2';
const SCOPES = 'offline read:recovery read:cycles read:sleep read:workout';
const TZ = 'America/Monterrey';

const env = k => (typeof Deno !== 'undefined' ? Deno.env.get(k) : globalThis.process?.env?.[k]) || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Fechas ──────────────────────────────────────────────
// Fecha local (Monterrey) de un instante.
export function localDay(iso, offsetHours = 0) {
  const d = new Date(new Date(iso).getTime() + offsetHours * 3600e3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
// Un ciclo de Whoop empieza al dormir (de noche) o al despertar: +12 h lo deja en el día que se vive.
export const cycleDay = c => localDay(c.start, 12);

// ── Mapeo de respuestas de Whoop a filas ───────────────
export function buildDaily(userId, cycles, recoveries, sleeps) {
  const byCycle = new Map();
  for (const c of cycles) {
    const s = c.score_state === 'SCORED' ? c.score || {} : {};
    byCycle.set(c.id, {
      user_id: userId, day: cycleDay(c), cycle_id: c.id,
      strain: s.strain != null ? Math.round(s.strain * 10) / 10 : null,
      kilojoule: s.kilojoule ?? null,
      avg_hr: s.average_heart_rate ?? null,
      steps: c.step_count ?? null,
      recovery_score: null, hrv_ms: null, rhr: null, sleep_minutes: null, sleep_performance: null
    });
  }
  for (const r of recoveries) {
    const row = byCycle.get(r.cycle_id);
    if (!row || r.score_state !== 'SCORED' || !r.score) continue;
    row.recovery_score = r.score.recovery_score ?? null;
    row.hrv_ms = r.score.hrv_rmssd_milli != null ? Math.round(r.score.hrv_rmssd_milli * 10) / 10 : null;
    row.rhr = r.score.resting_heart_rate ?? null;
  }
  for (const s of sleeps) {
    if (s.nap) continue;
    const row = byCycle.get(s.cycle_id);
    if (!row || s.score_state !== 'SCORED' || !s.score) continue;
    const st = s.score.stage_summary || {};
    const asleep = (st.total_in_bed_time_milli || 0) - (st.total_awake_time_milli || 0);
    row.sleep_minutes = asleep > 0 ? Math.round(asleep / 60000) : null;
    row.sleep_performance = s.score.sleep_performance_percentage != null ? Math.round(s.score.sleep_performance_percentage) : null;
  }
  // Si dos ciclos caen en el mismo día (siesta larga, viaje), se queda el de más strain.
  const byDay = new Map();
  for (const row of byCycle.values()) {
    const prev = byDay.get(row.day);
    if (!prev || (row.strain ?? -1) > (prev.strain ?? -1)) byDay.set(row.day, row);
  }
  const now = new Date().toISOString();
  return [...byDay.values()].map(r => ({ ...r, updated_at: now }));
}

const tzHours = off => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(off || '');
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60) : 0;
};

export function buildWorkouts(userId, workouts) {
  const now = new Date().toISOString();
  return workouts.map(w => {
    const s = w.score_state === 'SCORED' ? w.score || {} : {};
    const z = s.zone_durations || {};
    const active = ['zone_two_milli', 'zone_three_milli', 'zone_four_milli', 'zone_five_milli']
      .reduce((a, k) => a + (z[k] || 0), 0);
    const mins = w.end ? Math.round((new Date(w.end) - new Date(w.start)) / 60000) : null;
    return {
      id: String(w.id), user_id: userId, day: localDay(w.start),
      started_at: w.start, ended_at: w.end || null, sport_name: w.sport_name || null,
      strain: s.strain != null ? Math.round(s.strain * 10) / 10 : null,
      avg_hr: s.average_heart_rate ?? null, max_hr: s.max_heart_rate ?? null,
      kilojoule: s.kilojoule ?? null, minutes: mins,
      active_minutes: active ? Math.round(active / 60000) : null,
      updated_at: now
    };
  });
}

// ── Supabase (REST con service role) ──────────────────
async function db(method, path, body, prefer) {
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: env('SUPABASE_SERVICE_ROLE_KEY'),
      Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY'),
      'Content-Type': 'application/json',
      Prefer: prefer || 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(`db ${method} ${path.split('?')[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const upsert = (table, rows, onConflict) => rows.length
  ? db('POST', `${table}?on_conflict=${onConflict}`, rows, 'resolution=merge-duplicates,return=minimal')
  : null;

// Usuario de la sesión (token de Supabase en Authorization).
async function sessionUser(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: auth }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u.id : null;
}

// ── Whoop ───────────────────────────────────────────────
async function tokenRequest(params) {
  const r = await fetch(WHOOP_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('WHOOP_CLIENT_ID'), client_secret: env('WHOOP_CLIENT_SECRET'), ...params })
  });
  if (!r.ok) throw new Error(`whoop token ${r.status}: ${await r.text()}`);
  return r.json();
}

async function saveTokens(userId, t) {
  await upsert('whoop_tokens', [{
    user_id: userId, access_token: t.access_token, refresh_token: t.refresh_token || null,
    expires_at: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000).toISOString(),
    scope: t.scope || null, updated_at: new Date().toISOString()
  }], 'user_id');
}

// Token vigente (lo renueva si vence en menos de 2 minutos).
async function accessToken(userId) {
  const [row] = await db('GET', `whoop_tokens?user_id=eq.${userId}&select=*`);
  if (!row) throw new Error('Whoop no está conectado');
  if (new Date(row.expires_at).getTime() - Date.now() > 120e3) return row.access_token;
  if (!row.refresh_token) throw new Error('El token de Whoop venció; vuelve a conectar');
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token, scope: 'offline' });
  await saveTokens(userId, t);
  return t.access_token;
}

async function collection(token, path, startIso) {
  const out = [];
  let next = '';
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ limit: '25', start: startIso });
    if (next) q.set('nextToken', next);
    const r = await fetch(`${WHOOP_API}/${path}?${q}`, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error(`whoop ${path} ${r.status}: ${await r.text()}`);
    const j = await r.json();
    out.push(...(j.records || []));
    next = j.next_token || '';
    if (!next) break;
  }
  return out;
}

export async function syncUser(userId, days) {
  try {
    const token = await accessToken(userId);
    const start = new Date(Date.now() - days * 86400e3).toISOString();
    const [cycles, recoveries, sleeps, workouts] = await Promise.all([
      collection(token, 'cycle', start),
      collection(token, 'recovery', start),
      collection(token, 'activity/sleep', start),
      collection(token, 'activity/workout', start)
    ]);
    const daily = buildDaily(userId, cycles, recoveries, sleeps);
    const wks = buildWorkouts(userId, workouts);
    await upsert('whoop_daily', daily, 'user_id,day');
    await upsert('whoop_workouts', wks, 'id');
    await upsert('whoop_status', [{ user_id: userId, connected: true, last_sync_at: new Date().toISOString(), last_error: null }], 'user_id');
    return { ok: true, days: daily.length, workouts: wks.length };
  } catch (e) {
    await upsert('whoop_status', [{ user_id: userId, last_error: String(e.message || e).slice(0, 300) }], 'user_id').catch(() => {});
    return { ok: false, error: String(e.message || e) };
  }
}

function randomState() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map(x => a[x % a.length]).join(''); // Whoop pide state de 8 caracteres
}

const appUrl = suffix => (env('APP_URL') || 'https://alfredo14pereze-droid.github.io/tracking-tasks/v2/') + suffix;
const redirect = to => new Response(null, { status: 302, headers: { Location: to } });

export async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || url.pathname.split('/').filter(Boolean).pop();
  const callbackUrl = `${env('SUPABASE_URL')}/functions/v1/whoop/callback`;

  try {
    if (action === 'callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) return redirect(appUrl('#salud?whoop=cancelado'));
      const rows = await db('DELETE', `whoop_oauth_states?state=eq.${encodeURIComponent(state)}`);
      const st = rows && rows[0];
      if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60e3) return redirect(appUrl('#salud?whoop=vencido'));
      const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl });
      await saveTokens(st.user_id, t);
      await upsert('whoop_status', [{ user_id: st.user_id, connected: true, connected_at: new Date().toISOString(), last_error: null }], 'user_id');
      const res = await syncUser(st.user_id, 30);
      return redirect(appUrl(res.ok ? '#salud?whoop=ok' : '#salud?whoop=error'));
    }

    if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);

    if (action === 'sync' && env('CRON_SECRET') && req.headers.get('x-cron-secret') === env('CRON_SECRET')) {
      const users = await db('GET', 'whoop_tokens?select=user_id');
      const results = [];
      for (const u of users) results.push(await syncUser(u.user_id, 3));
      return json({ ok: true, users: results.length });
    }

    const userId = await sessionUser(req);
    if (!userId) return json({ error: 'sin sesión' }, 401);

    if (action === 'start') {
      if (!env('WHOOP_CLIENT_ID')) return json({ error: 'Falta el secret WHOOP_CLIENT_ID' }, 500);
      await db('DELETE', `whoop_oauth_states?created_at=lt.${new Date(Date.now() - 3600e3).toISOString()}`, null, 'return=minimal');
      const state = randomState();
      await db('POST', 'whoop_oauth_states', { state, user_id: userId }, 'return=minimal');
      const q = new URLSearchParams({ response_type: 'code', client_id: env('WHOOP_CLIENT_ID'), redirect_uri: callbackUrl, scope: SCOPES, state });
      return json({ url: `${WHOOP_AUTH}?${q}` });
    }
    if (action === 'sync') {
      let days = 7;
      try { days = Math.min(30, Math.max(1, Number((await req.json()).days) || 7)); } catch { /* sin cuerpo */ }
      const res = await syncUser(userId, days);
      return json(res, res.ok ? 200 : 502);
    }
    if (action === 'disconnect') {
      await db('DELETE', `whoop_tokens?user_id=eq.${userId}`, null, 'return=minimal');
      await upsert('whoop_status', [{ user_id: userId, connected: false, last_error: null }], 'user_id');
      return json({ ok: true });
    }
    return json({ error: 'acción desconocida' }, 404);
  } catch (e) {
    console.error(e);
    if (action === 'callback') return redirect(appUrl('#salud?whoop=error'));
    return json({ error: String(e.message || e) }, 500);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(handler);
