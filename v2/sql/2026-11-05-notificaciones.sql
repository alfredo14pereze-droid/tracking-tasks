-- v2 · Notificaciones push (iPhone con la app instalada, iOS 16.4+).
-- Crea 3 tablas nuevas y programa la revisión cada 5 minutos. No cambia tablas existentes.
-- Se puede correr más de una vez.
--
-- ANTES de correrlo: cambia PON_AQUI_EL_CRON_SECRET (abajo, en cron.schedule) por el mismo valor que
-- guardaste en el secret CRON_SECRET de las Edge Functions. Claude te da este archivo ya lleno en el
-- portapapeles; esta copia del repo NO lleva el secreto a propósito.

-- 1) Dónde mandar: una fila por dispositivo (lo que regresa pushManager.subscribe).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

-- 2) Qué avisos quieres.
create table if not exists public.push_prefs (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  reminders boolean not null default true,    -- recordatorios a su hora
  tasks boolean not null default true,        -- tareas con hora: 10 min antes
  cards boolean not null default true,        -- pago de tarjeta: 3 días y 1 día antes (9:00)
  morning boolean not null default true,      -- resumen de la mañana
  morning_time time not null default '08:00',
  updated_at timestamptz not null default now()
);

-- 3) Bitácora de lo enviado (para no mandar dos veces lo mismo). Solo la escribe la función.
create table if not exists public.push_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  title text,
  sent_at timestamptz not null default now(),
  unique (user_id, key)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_prefs enable row level security;
alter table public.push_log enable row level security;
drop policy if exists "own rows" on public.push_subscriptions;
create policy "own rows" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own rows" on public.push_prefs;
create policy "own rows" on public.push_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own rows read" on public.push_log;
create policy "own rows read" on public.push_log for select to authenticated using (user_id = auth.uid());

-- 4) Revisión cada 5 minutos: pg_cron llama a la Edge Function "notificaciones" con un secreto.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'tasktracker-notificaciones';
select cron.schedule('tasktracker-notificaciones', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://citlxgjcshjckxybgist.supabase.co/functions/v1/notificaciones',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PON_AQUI_EL_CRON_SECRET'),
    body := '{"mode":"cron"}'::jsonb,
    timeout_milliseconds := 20000
  );
$job$);

-- Verificación: 3 tablas con su política y 1 tarea programada.
select 'tabla' as que, tablename as nombre, policyname as detalle from pg_policies
where schemaname = 'public' and tablename in ('push_subscriptions', 'push_prefs', 'push_log')
union all
select 'cron', jobname, schedule from cron.job where jobname = 'tasktracker-notificaciones';
