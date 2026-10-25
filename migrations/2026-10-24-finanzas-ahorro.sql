-- Finanzas: categoría de tipo "ahorro" (meta mensual que se debe superar).
-- Lo ahorrado se calcula con las transferencias hacia cuentas de ahorro/inversión (NU, GBM).
-- No borra datos. El límite que ya tenga "Ahorro" se conserva como meta.

alter table public.categories drop constraint if exists categories_kind_check;
alter table public.categories add constraint categories_kind_check
  check (kind in ('expense','income','savings'));

update public.categories set kind = 'savings'
where name = 'Ahorro' and kind = 'expense';

-- Verificación: "Ahorro" debe salir con kind = savings.
-- movimientos_con_esa_categoria debe ser 0 (si no, avísame: eran gastos registrados como ahorro).
select c.name, c.kind,
       (select count(*) from public.transactions t where t.category_id = c.id) as movimientos_con_esa_categoria,
       (select count(*) from public.budgets b where b.category_id = c.id) as metas
from public.categories c
where c.name = 'Ahorro';
