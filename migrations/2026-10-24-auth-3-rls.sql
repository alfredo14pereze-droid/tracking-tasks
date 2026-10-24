-- Auth paso 3: cerrar el acceso por usuario.
-- Correr SOLO después del backfill (paso 2) con todas las filas "sin_dueno" en 0.
-- A partir de aquí, sin sesión la API no devuelve ni acepta nada.

do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks','subtasks','projects','goals','habits','habit_weeks',
    'reminders','notes','quick_tasks',
    'accounts','categories','transactions','budgets','money_goals','balance_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "public access" on public.%I', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated '
      'using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Verificación: cada tabla debe tener solo la política "own rows".
-- Si aparece otra política abierta (con otro nombre), avísame antes de borrarla.
select tablename, policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
