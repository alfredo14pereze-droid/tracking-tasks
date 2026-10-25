-- Finanzas: préstamos + historial mensual de inversiones.
-- Solo agrega opciones y columnas; no borra ni cambia datos existentes.

-- 1) Préstamos como cuentas especiales:
--    'lent'     = yo presté (te deben)
--    'borrowed' = me prestaron (debes)
alter table public.accounts drop constraint if exists accounts_kind_check;
alter table public.accounts add constraint accounts_kind_check
  check (kind in ('debit','credit','savings','investment','cash','lent','borrowed'));

alter table public.accounts add column if not exists due_date date;  -- fecha en que quedó de pagarse
alter table public.accounts add column if not exists note text;

-- 2) Historial mensual (GBM): valor al cierre del mes + depósitos netos de ese mes
--    para calcular el rendimiento = valor − valor del mes anterior − depósitos netos.
alter table public.balance_snapshots
  add column if not exists net_deposits_cents bigint not null default 0;

-- 3) Categoría de ingreso "Rendimientos" (intereses que te depositan, p. ej. NU).
insert into public.categories (name, kind, user_id)
select 'Rendimientos', 'income', u.id
from auth.users u
where not exists (select 1 from public.categories c where c.name = 'Rendimientos' and c.user_id = u.id);

-- Verificación
select pg_get_constraintdef(oid) as regla_kind from pg_constraint where conname = 'accounts_kind_check';
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'accounts' and column_name in ('due_date','note'))
    or (table_name = 'balance_snapshots' and column_name = 'net_deposits_cents'));
