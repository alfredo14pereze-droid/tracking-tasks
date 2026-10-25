-- Finanzas v3: cubetas con aportación mensual, metas sin monto total y repartos de ahorro.
-- Solo agrega/relaja columnas; no borra datos. Se puede correr más de una vez.

-- 1) La meta total de una meta pasa a ser opcional (null = sin monto total).
alter table public.money_goals alter column target_cents drop not null;
alter table public.money_goals drop constraint if exists money_goals_target_cents_check;
alter table public.money_goals add constraint money_goals_target_cents_check
  check (target_cents is null or target_cents > 0);

-- 2) Cuánto planeas meterle cada mes a una cuenta (cubeta): Colchón/NU, Viaje, Futuro, GBM…
alter table public.accounts add column if not exists monthly_target_cents bigint not null default 0;
alter table public.accounts drop constraint if exists accounts_monthly_target_check;
alter table public.accounts add constraint accounts_monthly_target_check check (monthly_target_cents >= 0);

-- 3) Repartos: transferencias de ahorro que ya tenías. No cuentan como ahorro del mes.
alter table public.transactions add column if not exists is_allocation boolean not null default false;

-- Verificación: deben salir 3 filas.
select table_name, column_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'money_goals' and column_name = 'target_cents')
    or (table_name = 'accounts' and column_name = 'monthly_target_cents')
    or (table_name = 'transactions' and column_name = 'is_allocation'))
order by 1, 2;
