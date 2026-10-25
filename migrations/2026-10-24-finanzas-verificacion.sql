-- Finanzas: verificación del esquema (SOLO LECTURA, no cambia nada).
-- Devuelve una sola tabla: columnas, reglas CHECK y datos semilla (nombres y tipos).

select 'columna' as que, table_name as tabla,
       column_name || ' ' || data_type
         || case when is_nullable = 'NO' then ' not null' else '' end
         || coalesce(' default ' || column_default, '') as detalle
from information_schema.columns
where table_schema = 'public'
  and table_name in ('accounts','categories','transactions','budgets','money_goals','balance_snapshots')

union all
select 'check', rel.relname, con.conname || ': ' || pg_get_constraintdef(con.oid)
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public' and con.contype in ('c','u')
  and rel.relname in ('accounts','categories','transactions','budgets','money_goals','balance_snapshots')

union all
select 'semilla', 'accounts', name || ' | kind=' || coalesce(kind,'') || ' | inicial=' || coalesce(opening_balance_cents::text,'')
from public.accounts

union all
select 'semilla', 'categories', name || ' | kind=' || coalesce(kind,'')
from public.categories

order by 1, 2, 3;
