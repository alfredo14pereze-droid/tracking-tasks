// Edge Function "notificaciones" — manda notificaciones push (Web Push) a los dispositivos registrados.
//   POST { mode: "cron" }  con header x-cron-secret = CRON_SECRET  → revisa qué toca avisar (cada 5 min, pg_cron)
//   POST { mode: "test" }  con la sesión del usuario               → manda una notificación de prueba
// Avisos (hora de Monterrey): recordatorios a su hora · tareas con hora 10 min antes ·
// pago de tarjeta 3 días y 1 día antes (9:00) · resumen de la mañana (push_prefs.morning_time).
// Cada aviso se anota en push_log (user_id, key) para no repetirlo.
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…), CRON_SECRET.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen en Supabase. "Verify JWT" va APAGADO
// (el cron no manda sesión; la función valida el secreto o la sesión ella misma).
// Escrito como JavaScript válido (sin tipos) para poder probarlo con Node.

// .trim(): un salto de línea pegado por error en un secret no debe romper nada.
const env = k => ((typeof Deno !== 'undefined' ? Deno.env.get(k) : globalThis.process?.env?.[k]) || '').trim();
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const TZ = 'America/Monterrey';
const APP = 'https://alfredo14pereze-droid.github.io/tracking-tasks/v2/';
const WINDOW = 6; // minutos: el cron corre cada 5; push_log evita duplicados

// ── Fechas en Monterrey ─────────────────────────────────
export function localNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const toMin = t => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const inWindow = (target, now) => target !== null && target <= now && target > now - WINDOW;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayIn = (y, m, day) => { const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(day, len))).toISOString().slice(0, 10); };
const money = c => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format((Number(c) || 0) / 100);
const fmtDay = s => new Date(s + 'T12:00:00Z').toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');

// Corte más reciente (hoy cuenta) y la fecha límite de ese corte — igual que cardStatus de la app.
export function cardCycle(today, cutDay, payDay) {
  const [y, m] = today.split('-').map(Number);
  let cut = dayIn(y, m - 1, cutDay);
  if (cut > today) cut = dayIn(y, m - 2, cutDay);
  const [cy, cm] = cut.split('-').map(Number);
  let due = dayIn(cy, cm - 1, payDay);
  if (due <= cut) due = dayIn(cy, cm, payDay);
  return { cut, due };
}

// ── Base de datos (PostgREST con service role) ──────────
function restClient(fetcher = fetch) {
  const base = `${env('SUPABASE_URL')}/rest/v1/`, key = env('SUPABASE_SERVICE_ROLE_KEY');
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  return {
    get: async (table, q) => { const r = await fetcher(base + table + q, { headers: h }); if (!r.ok) throw new Error(`${table}: ${r.status}`); return r.json(); },
    // Inserta en push_log; regresa true solo si la fila es nueva (si ya existía, no se vuelve a mandar).
    claim: async (row) => {
      const r = await fetcher(base + 'push_log?on_conflict=user_id,key', { method: 'POST', headers: { ...h, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(row) });
      if (!r.ok) throw new Error(`push_log: ${r.status}`);
      return (await r.json()).length > 0;
    },
    del: (table, q) => fetcher(base + table + q, { method: 'DELETE', headers: h }),
    patch: (table, q, body) => fetcher(base + table + q, { method: 'PATCH', headers: h, body: JSON.stringify(body) })
  };
}

// ── Qué toca avisar a un usuario ahora ──────────────────
export async function dueFor(db, user, prefs, now) {
  const out = [];
  const P = { reminders: true, tasks: true, cards: true, morning: true, morning_time: '08:00', ...(prefs || {}) };
  const today = now.date;
  if (P.reminders) {
    const rs = await db.get('reminders', `?user_id=eq.${user}&status=neq.done&remind_date=eq.${today}&remind_time=not.is.null&select=id,title,remind_time`);
    for (const r of rs) if (inWindow(toMin(r.remind_time), now.min))
      out.push({ key: `rem:${r.id}:${today}`, title: '🔔 Recordatorio', body: r.title, url: APP + '#recordatorios' });
  }
  if (P.tasks) {
    const ts = await db.get('tasks', `?user_id=eq.${user}&due_date=eq.${today}&due_time=not.is.null&status=in.(todo,in_progress)&select=id,title,due_time`);
    for (const t of ts) { const m = toMin(t.due_time); if (m !== null && inWindow(m - 10, now.min))
      out.push({ key: `task:${t.id}:${today}`, title: `⏰ En 10 min · ${String(t.due_time).slice(0, 5)}`, body: t.title, url: APP + '#tareas' }); }
  }
  if (P.morning && inWindow(toMin(P.morning_time), now.min)) {
    const [ts, rs, rts, ws] = await Promise.all([
      db.get('tasks', `?user_id=eq.${user}&due_date=eq.${today}&status=in.(todo,in_progress)&select=id`),
      db.get('reminders', `?user_id=eq.${user}&status=neq.done&remind_date=eq.${today}&select=id`),
      db.get('ex_routines', `?user_id=eq.${user}&archived=eq.false&order=position.asc&select=id,name`).catch(() => []),
      db.get('ex_workouts', `?user_id=eq.${user}&finished_at=not.is.null&order=started_at.desc&limit=1&select=routine_id`).catch(() => [])
    ]);
    let next = null;
    if (rts.length) { const i = rts.findIndex(r => r.id === ws[0]?.routine_id); next = rts[(i + 1) % rts.length]?.name || rts[0].name; }
    const bits = [`${ts.length} tarea${ts.length === 1 ? '' : 's'}`, rs.length ? `${rs.length} recordatorio${rs.length === 1 ? '' : 's'}` : '', next ? `toca ${next}` : ''].filter(Boolean);
    out.push({ key: `morning:${today}`, title: '☀️ Buenos días', body: `Hoy: ${bits.join(' · ')}`, url: APP + '#inicio' });
  }
  if (P.cards && inWindow(9 * 60, now.min)) {
    const [cards, accs] = await Promise.all([
      db.get('card_settings', `?user_id=eq.${user}&select=*`),
      db.get('accounts', `?user_id=eq.${user}&kind=eq.credit&archived=eq.false&select=id,name,opening_balance_cents`)
    ]);
    for (const a of accs) {
      const c = cards.find(x => x.account_id === a.id); if (!c) continue;
      const { cut, due } = cardCycle(today, c.cut_day, c.pay_day);
      const left = Math.round((new Date(due + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 864e5);
      if (left !== 3 && left !== 1) continue;
      const tx = await db.get('transactions', `?or=(account_id.eq.${a.id},to_account_id.eq.${a.id})&select=type,amount_cents,account_id,to_account_id,occurred_on`);
      let atCut = Number(a.opening_balance_cents) || 0, paid = 0;
      for (const t of tx) {
        const v = Number(t.amount_cents) || 0;
        const eff = t.account_id === a.id ? (t.type === 'income' ? v : -v) : (t.type === 'transfer' && t.to_account_id === a.id ? v : 0);
        if (t.occurred_on <= cut) atCut += eff;
        else if ((t.type === 'transfer' && t.to_account_id === a.id) || (t.type === 'income' && t.account_id === a.id)) paid += v;
      }
      const statement = c.statement_cut_on === cut && c.statement_due_cents != null ? Number(c.statement_due_cents) : Math.max(0, -atCut);
      const toPay = statement - paid;
      if (toPay <= 0) continue;
      out.push({ key: `card:${a.id}:${due}:${left}`, title: `💳 Pago de ${a.name} ${left === 1 ? 'mañana' : 'en 3 días'}`, body: `Paga ${money(toPay)} antes del ${fmtDay(due)} para no generar intereses.`, url: APP + '#finanzas' });
    }
  }
  return out;
}

// ── Envío ───────────────────────────────────────────────
let wpPromise = null;
async function defaultSender() {
  if (!wpPromise) wpPromise = import('npm:web-push@3.6.7').then(m => {
    const wp = m.default || m;
    wp.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
    return wp;
  });
  const wp = await wpPromise;
  return (sub, payload) => wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
}

async function deliver(db, send, subs, msg) {
  let ok = 0;
  for (const s of subs) {
    try { await send(s, { title: msg.title, body: msg.body, url: msg.url, tag: msg.key }); ok++; await db.patch('push_subscriptions', `?id=eq.${s.id}`, { last_ok_at: new Date().toISOString() }); }
    catch (e) {
      const code = e?.statusCode || e?.status;
      if (code === 404 || code === 410) await db.del('push_subscriptions', `?id=eq.${s.id}`); // el dispositivo ya no existe
      else console.error('push', code, e?.body || e?.message);
    }
  }
  return ok;
}

export async function runCron(db, send, now = localNow()) {
  const subs = await db.get('push_subscriptions', '?select=id,user_id,endpoint,p256dh,auth');
  const users = [...new Set(subs.map(s => s.user_id))];
  const prefs = users.length ? await db.get('push_prefs', `?user_id=in.(${users.join(',')})`) : [];
  let sent = 0;
  for (const u of users) {
    const msgs = await dueFor(db, u, prefs.find(p => p.user_id === u), now);
    for (const m of msgs) {
      if (!(await db.claim({ user_id: u, key: m.key, title: m.title }))) continue;
      sent += await deliver(db, send, subs.filter(s => s.user_id === u), m);
    }
  }
  return { ok: true, users: users.length, sent };
}

async function sessionUser(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u.id : null;
}

export async function handler(req, deps = {}) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);
  if (!deps.send && !(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'))) return json({ error: 'Faltan los secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY' }, 500);
  let body = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const db = deps.db || restClient();
  try {
    if (body.mode === 'cron') {
      const secret = env('CRON_SECRET');
      if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'no autorizado' }, 401);
      return json(await runCron(db, deps.send || await defaultSender(), deps.now));
    }
    if (body.mode === 'test') {
      const user = await (deps.sessionUser || sessionUser)(req);
      if (!user) return json({ error: 'sin sesión' }, 401);
      const subs = await db.get('push_subscriptions', `?user_id=eq.${user}&select=id,user_id,endpoint,p256dh,auth`);
      if (!subs.length) return json({ error: 'Este usuario no tiene dispositivos registrados' }, 400);
      const sent = await deliver(db, deps.send || await defaultSender(), subs, { key: 'test', title: '✅ Notificaciones listas', body: 'Así te van a llegar tus recordatorios, tareas y pagos.', url: APP });
      return json({ ok: sent > 0, sent, devices: subs.length });
    }
    return json({ error: 'modo desconocido' }, 400);
  } catch (e) {
    console.error('notificaciones', e);
    return json({ error: 'No se pudo completar' }, 502);
  }
}

if (typeof Deno !== 'undefined') Deno.serve(req => handler(req));
