// Cliente de Supabase para v2. Mismo proyecto y mismo login que v1:
// supabase-js guarda la sesión en localStorage con la misma clave, y como v2
// vive en el mismo origen (…github.io), si ya entraste en v1 aquí ya estás dentro.
// La anon key es pública por diseño; lo que protege los datos es el RLS "own rows".
const SUPABASE_URL = 'https://citlxgjcshjckxybgist.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdGx4Z2pjc2hqY2t4eWJnaXN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTIwNjgsImV4cCI6MjA5NjI2ODA2OH0.1TZuItOua2CZgbx_4UFTVC61R-luhpSFSvyhsa6u-M0';

// supabase-js (UMD) se carga en index.html antes que los módulos.
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
});

export class AuthError extends Error {}

async function api(method, table, body, query = '') {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new AuthError('Sesión expirada');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + session.access_token,
      Prefer: 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) throw new AuthError('Sesión expirada');
  if (!r.ok) throw new Error(await r.text());
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export const dbGet = (t, q) => api('GET', t, null, q || '');
export const dbPost = (t, b) => api('POST', t, b);
export const dbPatch = (t, b, q) => api('PATCH', t, b, q);
export const dbDelete = (t, q) => api('DELETE', t, null, q);

// Igual que v1: una tabla que falle no tumba el resto (la sesión vencida sí se propaga).
export async function safeGet(table, query) {
  try { return (await dbGet(table, query)) || []; }
  catch (e) { if (e instanceof AuthError) throw e; console.warn(table, e); return null; }
}
