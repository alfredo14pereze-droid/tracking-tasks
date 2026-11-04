-- v2 · Captura de Apple Pay, arreglo: el filtro de duplicados ahora también compara la TARJETA.
-- Antes: dos pagos del mismo monto en el mismo comercio en menos de 2 min contaban como uno solo,
-- aunque fueran con tarjetas distintas (p. ej. $1 con BBVA y $1 con Plata en Salper → se perdía uno).
-- Solo reemplaza la función capture_wallet_tx (misma firma). No toca tablas. Se puede correr más de una vez.

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

  -- Evita duplicados si el Atajo se dispara dos veces (mismo monto, comercio y tarjeta en 2 min).
  select id into v_cap from wallet_captures
  where user_id = v_user and amount_cents = v_cents
    and coalesce(merchant, '') = coalesce(v_merchant, '')
    and lower(coalesce(card_name, '')) = lower(coalesce(v_card, ''))
    and received_at > now() - interval '2 minutes'
  limit 1;
  if v_cap is not null then
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

  return jsonb_build_object('ok', true, 'id', v_cap, 'linked', v_tx is not null);
end;
$$;

revoke all on function public.capture_wallet_tx(text, text, text, text) from public;
grant execute on function public.capture_wallet_tx(text, text, text, text) to anon, authenticated;

-- Verificación 1: debe decir "si" (la función ya compara la tarjeta).
select case when pg_get_functiondef('public.capture_wallet_tx(text,text,text,text)'::regprocedure) like '%lower(coalesce(card_name%'
            then 'si' else 'NO' end as compara_tarjeta;

-- Verificación 2: los últimos pagos que llegaron del Atajo (para ver si alguno de BBVA llegó alguna vez).
select received_at at time zone 'America/Monterrey' as hora, merchant as comercio, card_name as tarjeta,
       amount_cents / 100.0 as monto, status
from public.wallet_captures order by received_at desc limit 10;
