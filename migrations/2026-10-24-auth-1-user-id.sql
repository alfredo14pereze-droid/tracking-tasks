-- Auth paso 1: columna user_id en todas las tablas.
-- Correr ANTES de desplegar el login. No cambia permisos: "public access" sigue activa.
-- Las filas existentes quedan con user_id = null hasta el backfill (paso 2).

do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks','subtasks','projects','goals','habits','habit_weeks',
    'reminders','notes','quick_tasks',
    'accounts','categories','transactions','budgets','money_goals','balance_snapshots'
  ] loop
    execute format(
      'alter table public.%I add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid()', t);
    execute format(
      'create index if not exists %I on public.%I (user_id)', t || '_user_id_idx', t);
  end loop;
end $$;

-- Verificación: debe listar 15 tablas.
select table_name
from information_schema.columns
where table_schema = 'public' and column_name = 'user_id'
order by table_name;
