-- v2 · Metas con aportación mensual: cada vez que tocas "Aparté este mes" se guarda una fila aquí
-- (meta, mes y monto) y la meta sube. Crea 1 tabla nueva. No cambia tablas existentes. Se puede correr más de una vez.

-- goal_id usa el mismo tipo que money_goals.id.
do $$
declare t text;
begin
  select format_type(atttypid, atttypmod) into t
  from pg_attribute where attrelid = 'public.money_goals'::regclass and attname = 'id';
  execute format('create table if not exists public.goal_contributions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    goal_id %s not null references public.money_goals(id) on delete cascade,
    month date not null,                 -- día 1 del mes
    amount_cents bigint not null check (amount_cents <> 0),  -- negativo = sacaste dinero de la meta
    created_at timestamptz not null default now()
  )', t);
end $$;
create index if not exists goal_contributions_goal_month on public.goal_contributions (goal_id, month);

alter table public.goal_contributions enable row level security;
drop policy if exists "own rows" on public.goal_contributions;
create policy "own rows" on public.goal_contributions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Verificación: debe salir la tabla con "own rows".
select tablename, policyname from pg_policies where schemaname = 'public' and tablename = 'goal_contributions';
