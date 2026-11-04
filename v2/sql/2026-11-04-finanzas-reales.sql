-- v2 · Finanzas "ya con datos reales": rendimientos automáticos y pago de tarjeta del mes.
-- Solo AGREGA columnas que pueden quedar vacías. No borra ni cambia datos. Se puede correr más de una vez.

-- 1) Rendimientos: tasa anual de cada cuenta (NU, Plata…) y desde qué día se calcula.
alter table public.accounts add column if not exists annual_rate_pct numeric(6,3)
  check (annual_rate_pct is null or (annual_rate_pct >= 0 and annual_rate_pct <= 100));
alter table public.accounts add column if not exists yield_since date;

-- 2) Movimientos que crea la app (p. ej. "Rendimiento · noviembre").
--    auto_key identifica el movimiento (una fila por cuenta y mes) y auto_amount_cents guarda
--    lo último que calculó la app: si cambias el monto a mano, ya no lo vuelve a tocar.
alter table public.transactions add column if not exists auto_key text;
alter table public.transactions add column if not exists auto_amount_cents bigint;
create unique index if not exists transactions_auto_key_unique
  on public.transactions (user_id, auto_key) where auto_key is not null;

-- 3) Tarjeta: "pago para no generar intereses" tal como lo dice el banco para un corte.
alter table public.card_settings add column if not exists statement_cut_on date;
alter table public.card_settings add column if not exists statement_due_cents bigint
  check (statement_due_cents is null or statement_due_cents >= 0);

-- Verificación: deben salir 6 columnas.
select table_name as tabla, column_name as columna, data_type as tipo
from information_schema.columns
where table_schema = 'public' and (
  (table_name = 'accounts' and column_name in ('annual_rate_pct','yield_since')) or
  (table_name = 'transactions' and column_name in ('auto_key','auto_amount_cents')) or
  (table_name = 'card_settings' and column_name in ('statement_cut_on','statement_due_cents')))
order by 1, 2;
