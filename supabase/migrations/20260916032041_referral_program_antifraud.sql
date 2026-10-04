-- =============================================================================
-- 1520 - Indique e ganhe: antifraude e corrida de recálculo (revisão de segurança)
-- =============================================================================
--  1. Antifraude: vale UMA indicação por conta. Quem já é dono de outra
--     imobiliária indicada não gera nova atribuição (antes só bloqueava quem já
--     tinha assinatura ou pagamento, então bastava criar várias imobiliárias
--     antes de assinar qualquer uma para multiplicar indicações do mesmo dono).
--  2. referral_ineligible_reason: motivo novo `duplicate_owner` (a indicada mais
--     nova que divide dono com outra indicada do mesmo indicador não conta),
--     que também reavalia as atribuições já gravadas.
--  3. private.referral_state_fingerprint + get_referral_state.state_fingerprint
--     e apply_referral_recalculation(p_expected_fingerprint): a trava de
--     concorrência passa a comparar o ESTADO lido, não só o percentual. Sem
--     isso, um recálculo com estado velho podia gravar por cima de um recálculo
--     novo sempre que o percentual voltasse ao mesmo valor (ex.: estorno
--     processado no meio de outro recálculo gravava desconto indevido).
--  4. As RPCs do programa saem do papel `authenticated`: o servidor as chama com
--     a chave publishable (papel `anon`) + BILLING_SERVER_KEY; sessão de usuário
--     nunca precisa delas.

-- -----------------------------------------------------------------------------
-- 1. Antifraude da atribuição
-- -----------------------------------------------------------------------------
-- Verdadeiro = não atribuir:
--   * quem cria já é ou foi membro da indicadora, ou recebeu convite dela;
--   * a imobiliária nova tem o mesmo CNPJ da indicadora;
--   * quem cria é dono de outra imobiliária que já teve assinatura ou pagamento;
--   * quem cria já é dono de outra imobiliária indicada (uma indicação por conta).
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
    )
    or exists (
      select 1
      from public.memberships m
      join public.organizations o on o.id = m.organization_id
      where m.user_id = p_user
        and m.role = 'owner'
        and o.referred_by_organization_id is not null
    );
$$;

revoke all on function private.referral_attribution_blocked(uuid, uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Motivo de inelegibilidade
-- -----------------------------------------------------------------------------
-- null = elegível. Estorno/disputa gravados, membros em comum com a indicadora
-- (ativos ou não), mesmo CNPJ ou dono repetido entre indicadas do mesmo
-- indicador (só a mais antiga conta).
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
      when exists (
        select 1
        from public.memberships m_self
        join public.memberships m_other
          on m_other.user_id = m_self.user_id
         and m_other.role = 'owner'
        join public.organizations o_other on o_other.id = m_other.organization_id
        join public.organizations o_self on o_self.id = p_referred
        where m_self.organization_id = p_referred
          and m_self.role = 'owner'
          and o_other.id <> p_referred
          and o_other.referred_by_organization_id = p_referrer
          and (o_other.created_at, o_other.id) < (o_self.created_at, o_self.id)
      ) then 'duplicate_owner'
    end
  );
$$;

revoke all on function private.referral_ineligible_reason(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Impressão do estado (trava de concorrência)
-- -----------------------------------------------------------------------------
-- md5 do que entra no cálculo do desconto: as mesmas 1000 indicadas devolvidas
-- por get_referral_state (mesma ordem) e a cobrança da própria indicadora.
-- Muda sempre que um fato de cobrança muda; quem recalculou com um estado velho
-- não consegue gravar (apply_referral_recalculation devolve conflito).
-- Não inclui vínculos de equipe/CNPJ: eles não mudam por webhook e entrariam em
-- todas as linhas (custo alto, sem corrida a proteger).
create or replace function private.referral_state_fingerprint(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(
    coalesce((
      select string_agg(x.line, E'\n' order by x.pending, x.created_at desc, x.id)
      from (
        select
          ro.id,
          ro.created_at,
          (rb.first_paid_at is null) as pending,
          concat_ws(
            '|',
            ro.id::text,
            coalesce(rb.status, '~'),
            coalesce(rb.plan_key, '~'),
            coalesce(rb.billing_interval, '~'),
            coalesce(rb.first_paid_at::text, '~'),
            coalesce(rb.plan_net_monthly_cents::text, '~'),
            coalesce(rb.referral_discount_percent::text, '~'),
            coalesce(rb.referral_counted_at::text, '~'),
            coalesce(rb.referral_confirmed_notified_at::text, '~'),
            coalesce(rb.referral_ineligible_reason, '~')
          ) as line
        from public.organizations ro
        left join public.billing_accounts rb on rb.organization_id = ro.id
        where ro.referred_by_organization_id = p_organization_id
        order by (rb.first_paid_at is null), ro.created_at desc, ro.id
        limit 1000
      ) x
    ), '')
    || '#'
    || coalesce((
      select concat_ws(
        '|',
        coalesce(b.status, '~'),
        coalesce(b.plan_key, '~'),
        coalesce(b.billing_interval, '~'),
        coalesce(b.stripe_subscription_id, '~'),
        coalesce(b.first_paid_at::text, '~'),
        coalesce(b.referral_discount_percent::text, '~')
      )
      from public.billing_accounts b
      where b.organization_id = p_organization_id
    ), '~')
  );
$$;

revoke all on function private.referral_state_fingerprint(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. get_referral_state: mesma resposta + state_fingerprint
-- -----------------------------------------------------------------------------
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
      'state_fingerprint', private.referral_state_fingerprint(o.id),
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
grant execute on function public.get_referral_state(text, uuid) to anon;

-- -----------------------------------------------------------------------------
-- 5. apply_referral_recalculation: trava por percentual E por estado
-- -----------------------------------------------------------------------------
-- p_expected_fingerprint: state_fingerprint devolvido por get_referral_state na
-- leitura que gerou este recálculo. Se o estado mudou desde então, nada é
-- gravado e a resposta é {"status": "conflict"} (quem chama relê e repete).
-- null mantém o comportamento antigo (só a comparação de percentual).
drop function public.apply_referral_recalculation(text, uuid, integer, integer, uuid[], uuid[]);

create or replace function public.apply_referral_recalculation(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_expected_percent integer default null,
  p_percent integer default null,
  p_count uuid[] default null,
  p_uncount uuid[] default null,
  p_expected_fingerprint text default null
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

  if p_expected_fingerprint is not null and p_expected_fingerprint !~ '^[0-9a-f]{32}$' then
    perform private.billing_invalid_field('p_expected_fingerprint');
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

  -- Com a linha travada, relê o estado: um recálculo concorrente que já gravou
  -- fatos de cobrança (estorno, disputa, fatura paga, troca de plano) invalida
  -- este, mesmo que o percentual tenha voltado ao mesmo valor.
  if p_expected_fingerprint is not null
     and private.referral_state_fingerprint(p_organization_id) is distinct from p_expected_fingerprint then
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

revoke all on function public.apply_referral_recalculation(text, uuid, integer, integer, uuid[], uuid[], text)
  from public, anon, authenticated;
grant execute on function public.apply_referral_recalculation(text, uuid, integer, integer, uuid[], uuid[], text) to anon;

-- -----------------------------------------------------------------------------
-- 6. Superfície: as RPCs do programa só pelo papel `anon` (chave publishable)
-- -----------------------------------------------------------------------------
-- O servidor Next chama todas com a chave publishable, sem sessão (papel
-- `anon`) + BILLING_SERVER_KEY. Nenhuma sessão de usuário precisa delas, então
-- o grant a `authenticated` só aumentava a superfície exposta pelo PostgREST.
revoke execute on function public.record_billing_invoice_paid(text, uuid, timestamptz, timestamptz, integer, integer)
  from authenticated;
revoke execute on function public.set_referral_confirmation_notice(text, uuid, uuid, boolean) from authenticated;
revoke execute on function public.set_referral_ineligibility(text, uuid, text) from authenticated;
revoke execute on function public.list_referral_grace_completions(text, timestamptz, timestamptz, timestamptz, uuid, integer)
  from authenticated;
revoke execute on function public.list_referral_referrers(text, text, text, integer) from authenticated;
