-- Auth paso 2: asignar las filas existentes al único usuario.
-- Correr DESPUÉS de iniciar sesión por primera vez con el enlace mágico.
-- Se niega a correr si en auth.users no hay exactamente 1 usuario.

do $$
declare
  uid uuid;
  n int;
  t text;
begin
  select count(*) into n from auth.users;
  if n <> 1 then
    raise exception 'Se esperaba 1 usuario en auth.users y hay %. Revisa antes de seguir.', n;
  end if;
  select id into uid from auth.users;

  foreach t in array array[
    'tasks','subtasks','projects','goals','habits','habit_weeks',
    'reminders','notes','quick_tasks',
    'accounts','categories','transactions','budgets','money_goals','balance_snapshots'
  ] loop
    execute format('update public.%I set user_id = $1 where user_id is null', t) using uid;
  end loop;
end $$;

-- Verificación: todas las columnas "sin_dueno" deben ser 0.
select 'tasks' tabla, count(*) filter (where user_id is null) sin_dueno, count(*) total from public.tasks
union all select 'subtasks', count(*) filter (where user_id is null), count(*) from public.subtasks
union all select 'projects', count(*) filter (where user_id is null), count(*) from public.projects
union all select 'goals', count(*) filter (where user_id is null), count(*) from public.goals
union all select 'habits', count(*) filter (where user_id is null), count(*) from public.habits
union all select 'habit_weeks', count(*) filter (where user_id is null), count(*) from public.habit_weeks
union all select 'reminders', count(*) filter (where user_id is null), count(*) from public.reminders
union all select 'notes', count(*) filter (where user_id is null), count(*) from public.notes
union all select 'quick_tasks', count(*) filter (where user_id is null), count(*) from public.quick_tasks
union all select 'accounts', count(*) filter (where user_id is null), count(*) from public.accounts
union all select 'categories', count(*) filter (where user_id is null), count(*) from public.categories
union all select 'transactions', count(*) filter (where user_id is null), count(*) from public.transactions
union all select 'budgets', count(*) filter (where user_id is null), count(*) from public.budgets
union all select 'money_goals', count(*) filter (where user_id is null), count(*) from public.money_goals
union all select 'balance_snapshots', count(*) filter (where user_id is null), count(*) from public.balance_snapshots;
