-- Finanzas v2: fondos de inversión, fuentes de ingreso, recurrentes, tarjeta y supuestos.
-- Solo crea tablas nuevas; no toca datos existentes. Se puede correr más de una vez.
-- Ninguna columna guarda número de cuenta, CLABE, RFC, CURP ni domicilio.
-- Los datos (sueldo, YouTube, Claude, BBVA 17/16…) NO van aquí: los captura el asistente de la app.

-- 1) Fondos (GBM). Una fila por (fondo, origen): un mismo fondo puede tener parte heredada y parte propia.
create table if not exists public.investment_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,     -- cuenta donde vive (GBM)
  fund_name text not null,
  fund_key text,                                                          -- clave del fondo en GBM
  origin text not null default 'heredado' check (origin in ('heredado','propio')),
  cost_basis_cents bigint not null default 0 check (cost_basis_cents >= 0), -- lo aportado en total
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, fund_name, origin)
);

-- 2) Valor de cada fondo por mes (día 1 del mes).
create table if not exists public.position_valuations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position_id uuid not null references public.investment_positions(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  value_cents bigint not null check (value_cents >= 0),
  created_at timestamptz not null default now(),
  unique (position_id, month)
);

-- 3) Fuentes de ingreso.
create table if not exists public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  frequency text not null check (frequency in ('semanal','quincenal','mensual','irregular')),
  counts_for_budget boolean not null default true,      -- true = ingreso base para presupuesto
  pay_weekday smallint check (pay_weekday between 0 and 6),  -- semanal: 0=domingo … 6=sábado
  pay_day smallint check (pay_day between 1 and 31),         -- mensual/quincenal: día esperado
  account_id uuid references public.accounts(id) on delete set null,   -- cuenta donde suele llegar
  category_id uuid references public.categories(id) on delete set null, -- categoría de ingreso al registrarlo
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 4) Gastos fijos y suscripciones.
create table if not exists public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  day_of_month smallint check (day_of_month between 1 and 31),   -- null = por confirmar
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  kind text not null default 'suscripcion' check (kind in ('suscripcion','pago_tarjeta','otro')),
  paused boolean not null default false,
  created_at timestamptz not null default now()
);

-- 5) Datos de tarjetas de crédito (una fila por cuenta de crédito).
create table if not exists public.card_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  credit_limit_cents bigint not null default 0 check (credit_limit_cents >= 0),
  cut_day smallint not null check (cut_day between 1 and 31),
  pay_day smallint not null check (pay_day between 1 and 31),
  updated_at timestamptz not null default now()
);

-- 6) Supuestos y ajustes (inflation, expected_return, retirement_age, years_to_retirement, savings_rate…).
create table if not exists public.assumptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  value numeric,                 -- null = no lo sabe todavía
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

-- RLS: cada quien solo ve y cambia sus filas.
do $$
declare t text;
begin
  foreach t in array array['investment_positions','position_valuations','income_sources','recurring_items','card_settings','assumptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_id_idx', t);
  end loop;
end $$;

-- Verificación: deben salir 6 tablas, cada una con rls = true y la política "own rows".
select c.relname as tabla, c.relrowsecurity as rls,
       (select string_agg(policyname, ', ') from pg_policies p where p.tablename = c.relname and p.schemaname = 'public') as politicas
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('investment_positions','position_valuations','income_sources','recurring_items','card_settings','assumptions')
order by 1;
