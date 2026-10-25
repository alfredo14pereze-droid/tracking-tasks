-- Finanzas: ajustes para la UI. Solo agrega columnas; no borra ni cambia datos.
-- Se puede correr más de una vez sin problema.

-- Archivar categorías en vez de borrarlas.
alter table public.categories
  add column if not exists archived boolean not null default false;

-- Progreso manual de una meta cuando no tiene cuenta asignada.
alter table public.money_goals
  add column if not exists saved_cents bigint not null default 0;

-- Verificación: deben salir 2 filas.
select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'categories' and column_name = 'archived')
    or (table_name = 'money_goals' and column_name = 'saved_cents'));
