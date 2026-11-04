-- v2 · Comidas (dieta): registro de comidas con macros, metas de dieta y más medidas corporales.
-- Crea 2 tablas nuevas y agrega columnas opcionales a body_metrics (tabla de v2, creada en
-- 2026-11-03-ejercicio-whoop.sql). No toca ninguna tabla de la versión clásica. Se puede correr más de una vez.

-- 1) Lo que comes: una fila por comida (o por alimento, si prefieres registrarlos por separado).
create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_on date not null default ((now() at time zone 'America/Monterrey')::date),
  slot text not null default 'comida' check (slot in ('desayuno','comida','cena','snack')),
  name text not null,
  kcal int not null default 0 check (kcal between 0 and 10000),
  protein_g numeric(6,1) not null default 0 check (protein_g >= 0),
  carbs_g numeric(6,1) not null default 0 check (carbs_g >= 0),
  fat_g numeric(6,1) not null default 0 check (fat_g >= 0),
  recipe_key text,                          -- si viene del recetario
  note text,
  created_at timestamptz not null default now()
);
create index if not exists meals_user_day on public.meals (user_id, eaten_on desc);

-- 2) Metas diarias de dieta.
create table if not exists public.diet_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  metric text not null check (metric in ('kcal','protein_g','carbs_g','fat_g','water_l')),
  target numeric not null check (target >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, metric)
);

-- 3) Más medidas en body_metrics (todas opcionales, en cm).
alter table public.body_metrics add column if not exists hip_cm numeric(5,1) check (hip_cm > 0);
alter table public.body_metrics add column if not exists chest_cm numeric(5,1) check (chest_cm > 0);
alter table public.body_metrics add column if not exists arm_cm numeric(5,1) check (arm_cm > 0);
alter table public.body_metrics add column if not exists thigh_cm numeric(5,1) check (thigh_cm > 0);

-- RLS: tus filas, como todo lo demás.
do $$
declare t text;
begin
  foreach t in array array['meals','diet_goals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated '
                   'using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Verificación: meals y diet_goals con "own rows", y las 4 columnas nuevas de body_metrics.
select 'tabla' as que, tablename as nombre, policyname as detalle
from pg_policies where schemaname = 'public' and tablename in ('meals','diet_goals')
union all
select 'columna', 'body_metrics', column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'body_metrics' and column_name in ('hip_cm','chest_cm','arm_cm','thigh_cm')
order by 1, 2, 3;
