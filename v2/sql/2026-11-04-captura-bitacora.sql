-- v2 · Captura de Apple Pay: bitácora de cada vez que llega el Atajo.
-- Para diagnosticar pagos que "no llegan": guarda lo que mandó el iPhone (tal cual) y qué pasó.
-- Antes, si el monto venía vacío o raro, la función fallaba y no quedaba ningún rastro.
-- Crea 1 tabla nueva y reemplaza capture_wallet_tx (misma firma). No toca tablas existentes.
-- Incluye el arreglo de duplicados (compara también la tarjeta). Se puede correr más de una vez.

create table if not exists public.capture_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  amount_raw text,
  merchant_raw text,
  card_raw text,
  result text not null            -- registrado | por_revisar | duplicado | error: …
);
create index if not exists capture_attempts_user_at on public.capture_attempts (user_id, at desc);

alter table public.capture_attempts enable row level security;
drop policy if exists "own rows" on public.capture_attempts;
create policy "own rows" on public.capture_attempts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

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
  v_err text;
begin
  -- Token inválido: no se registra nada (no sabemos de quién es).
  if p_token is null or length(p_token) < 32 then
    raise exception 'token inválido' using errcode = '28000';
  end if;
  select id, user_id into v_token_id, v_user
  from capture_tokens
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and not revoked;
  if v_user is null then
    raise exception 'token inválido' using errcode = '28000';
  end if;

  update capture_tokens set last_used_at = now() where id = v_token_id;

  -- "$1,234.50", "MX$86.00", "86" → centavos. Las comas son separador de miles.
  v_clean := regexp_replace(coalesce(p_amount, ''), '[^0-9.]', '', 'g');
  if v_clean !~ '^\d+(\.\d{1,2})?$' then
    v_err := 'error: monto inválido';
  else
    v_cents := round(v_clean::numeric * 100);
    if v_cents <= 0 or v_cents > 100000000 then  -- tope: $1,000,000
      v_err := 'error: monto fuera de rango';
    end if;
  end if;
  if v_err is not null then
    -- No se lanza error (eso borraría también la bitácora): se anota y se responde ok=false.
    insert into capture_attempts (user_id, amount_raw, merchant_raw, card_raw, result)
    values (v_user, left(p_amount, 200), left(p_merchant, 200), left(p_card, 200), v_err);
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;

  -- Evita duplicados si el Atajo se dispara dos veces (mismo monto, comercio y tarjeta en 2 min).
  select id into v_cap from wallet_captures
  where user_id = v_user and amount_cents = v_cents
    and coalesce(merchant, '') = coalesce(v_merchant, '')
    and lower(coalesce(card_name, '')) = lower(coalesce(v_card, ''))
    and received_at > now() - interval '2 minutes'
  limit 1;
  if v_cap is not null then
    insert into capture_attempts (user_id, amount_raw, merchant_raw, card_raw, result)
    values (v_user, left(p_amount, 200), left(p_merchant, 200), left(p_card, 200), 'duplicado');
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_cap);
  end if;

  -- Cuenta: 1) la que ya elegiste antes para esta tarjeta (capture_card_accounts);
  --         2) si no, la primera cuyo nombre o institución aparece en el nombre de la tarjeta.
  if v_card is not null then
    select m.account_id into v_acc
    from capture_card_accounts m
    join accounts a on a.id = m.account_id and not a.archived
    where m.user_id = v_user and lower(m.card_name) = lower(v_card)
    limit 1;
  end if;
  if v_card is not null and v_acc is null then
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

  insert into capture_attempts (user_id, amount_raw, merchant_raw, card_raw, result)
  values (v_user, left(p_amount, 200), left(p_merchant, 200), left(p_card, 200),
          case when v_tx is null then 'por_revisar' else 'registrado' end);

  return jsonb_build_object('ok', true, 'id', v_cap, 'linked', v_tx is not null);
end;
$$;

revoke all on function public.capture_wallet_tx(text, text, text, text) from public;
grant execute on function public.capture_wallet_tx(text, text, text, text) to anon, authenticated;

-- Verificación: debe salir la tabla con "own rows" y la función con sus 4 parámetros.
select 'tabla' as que, tablename as nombre, policyname as detalle
from pg_policies where schemaname = 'public' and tablename = 'capture_attempts'
union all
select 'función', p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'capture_wallet_tx';

-- Después de cada prueba con el iPhone, corre esto para ver qué llegó:
-- select at at time zone 'America/Monterrey' as hora, amount_raw, merchant_raw, card_raw, result
-- from public.capture_attempts order by at desc limit 10;
