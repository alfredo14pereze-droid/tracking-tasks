-- v2 · Fase 2: captura de pagos con Apple Pay desde un Atajo de iOS.
-- Solo CREA objetos nuevos. No cambia accounts, transactions ni ninguna tabla existente.
-- Se puede correr más de una vez.
--
-- Cómo funciona:
--   1) En v2 › Finanzas › "Conectar Atajo" la app genera un token al azar y guarda aquí
--      solo su hash (sha256). El token completo se muestra una vez para pegarlo en el Atajo.
--   2) El Atajo (disparador "Transacción" de Wallet) llama a public.capture_wallet_tx
--      con el token, el monto, el comercio y el nombre de la tarjeta.
--   3) La función busca la cuenta cuya nombre/institución aparece en el nombre de la tarjeta.
--      Si la encuentra, registra el gasto en transactions (sin categoría, nota = comercio).
--      Si no, la captura queda "pendiente" y en v2 eliges la cuenta.

-- 1) Tokens del Atajo (solo el hash).
create table if not exists public.capture_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Atajo iPhone',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false
);

-- 2) Cada pago que llega del Atajo.
create table if not exists public.wallet_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  received_at timestamptz not null default now(),
  merchant text,
  card_name text,
  amount_cents bigint not null check (amount_cents > 0),
  account_id uuid references public.accounts(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','linked','ignored'))
);
-- transaction_id usa el mismo tipo que transactions.id (sea uuid o bigint).
do $$
declare t text;
begin
  select format_type(atttypid, atttypmod) into t
  from pg_attribute where attrelid = 'public.transactions'::regclass and attname = 'id';
  execute format('alter table public.wallet_captures add column if not exists transaction_id %s '
                 'references public.transactions(id) on delete set null', t);
end $$;
create index if not exists wallet_captures_user_received on public.wallet_captures (user_id, received_at desc);

-- 3) Mismo RLS que el resto: cada quien ve solo sus filas.
alter table public.capture_tokens enable row level security;
alter table public.wallet_captures enable row level security;
drop policy if exists "own rows" on public.capture_tokens;
create policy "own rows" on public.capture_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own rows" on public.wallet_captures;
create policy "own rows" on public.wallet_captures for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 4) Función que llama el Atajo (sin sesión, solo con la anon key + el token).
--    security definer: corre con permisos del dueño, pero solo escribe filas del
--    usuario dueño del token y solo después de validar el token.
create or replace function public.capture_wallet_tx(
  p_token text,
  p_amount text,
  p_merchant text default null,
  p_card text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_token_id uuid;
  v_clean text;
  v_cents bigint;
  v_merchant text := nullif(left(btrim(coalesce(p_merchant, '')), 120), '');
  v_card text := nullif(left(btrim(coalesce(p_card, '')), 120), '');
  v_acc uuid;
  v_tx transactions.id%type;
  v_cap uuid;
  v_today date := (now() at time zone 'America/Monterrey')::date;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'token inválido' using errcode = '28000';
  end if;

  select id, user_id into v_token_id, v_user
  from capture_tokens
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and not revoked;
  if v_user is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;

  -- "$1,234.50", "MX$86.00", "86" → centavos. Las comas son separador de miles.
  v_clean := regexp_replace(coalesce(p_amount, ''), '[^0-9.]', '', 'g');
  if v_clean !~ '^\d+(\.\d{1,2})?$' then
    raise exception 'monto inválido: %', p_amount using errcode = '22023';
  end if;
  v_cents := round(v_clean::numeric * 100);
  if v_cents <= 0 or v_cents > 100000000 then  -- tope: $1,000,000
    raise exception 'monto fuera de rango' using errcode = '22023';
  end if;

  update capture_tokens set last_used_at = now() where id = v_token_id;

  -- Evita duplicados si el Atajo se dispara dos veces (mismo monto y comercio en 2 min).
  select id into v_cap from wallet_captures
  where user_id = v_user and amount_cents = v_cents
    and coalesce(merchant, '') = coalesce(v_merchant, '')
    and received_at > now() - interval '2 minutes'
  limit 1;
  if v_cap is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_cap);
  end if;

  -- Cuenta: la primera (no préstamo, no archivada) cuyo nombre o institución aparece en la tarjeta.
  if v_card is not null then
    select a.id into v_acc
    from accounts a
    where a.user_id = v_user and not a.archived
      and a.kind in ('debit','credit','cash','savings')
      and (v_card ilike '%' || a.name || '%'
           or (a.institution is not null and a.institution <> '' and v_card ilike '%' || a.institution || '%'))
    order by (a.kind = 'credit' and v_card ilike '%cr_dito%') desc, length(a.name) desc
    limit 1;
  end if;

  if v_acc is not null then
    insert into transactions (user_id, type, amount_cents, account_id, category_id, occurred_on, note)
    values (v_user, 'expense', v_cents, v_acc, null, v_today, coalesce(v_merchant, 'Apple Pay'))
    returning id into v_tx;
  end if;

  insert into wallet_captures (user_id, merchant, card_name, amount_cents, account_id, transaction_id, status)
  values (v_user, v_merchant, v_card, v_cents, v_acc, v_tx, case when v_tx is null then 'pending' else 'linked' end)
  returning id into v_cap;

  return jsonb_build_object('ok', true, 'id', v_cap, 'linked', v_tx is not null);
end;
$$;

revoke all on function public.capture_wallet_tx(text, text, text, text) from public;
grant execute on function public.capture_wallet_tx(text, text, text, text) to anon, authenticated;

-- Verificación: deben salir las 2 tablas con la política "own rows" y la función.
select 'tabla' as que, tablename as nombre, policyname as detalle
from pg_policies where schemaname = 'public' and tablename in ('capture_tokens','wallet_captures')
union all
select 'función', p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'capture_wallet_tx';
