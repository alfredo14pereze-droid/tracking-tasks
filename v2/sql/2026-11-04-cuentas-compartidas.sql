-- v2 · Cuentas con dinero que no es (todo) tuyo: B-Project (50% tuyo), Carro (0%: lo cuidas para tus papás).
-- Solo AGREGA una columna con valor por defecto 100 (todo tuyo). No cambia datos. Se puede correr más de una vez.
alter table public.accounts add column if not exists owned_pct numeric(5,2) not null default 100
  check (owned_pct >= 0 and owned_pct <= 100);

-- Verificación: debe salir 1 fila.
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'accounts' and column_name = 'owned_pct';
