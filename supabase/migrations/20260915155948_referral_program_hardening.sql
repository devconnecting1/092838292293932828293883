-- =============================================================================
-- 1510 - Indique e ganhe: endurecimento (revisão de código)
-- =============================================================================
--  1. billing_accounts: plan_net_monthly_cents (+ plan_net_invoice_at),
--     referral_counted_at, referral_confirmed_notified_at,
--     referral_ineligible_at/_reason (estorno e disputa)
--  2. mask_referral_name: só iniciais quando o nome pode ser de pessoa
--  3. Antifraude: CNPJ igual bloqueia a atribuição; membros em comum (inclusive
--     inativos) e CNPJ igual são reavaliados em get_referral_state
--  4. RPCs do servidor (billing_server_key):
--     record_billing_invoice_paid (substitui record_billing_first_payment),
--     get_referral_state (novos campos, até 1000 indicadas, total),
--     apply_referral_recalculation (substitui set_referral_discount_percent;
--       compara o percentual esperado e grava as transições atomicamente),
--     set_referral_confirmation_notice, set_referral_ineligibility,
--     list_referral_grace_completions (paginada), list_referral_referrers
--     (reconciliação diária)

-- -----------------------------------------------------------------------------
-- 1. Colunas
-- -----------------------------------------------------------------------------
alter table public.billing_accounts
  add column plan_net_monthly_cents integer
    constraint billing_accounts_plan_net_monthly_cents_check
      check (plan_net_monthly_cents between 0 and 1000000000),
  add column plan_net_invoice_at timestamptz,
  add column referral_counted_at timestamptz,
  add column referral_confirmed_notified_at timestamptz,
  add column referral_ineligible_at timestamptz,
  add column referral_ineligible_reason text
    constraint billing_accounts_referral_ineligible_reason_check
      check (referral_ineligible_reason in ('refund', 'dispute', 'dispute_lost')),
  add constraint billing_accounts_referral_ineligible_consistency
    check ((referral_ineligible_at is null) = (referral_ineligible_reason is null));

comment on column public.billing_accounts.plan_net_monthly_cents is
  'Valor líquido mensal equivalente do item de plano na última fatura paga de criação ou renovação (bruto − descontos; anual ÷ 12). Trava do Indique e ganhe.';
comment on column public.billing_accounts.plan_net_invoice_at is
  'Criação da fatura que gravou plan_net_monthly_cents (fatura mais antiga não sobrescreve).';
comment on column public.billing_accounts.referral_counted_at is
  'Desde quando esta imobiliária conta como indicação ativa para quem a indicou (null = não conta). Limpar gera o aviso de indicação perdida.';
comment on column public.billing_accounts.referral_confirmed_notified_at is
  'Aviso "indicação confirmada" já enviado a quem indicou.';
comment on column public.billing_accounts.referral_ineligible_at is
  'Estorno ou disputa: a imobiliária deixa de contar como indicação.';

-- -----------------------------------------------------------------------------
-- 2. Nome mascarado
-- -----------------------------------------------------------------------------
-- Primeira palavra que é claramente de empresa: "Imobiliária Jardim Sul" ->
-- "Imobiliária J.". Qualquer outra (pode ser nome de pessoa): só iniciais das
-- duas primeiras palavras ("Fernanda Imóveis" -> "F. I.", "Remax" -> "R.").
create or replace function private.mask_referral_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when w.words is null or cardinality(w.words) = 0 or w.words[1] = '' then 'Imobiliária'
    when translate(lower(w.words[1]), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = any (array[
      'imobiliaria', 'imobiliarias', 'imoveis', 'imovel', 'corretora', 'corretores', 'corretor',
      'consultoria', 'assessoria', 'negocios', 'grupo', 'construtora', 'incorporadora',
      'administradora', 'empreendimentos', 'investimentos', 'realty', 'properties',
      'escritorio', 'agencia', 'rede', 'central', 'portal'
    ]) then
      case
        when cardinality(w.words) = 1 then left(w.words[1], 40)
        else left(w.words[1], 40) || ' ' || upper(left(w.words[2], 1)) || '.'
      end
    else array_to_string(array(
      select upper(left(x.word, 1)) || '.'
      from unnest(w.words[1:2]) with ordinality as x (word, ord)
      where x.word <> ''
      order by x.ord
    ), ' ')
  end
  from (
    select regexp_split_to_array(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ' ') as words
  ) w;
$$;

revoke all on function private.mask_referral_name(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Antifraude
-- -----------------------------------------------------------------------------
drop function private.referral_attribution_blocked(uuid, uuid);

-- Verdadeiro = não atribuir:
--   * quem cria já é ou foi membro da indicadora, ou recebeu convite dela;
--   * a imobiliária nova tem o mesmo CNPJ da indicadora;
--   * quem cria é dono de outra imobiliária que já teve assinatura ou pagamento.
create or replace function private.referral_attribution_blocked(
  p_referrer uuid,
  p_user uuid,
  p_cnpj text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_referrer is null
    or p_user is null
    or exists (
      select 1
      from public.memberships m
      where m.organization_id = p_referrer
        and m.user_id = p_user
    )
    or exists (
      select 1
      from public.invitations i
      join auth.users u on u.id = p_user
      where i.organization_id = p_referrer
        and i.email = lower(u.email)
    )
    or (
      p_cnpj is not null
      and exists (select 1 from public.organizations o where o.id = p_referrer and o.cnpj = p_cnpj)
    )
    or exists (
      select 1
      from public.memberships m
      join public.billing_accounts b on b.organization_id = m.organization_id
      where m.user_id = p_user
        and m.role = 'owner'
        and (b.stripe_subscription_id is not null or b.first_paid_at is not null)
    );
$$;

revoke all on function private.referral_attribution_blocked(uuid, uuid, text) from public, anon, authenticated;

-- Motivo de inelegibilidade de uma indicada (null = elegível): estorno/disputa
-- gravados, membros em comum com a indicadora (ativos ou não) ou mesmo CNPJ.
create or replace function private.referral_ineligible_reason(p_referrer uuid, p_referred uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.referral_ineligible_reason from public.billing_accounts b where b.organization_id = p_referred),
    case
      when exists (
        select 1
        from public.memberships ma
        join public.memberships mb on mb.user_id = ma.user_id
        where ma.organization_id = p_referrer
          and mb.organization_id = p_referred
      ) then 'shared_members'
      when exists (
        select 1
        from public.organizations r
        join public.organizations o on o.id = p_referrer
        where r.id = p_referred
          and r.cnpj is not null
          and r.cnpj = o.cnpj
      ) then 'same_cnpj'
    end
  );
$$;

revoke all on function private.referral_ineligible_reason(uuid, uuid) from public, anon, authenticated;

-- create_organization: mesmo corpo de referral_program, passando o CNPJ ao antifraude.
create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_legal_name text default null,
  p_cnpj text default null,
  p_creci text default null,
  p_city text default null,
  p_state text default null,
  p_referral_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_cnpj text := nullif(upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_referral_code text := upper(btrim(coalesce(p_referral_code, '')));
  v_referrer uuid;
  v_org uuid;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado para criar uma imobiliária.'
      using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'Informe o nome da imobiliária (2 a 160 caracteres).'
      using errcode = '22023';
  end if;

  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$'
     or substr(v_slug, 3, 2) = '--' then
    raise exception 'Endereço inválido: use de 3 a 60 letras minúsculas, números e hífens.'
      using errcode = '22023';
  end if;

  if private.is_reserved_subdomain(v_slug) then
    raise exception 'Este endereço é reservado. Escolha outro.'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    raise exception 'O endereço "%" já está em uso. Escolha outro.', v_slug
      using errcode = '23505';
  end if;

  if v_state is not null and v_state !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida: use a sigla com 2 letras.'
      using errcode = '22023';
  end if;

  if v_cnpj is not null and v_cnpj !~ '^[0-9A-Z]{12}[0-9]{2}$' then
    raise exception 'CNPJ inválido: informe os 14 caracteres.'
      using errcode = '22023';
  end if;

  if v_referral_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$' then
    select o.id into v_referrer
    from public.organizations o
    where o.referral_code = v_referral_code;

    if private.referral_attribution_blocked(v_referrer, v_user, v_cnpj) then
      v_referrer := null;
    end if;
  end if;

  insert into public.organizations (
    slug, name, legal_name, cnpj, creci, city, state, created_by, referred_by_organization_id
  )
  values (
    v_slug,
    v_name,
    nullif(btrim(p_legal_name), ''),
    v_cnpj,
    nullif(btrim(p_creci), ''),
    nullif(btrim(p_city), ''),
    v_state,
    v_user,
    v_referrer
  )
  returning id into v_org;

  insert into public.memberships (organization_id, user_id, role, active, created_by)
  values (v_org, v_user, 'owner', true, v_user);

  return v_org;
exception
  when unique_violation then
    raise exception 'O endereço "%" já está em uso. Escolha outro.', v_slug
      using errcode = '23505';
end;
$$;

revoke all on function public.create_organization(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. RPCs do servidor
-- -----------------------------------------------------------------------------
drop function public.record_billing_first_payment(text, uuid, timestamptz);
drop function public.set_referral_discount_percent(text, uuid, integer);
drop function public.list_referral_grace_completions(text, timestamptz, timestamptz);

-- 4a. record_billing_invoice_paid: fatura paga de criação ou renovação.
--   first_paid_at: gravado só se nulo e p_amount_paid_cents > 0.
--   plan_net_monthly_cents: gravado se informado e a fatura não for mais antiga
--   que a última registrada (p_invoice_created_at).
-- Retorna true quando first_paid_at foi gravado nesta chamada.
-- Erros: 42501 chave; 22023 campos; P0002 sem conta de billing.
create or replace function public.record_billing_invoice_paid(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_paid_at timestamptz default null,
  p_invoice_created_at timestamptz default null,
  p_amount_paid_cents integer default null,
  p_plan_net_monthly_cents integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid_at constant timestamptz := least(coalesce(p_paid_at, now()), now());
  v_row public.billing_accounts%rowtype;
  v_first_paid boolean := false;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if coalesce(p_paid_at, now()) < '2000-01-01T00:00:00Z'::timestamptz
     or coalesce(p_paid_at, now()) > now() + interval '1 day' then
    perform private.billing_invalid_field('p_paid_at');
  end if;

  if p_invoice_created_at is null
     or p_invoice_created_at < '2000-01-01T00:00:00Z'::timestamptz
     or p_invoice_created_at > now() + interval '1 day' then
    perform private.billing_invalid_field('p_invoice_created_at');
  end if;

  if p_amount_paid_cents is null or p_amount_paid_cents < 0 then
    perform private.billing_invalid_field('p_amount_paid_cents');
  end if;

  if p_plan_net_monthly_cents is not null
     and (p_plan_net_monthly_cents < 0 or p_plan_net_monthly_cents > 1000000000) then
    perform private.billing_invalid_field('p_plan_net_monthly_cents');
  end if;

  select b.* into v_row
  from public.billing_accounts b
  where b.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  v_first_paid := v_row.first_paid_at is null and p_amount_paid_cents > 0;

  update public.billing_accounts b
  set first_paid_at = case when v_first_paid then v_paid_at else b.first_paid_at end,
      plan_net_monthly_cents = case
        when p_plan_net_monthly_cents is not null
             and (b.plan_net_invoice_at is null or p_invoice_created_at >= b.plan_net_invoice_at)
          then p_plan_net_monthly_cents
        else b.plan_net_monthly_cents
      end,
      plan_net_invoice_at = case
        when p_plan_net_monthly_cents is not null
             and (b.plan_net_invoice_at is null or p_invoice_created_at >= b.plan_net_invoice_at)
          then p_invoice_created_at
        else b.plan_net_invoice_at
      end
  where b.organization_id = p_organization_id;

  return v_first_paid;
end;
$$;

revoke all on function public.record_billing_invoice_paid(text, uuid, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.record_billing_invoice_paid(text, uuid, timestamptz, timestamptz, integer, integer) to anon, authenticated;

-- 4b. get_referral_state
-- {
--   "organization": { id, slug, name, referral_code, referred_by_organization_id,
--     status, plan_key, billing_interval, stripe_subscription_id, first_paid_at,
--     referral_discount_percent, owner_emails, referral_total, referrals_truncated },
--   "referrals": [{ organization_id, display_name (mascarado), created_at, status,
--     plan_key, billing_interval, first_paid_at, referral_discount_percent,
--     net_monthly_cents, counted_at, confirmed_notified_at, ineligible_reason }]
-- }
-- referrals: até 1000; as que já pagaram primeiro, depois as mais recentes.
-- ineligible_reason: refund | dispute | dispute_lost | shared_members | same_cnpj | null.
-- Erros: 42501 chave; P0002 imobiliária inexistente.
create or replace function public.get_referral_state(
  p_server_key text default null,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'organization', jsonb_build_object(
      'id', o.id,
      'slug', o.slug,
      'name', o.name,
      'referral_code', o.referral_code,
      'referred_by_organization_id', o.referred_by_organization_id,
      'status', b.status,
      'plan_key', b.plan_key,
      'billing_interval', b.billing_interval,
      'stripe_subscription_id', b.stripe_subscription_id,
      'first_paid_at', b.first_paid_at,
      'referral_discount_percent', coalesce(b.referral_discount_percent, 0),
      'owner_emails', coalesce((
        select jsonb_agg(distinct lower(u.email))
        from public.memberships m
        join auth.users u on u.id = m.user_id
        where m.organization_id = o.id
          and m.role = 'owner'
          and m.active
          and u.email is not null
      ), '[]'::jsonb),
      'referral_total', (
        select count(*)::integer
        from public.organizations ro
        where ro.referred_by_organization_id = o.id
      ),
      'referrals_truncated', (
        select count(*) > 1000
        from public.organizations ro
        where ro.referred_by_organization_id = o.id
      )
    ),
    'referrals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'organization_id', r.id,
          'display_name', private.mask_referral_name(r.name),
          'created_at', r.created_at,
          'status', r.status,
          'plan_key', r.plan_key,
          'billing_interval', r.billing_interval,
          'first_paid_at', r.first_paid_at,
          'referral_discount_percent', r.referral_discount_percent,
          'net_monthly_cents', r.plan_net_monthly_cents,
          'counted_at', r.referral_counted_at,
          'confirmed_notified_at', r.referral_confirmed_notified_at,
          'ineligible_reason', private.referral_ineligible_reason(o.id, r.id)
        )
        order by (r.first_paid_at is null), r.created_at desc, r.id
      )
      from (
        select
          ro.id,
          ro.name,
          ro.created_at,
          rb.status,
          rb.plan_key,
          rb.billing_interval,
          rb.first_paid_at,
          coalesce(rb.referral_discount_percent, 0) as referral_discount_percent,
          rb.plan_net_monthly_cents,
          rb.referral_counted_at,
          rb.referral_confirmed_notified_at
        from public.organizations ro
        left join public.billing_accounts rb on rb.organization_id = ro.id
        where ro.referred_by_organization_id = o.id
        order by (rb.first_paid_at is null), ro.created_at desc, ro.id
        limit 1000
      ) r
    ), '[]'::jsonb)
  )
  into v_result
  from public.organizations o
  left join public.billing_accounts b on b.organization_id = o.id
  where o.id = p_organization_id;

  if v_result is null then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_referral_state(text, uuid) from public, anon, authenticated;
grant execute on function public.get_referral_state(text, uuid) to anon, authenticated;

-- 4c. apply_referral_recalculation: grava o resultado de um recálculo com
-- controle de concorrência. Se o percentual gravado não for p_expected_percent,
-- nada muda e retorna {"status": "conflict", "previous": n} (quem chama recalcula).
-- Senão grava p_percent e as transições das indicadas (só as desta indicadora):
--   p_count   -> referral_counted_at = now() onde estava nulo
--   p_uncount -> referral_counted_at = null onde estava preenchido
-- Retorna {"status": "ok", "previous": n, "percent": n,
--          "counted": [uuid], "uncounted": [{organization_id, counted_at}]}
-- (só as linhas que mudaram nesta chamada: base dos avisos, sem duplicidade).
-- Erros: 42501 chave; 22023 percentuais/listas; P0002 sem conta de billing.
create or replace function public.apply_referral_recalculation(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_expected_percent integer default null,
  p_percent integer default null,
  p_count uuid[] default null,
  p_uncount uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current integer;
  v_counted jsonb;
  v_uncounted jsonb;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_percent is null or p_percent < 0 or p_percent > 100 then
    perform private.billing_invalid_field('p_percent');
  end if;

  if p_expected_percent is null or p_expected_percent < 0 or p_expected_percent > 100 then
    perform private.billing_invalid_field('p_expected_percent');
  end if;

  if coalesce(cardinality(p_count), 0) > 1000 or array_position(p_count, null) is not null then
    perform private.billing_invalid_field('p_count');
  end if;

  if coalesce(cardinality(p_uncount), 0) > 1000 or array_position(p_uncount, null) is not null then
    perform private.billing_invalid_field('p_uncount');
  end if;

  select b.referral_discount_percent into v_current
  from public.billing_accounts b
  where b.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  if v_current <> p_expected_percent then
    return jsonb_build_object('status', 'conflict', 'previous', v_current);
  end if;

  if v_current <> p_percent then
    update public.billing_accounts b
    set referral_discount_percent = p_percent
    where b.organization_id = p_organization_id;
  end if;

  with changed as (
    update public.billing_accounts rb
    set referral_counted_at = now()
    from public.organizations ro
    where ro.id = rb.organization_id
      and ro.referred_by_organization_id = p_organization_id
      and rb.organization_id = any (coalesce(p_count, '{}'::uuid[]))
      and rb.referral_counted_at is null
    returning rb.organization_id
  )
  select coalesce(jsonb_agg(c.organization_id), '[]'::jsonb) into v_counted from changed c;

  with previous as (
    select rb.organization_id, rb.referral_counted_at
    from public.billing_accounts rb
    join public.organizations ro on ro.id = rb.organization_id
    where ro.referred_by_organization_id = p_organization_id
      and rb.organization_id = any (coalesce(p_uncount, '{}'::uuid[]))
      and rb.referral_counted_at is not null
    for update of rb
  ), changed as (
    update public.billing_accounts rb
    set referral_counted_at = null
    from previous p
    where rb.organization_id = p.organization_id
    returning p.organization_id, p.referral_counted_at
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('organization_id', c.organization_id, 'counted_at', c.referral_counted_at)),
    '[]'::jsonb
  ) into v_uncounted
  from changed c;

  return jsonb_build_object(
    'status', 'ok',
    'previous', v_current,
    'percent', p_percent,
    'counted', v_counted,
    'uncounted', v_uncounted
  );
end;
$$;

revoke all on function public.apply_referral_recalculation(text, uuid, integer, integer, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.apply_referral_recalculation(text, uuid, integer, integer, uuid[], uuid[]) to anon, authenticated;

-- 4d. set_referral_confirmation_notice: reserva (p_claim = true) o aviso de
-- confirmação de uma indicada desta indicadora, ou libera a reserva (false)
-- quando o envio falhou. Retorna true quando mudou (reserva exclusiva).
-- Erros: 42501 chave.
create or replace function public.set_referral_confirmation_notice(
  p_server_key text default null,
  p_referrer_organization_id uuid default null,
  p_referred_organization_id uuid default null,
  p_claim boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  update public.billing_accounts rb
  set referral_confirmed_notified_at = case when coalesce(p_claim, true) then now() end
  from public.organizations ro
  where ro.id = rb.organization_id
    and ro.id = p_referred_organization_id
    and ro.referred_by_organization_id = p_referrer_organization_id
    and (
      (coalesce(p_claim, true) and rb.referral_confirmed_notified_at is null)
      or (not coalesce(p_claim, true) and rb.referral_confirmed_notified_at is not null)
    );

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.set_referral_confirmation_notice(text, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_referral_confirmation_notice(text, uuid, uuid, boolean) to anon, authenticated;

-- 4e. set_referral_ineligibility: estorno e disputa (webhook da Stripe).
--   refund | dispute_lost : marca (ou agrava uma disputa aberta); permanente
--   dispute               : marca se ainda elegível
--   dispute_won           : desfaz só a marca de disputa aberta
-- Retorna true quando mudou. Erros: 42501 chave; 22023 motivo; P0002 sem conta.
create or replace function public.set_referral_ineligibility(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_updated integer := 0;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_reason is null or p_reason not in ('refund', 'dispute', 'dispute_lost', 'dispute_won') then
    perform private.billing_invalid_field('p_reason');
  end if;

  select b.referral_ineligible_reason into v_current
  from public.billing_accounts b
  where b.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  if p_reason = 'dispute_won' then
    if v_current = 'dispute' then
      update public.billing_accounts b
      set referral_ineligible_at = null, referral_ineligible_reason = null
      where b.organization_id = p_organization_id;
      get diagnostics v_updated = row_count;
    end if;
  elsif v_current is null then
    update public.billing_accounts b
    set referral_ineligible_at = now(), referral_ineligible_reason = p_reason
    where b.organization_id = p_organization_id;
    get diagnostics v_updated = row_count;
  elsif v_current = 'dispute' and p_reason in ('refund', 'dispute_lost') then
    update public.billing_accounts b
    set referral_ineligible_reason = p_reason
    where b.organization_id = p_organization_id;
    get diagnostics v_updated = row_count;
  end if;

  return v_updated > 0;
end;
$$;

revoke all on function public.set_referral_ineligibility(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_referral_ineligibility(text, uuid, text) to anon, authenticated;

-- 4f. list_referral_grace_completions (cron): indicadas com 1ª fatura paga em
-- (p_paid_after, p_paid_until] (janela de até 31 dias), paginadas por
-- (first_paid_at, organization_id) depois do cursor. p_limit de 1 a 500.
-- Erros: 42501 chave; 22023 janela, cursor ou limite.
create or replace function public.list_referral_grace_completions(
  p_server_key text default null,
  p_paid_after timestamptz default null,
  p_paid_until timestamptz default null,
  p_cursor_paid_at timestamptz default null,
  p_cursor_organization_id uuid default null,
  p_limit integer default 200
)
returns table (
  referrer_organization_id uuid,
  referred_organization_id uuid,
  first_paid_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_paid_after is null
     or p_paid_until is null
     or p_paid_after >= p_paid_until
     or p_paid_until - p_paid_after > interval '31 days' then
    raise exception 'Janela inválida.' using errcode = '22023';
  end if;

  if (p_cursor_paid_at is null) <> (p_cursor_organization_id is null) then
    raise exception 'Cursor inválido.' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Limite inválido.' using errcode = '22023';
  end if;

  return query
  select o.referred_by_organization_id, o.id, b.first_paid_at
  from public.organizations o
  join public.billing_accounts b on b.organization_id = o.id
  where o.referred_by_organization_id is not null
    and b.first_paid_at > p_paid_after
    and b.first_paid_at <= p_paid_until
    and (
      p_cursor_paid_at is null
      or (b.first_paid_at, o.id) > (p_cursor_paid_at, p_cursor_organization_id)
    )
  order by b.first_paid_at, o.id
  limit p_limit;
end;
$$;

revoke all on function public.list_referral_grace_completions(text, timestamptz, timestamptz, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_referral_grace_completions(text, timestamptz, timestamptz, timestamptz, uuid, integer) to anon, authenticated;

-- 4g. list_referral_referrers (reconciliação diária): imobiliárias com desconto
-- gravado > 0 ou com alguma indicada, em ordem pseudoaleatória estável por
-- p_seed (o app usa a data), paginadas por sort_key depois de p_after.
-- p_seed: [0-9a-z-]{1,40}; p_after: md5 em hex ou null; p_limit de 1 a 500.
-- Erros: 42501 chave; 22023 parâmetros.
create or replace function public.list_referral_referrers(
  p_server_key text default null,
  p_seed text default null,
  p_after text default null,
  p_limit integer default 200
)
returns table (
  organization_id uuid,
  sort_key text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_seed is null or p_seed !~ '^[0-9a-z-]{1,40}$' then
    raise exception 'Semente inválida.' using errcode = '22023';
  end if;

  if p_after is not null and p_after !~ '^[0-9a-f]{32}$' then
    raise exception 'Cursor inválido.' using errcode = '22023';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Limite inválido.' using errcode = '22023';
  end if;

  return query
  select x.id, x.key
  from (
    select o.id, md5(o.id::text || p_seed) as key
    from public.organizations o
    join public.billing_accounts b on b.organization_id = o.id
    where b.referral_discount_percent > 0
       or exists (select 1 from public.organizations r where r.referred_by_organization_id = o.id)
  ) x
  where p_after is null or x.key > p_after
  order by x.key
  limit p_limit;
end;
$$;

revoke all on function public.list_referral_referrers(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.list_referral_referrers(text, text, text, integer) to anon, authenticated;
