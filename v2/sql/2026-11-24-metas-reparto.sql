-- Metas que se llenan solas con un % del ahorro de cada mes (ahorro = ingresos − gastos, se calcula en JS).
-- alloc_pct  = qué % del ahorro de cada mes va a esta meta (0 = no recibe reparto).
-- alloc_from = primer mes (día 1) que se reparte con el % actual. Al cambiar el %, la app pasa lo ya
--              repartido en meses cerrados a saved_cents y alloc_from pasa al mes actual.
-- El ahorro del periodo NO se guarda en ninguna tabla.
alter table public.money_goals
  add column if not exists alloc_pct numeric(5,2) not null default 0,
  add column if not exists alloc_from date;

alter table public.money_goals drop constraint if exists money_goals_alloc_pct_check;
alter table public.money_goals
  add constraint money_goals_alloc_pct_check check (alloc_pct >= 0 and alloc_pct <= 100);

-- Verificación
select id, name, account_id, saved_cents, alloc_pct, alloc_from from public.money_goals order by created_at;
