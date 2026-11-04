-- v2 · Fase 3: Ejercicio + metas de actividad + Whoop.
-- Solo CREA tablas nuevas. No toca ninguna tabla existente. Se puede correr más de una vez.
-- Las rutinas base y el catálogo de ejercicios NO van aquí: la app los crea con tu sesión
-- (botón "Crear rutinas base"), porque desde el SQL Editor no hay auth.uid().

-- ── Ejercicio ─────────────────────────────────────────────
create table if not exists public.ex_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  muscle text not null default 'otro',      -- pecho, espalda, pierna, hombro, brazo, core, cardio, otro
  equipment text,                           -- barra, mancuerna, máquina, polea, peso corporal…
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.ex_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  tag text not null default 'otro' check (tag in ('push','pull','pierna','full','cardio','otro')),
  position int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Cada "lugar" de la rutina (p. ej. "press horizontal") con sus series/reps meta.
create table if not exists public.ex_routine_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id uuid not null references public.ex_routines(id) on delete cascade,
  position int not null default 0,
  sets int not null default 3 check (sets between 1 and 10),
  reps_min int not null default 8 check (reps_min between 1 and 100),
  reps_max int not null default 10 check (reps_max between 1 and 100),
  rest_sec int not null default 90 check (rest_sec between 0 and 900),
  created_at timestamptz not null default now(),
  check (reps_max >= reps_min)
);

-- Opciones de ejercicio para cada lugar: la de position 0 es la principal; al entrenar eliges cualquiera.
create table if not exists public.ex_item_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.ex_routine_items(id) on delete cascade,
  exercise_id uuid not null references public.ex_exercises(id) on delete cascade,
  position int not null default 0,
  unique (item_id, exercise_id)
);

create table if not exists public.ex_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id uuid references public.ex_routines(id) on delete set null,
  name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists ex_workouts_user_started on public.ex_workouts (user_id, started_at desc);

create table if not exists public.ex_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_id uuid not null references public.ex_workouts(id) on delete cascade,
  item_id uuid references public.ex_routine_items(id) on delete set null,
  exercise_id uuid not null references public.ex_exercises(id) on delete cascade,
  slot int not null default 0,              -- orden del ejercicio dentro del entreno
  set_index int not null default 1,
  weight_kg numeric(6,2) check (weight_kg >= 0),
  reps int check (reps >= 0),
  target_reps int,
  done boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists ex_sets_user_exercise on public.ex_sets (user_id, exercise_id, created_at desc);

create table if not exists public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_on date not null default current_date,
  weight_kg numeric(5,2) check (weight_kg > 0),
  body_fat_pct numeric(4,1) check (body_fat_pct between 0 and 80),
  waist_cm numeric(5,1) check (waist_cm > 0),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, measured_on)
);

-- Metas de actividad (semanales o diarias según la métrica).
create table if not exists public.activity_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  metric text not null check (metric in ('workouts_week','active_min_week','strain_day','steps_day','sleep_hours_day')),
  target numeric not null check (target >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, metric)
);

-- ── Whoop ────────────────────────────────────────────────
-- Tokens de Whoop: SOLO los usa la Edge Function (service role). Sin políticas = el navegador no los ve.
create table if not exists public.whoop_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  updated_at timestamptz not null default now()
);
-- "state" temporal del OAuth (10 min). Solo la Edge Function.
create table if not exists public.whoop_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Estado visible para la app (conectado, última sincronización, último error).
create table if not exists public.whoop_status (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  connected boolean not null default false,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_error text
);
-- Un renglón por día (día del ciclo de Whoop, hora de Monterrey).
create table if not exists public.whoop_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  cycle_id bigint,
  strain numeric(4,1),
  kilojoule numeric,
  avg_hr int,
  steps int,
  recovery_score int,
  hrv_ms numeric(6,1),
  rhr int,
  sleep_minutes int,
  sleep_performance int,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create table if not exists public.whoop_workouts (
  id text primary key,                      -- id del entreno en Whoop
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  sport_name text,
  strain numeric(4,1),
  avg_hr int,
  max_hr int,
  kilojoule numeric,
  minutes int,
  active_minutes int,                       -- minutos en zonas 2–5
  updated_at timestamptz not null default now()
);
create index if not exists whoop_workouts_user_day on public.whoop_workouts (user_id, day desc);

-- ── RLS ──────────────────────────────────────────────────
do $$
declare t text;
begin
  -- Lectura y escritura de tus propias filas.
  foreach t in array array['ex_exercises','ex_routines','ex_routine_items','ex_item_options',
                           'ex_workouts','ex_sets','body_metrics','activity_goals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated '
                   'using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
  -- Whoop: solo lectura desde la app; escribe la Edge Function.
  foreach t in array array['whoop_status','whoop_daily','whoop_workouts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows read" on public.%I', t);
    execute format('create policy "own rows read" on public.%I for select to authenticated '
                   'using (user_id = auth.uid())', t);
  end loop;
  -- Tokens y states: RLS sin políticas (nadie desde el navegador).
  alter table public.whoop_tokens enable row level security;
  alter table public.whoop_oauth_states enable row level security;
end $$;

-- Verificación: 13 tablas con su política (tokens y states salen con "sin política").
select c.relname as tabla,
       coalesce(string_agg(p.policyname, ', '), 'sin política (correcto solo en whoop_tokens y whoop_oauth_states)') as politicas,
       c.relrowsecurity as rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.relname in ('ex_exercises','ex_routines','ex_routine_items','ex_item_options','ex_workouts','ex_sets',
                    'body_metrics','activity_goals','whoop_tokens','whoop_oauth_states','whoop_status',
                    'whoop_daily','whoop_workouts')
group by c.relname, c.relrowsecurity
order by 1;
