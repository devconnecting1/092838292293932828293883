-- =============================================================================
-- 1500 - Indique e ganhe (cliente indica cliente)
-- =============================================================================
-- Guarda só o mínimo; situação das indicações e percentual são derivados no app
-- (packages/core/src/billing/referrals.ts: 10% por indicação ativa, carência de
-- 30 dias, trava de 50% do valor pago pela indicada, degraus de 10% até 100%).
--  1. billing_accounts.first_paid_at (1º invoice.paid com valor > 0) e
--     billing_accounts.referral_discount_percent (0 a 100; o que está na Stripe)
--  2. organizations.referral_code (8 caracteres sem ambíguos, gerado no banco,
--     imutável) e organizations.referred_by_organization_id (1ª atribuição,
--     gravada só por create_organization; imutável), antifraude e nome mascarado
--  3. create_organization(..., p_referral_code)
--  4. RPCs do servidor (billing_server_key): record_billing_first_payment,
--     get_referral_state, set_referral_discount_percent,
--     list_referral_grace_completions
--
-- Alfabeto e tamanho do código: iguais a REFERRAL_CODE_ALPHABET e
-- REFERRAL_CODE_LENGTH no core.

-- -----------------------------------------------------------------------------
-- 1. billing_accounts: 1º pagamento e desconto aplicado
-- -----------------------------------------------------------------------------
alter table public.billing_accounts
  add column first_paid_at timestamptz,
  add column referral_discount_percent smallint not null default 0
    constraint billing_accounts_referral_discount_percent_check
      check (referral_discount_percent between 0 and 100);

comment on column public.billing_accounts.first_paid_at is
  'Primeira fatura paga com valor > 0 (webhook invoice.paid). Nunca muda depois de gravada.';
comment on column public.billing_accounts.referral_discount_percent is
  'Desconto por indicações acumulado (0 a 100), o mesmo do cupom indicacao_* na Stripe. Gravado só pela RPC set_referral_discount_percent.';

create index billing_accounts_first_paid_at_idx
  on public.billing_accounts (first_paid_at)
  where first_paid_at is not null;

-- Membros leem o percentual (linha "Desconto por indicações" na assinatura).
grant select (referral_discount_percent) on public.billing_accounts to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Código de indicação e atribuição
-- -----------------------------------------------------------------------------

-- 8 caracteres de '23456789ABCDEFGHJKMNPQRSTUVWXYZ' (31), sem viés: bytes
-- >= 248 (8 × 31) são descartados.
create or replace function private.generate_referral_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_length constant integer := 8;
  v_code text := '';
  v_bytes bytea;
  v_byte integer;
  v_index integer;
begin
  while char_length(v_code) < v_length loop
    v_bytes := extensions.gen_random_bytes(16);

    for v_index in 0 .. 15 loop
      v_byte := get_byte(v_bytes, v_index);

      if v_byte < 248 then
        v_code := v_code || substr(v_alphabet, (v_byte % 31) + 1, 1);
        exit when char_length(v_code) = v_length;
      end if;
    end loop;
  end loop;

  return v_code;
end;
$$;

-- Código novo que ainda não está em uso (default da coluna nas imobiliárias novas).
create or replace function private.new_referral_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  loop
    v_code := private.generate_referral_code();
    exit when not exists (select 1 from public.organizations o where o.referral_code = v_code);

    v_attempt := v_attempt + 1;
    if v_attempt >= 20 then
      raise exception 'Não foi possível gerar o código de indicação.' using errcode = 'P0001';
    end if;
  end loop;

  return v_code;
end;
$$;

revoke all on function private.generate_referral_code() from public, anon, authenticated;
revoke all on function private.new_referral_code() from public, anon, authenticated;
-- Gravações diretas (service_role, SQL) avaliam o default com o próprio papel.
grant execute on function private.new_referral_code() to service_role;

-- O default volátil preenche as linhas existentes (reescrita, sem disparar triggers).
alter table public.organizations
  add column referral_code text not null default private.generate_referral_code()
    constraint organizations_referral_code_format
      check (referral_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),
  add column referred_by_organization_id uuid
    constraint organizations_referred_by_organization_id_fkey
      references public.organizations (id) on delete set null;

alter table public.organizations
  add constraint organizations_referral_code_key unique (referral_code),
  add constraint organizations_referred_by_not_self check (referred_by_organization_id <> id);

alter table public.organizations
  alter column referral_code set default private.new_referral_code();

create index organizations_referred_by_organization_id_idx
  on public.organizations (referred_by_organization_id)
  where referred_by_organization_id is not null;

comment on column public.organizations.referral_code is
  'Código do link de indicação (/i/{código}). Gerado pelo banco; imutável.';
comment on column public.organizations.referred_by_organization_id is
  'Imobiliária que indicou esta (1ª atribuição, gravada só por create_organization). Imutável; vira null se a indicadora for excluída.';

-- Nenhum grant novo para sessões: as colunas ficam fora do SELECT e do UPDATE
-- por coluna de authenticated. Mesmo com privilégio, o trigger recusa mudar o
-- código ou trocar/definir a indicação depois da criação.
create or replace function private.protect_organization_referral()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.referral_code is distinct from old.referral_code then
    raise exception 'O código de indicação não pode ser alterado.' using errcode = '42501';
  end if;

  if new.referred_by_organization_id is not null
     and new.referred_by_organization_id is distinct from old.referred_by_organization_id then
    raise exception 'A indicação da imobiliária não pode ser alterada.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_organization_referral() from public, anon, authenticated;

create trigger organizations_protect_referral
  before update of referral_code, referred_by_organization_id on public.organizations
  for each row execute function private.protect_organization_referral();

-- Antifraude da atribuição (verdadeiro = não atribuir):
--   * quem cria já é ou foi membro da indicadora, ou recebeu convite dela
--     (membros em comum no momento da atribuição);
--   * quem cria é dono de outra imobiliária que já teve assinatura ou pagamento
--     (cliente antigo abrindo conta nova).
create or replace function private.referral_attribution_blocked(p_referrer uuid, p_user uuid)
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
    or exists (
      select 1
      from public.memberships m
      join public.billing_accounts b on b.organization_id = m.organization_id
      where m.user_id = p_user
        and m.role = 'owner'
        and (b.stripe_subscription_id is not null or b.first_paid_at is not null)
    );
$$;

revoke all on function private.referral_attribution_blocked(uuid, uuid) from public, anon, authenticated;

-- Nome exibido ao indicador (LGPD): primeira palavra + inicial da segunda.
-- "Imobiliária Jardim Sul" -> "Imobiliária J."; "Remax" -> "Remax".
create or replace function private.mask_referral_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when w.words is null or cardinality(w.words) = 0 or w.words[1] = '' then 'Imobiliária'
    when cardinality(w.words) = 1 then left(w.words[1], 40)
    else left(w.words[1], 40) || ' ' || upper(left(w.words[2], 1)) || '.'
  end
  from (
    select regexp_split_to_array(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), ' ') as words
  ) w;
$$;

revoke all on function private.mask_referral_name(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. create_organization com p_referral_code
-- -----------------------------------------------------------------------------
-- Mesmo corpo de subdomain_slug_and_profile_backfill + atribuição. O código é
-- opcional; formato inválido, código inexistente ou atribuição bloqueada são
-- ignorados sem erro (não revela se o código existe).
drop function public.create_organization(text, text, text, text, text, text, text);

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

    if private.referral_attribution_blocked(v_referrer, v_user) then
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
-- 4. RPCs do servidor (billing_server_key)
-- -----------------------------------------------------------------------------

-- 4a. record_billing_first_payment: grava first_paid_at só se ainda for null.
-- p_paid_at entre 2000 e agora + 1 dia (null = agora; futuro vira agora).
-- Retorna true quando gravou nesta chamada.
-- Erros: 42501 chave; 22023 data; P0002 imobiliária sem conta de billing.
create or replace function public.record_billing_first_payment(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_paid_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid_at constant timestamptz := coalesce(p_paid_at, now());
  v_updated integer;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if v_paid_at < '2000-01-01T00:00:00Z'::timestamptz or v_paid_at > now() + interval '1 day' then
    perform private.billing_invalid_field('p_paid_at');
  end if;

  if p_organization_id is null
     or not exists (select 1 from public.billing_accounts b where b.organization_id = p_organization_id) then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  update public.billing_accounts b
  set first_paid_at = least(v_paid_at, now())
  where b.organization_id = p_organization_id
    and b.first_paid_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.record_billing_first_payment(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_billing_first_payment(text, uuid, timestamptz) to anon, authenticated;

-- 4b. get_referral_state: dados para o cálculo, a página e os e-mails.
-- {
--   "organization": { id, slug, name, referral_code, referred_by_organization_id,
--     status, plan_key, billing_interval, stripe_subscription_id, first_paid_at,
--     referral_discount_percent, owner_emails },
--   "referrals": [{ organization_id, display_name (mascarado), created_at,
--     status, plan_key, billing_interval, first_paid_at, referral_discount_percent }]
-- }
-- referrals: até 500, mais recentes primeiro. Nunca devolve o nome completo das
-- indicadas nem dados de cobrança além do plano e da situação.
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
      ), '[]'::jsonb)
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
          'referral_discount_percent', r.referral_discount_percent
        )
        order by r.created_at desc, r.id
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
          coalesce(rb.referral_discount_percent, 0) as referral_discount_percent
        from public.organizations ro
        left join public.billing_accounts rb on rb.organization_id = ro.id
        where ro.referred_by_organization_id = o.id
        order by ro.created_at desc, ro.id
        limit 500
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

-- 4c. set_referral_discount_percent: grava o percentual (0 a 100) depois de o
-- servidor aplicar o cupom na Stripe. Retorna o valor anterior.
-- Erros: 42501 chave; 22023 percentual; P0002 sem conta de billing.
create or replace function public.set_referral_discount_percent(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_percent integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous integer;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_percent is null or p_percent < 0 or p_percent > 100 then
    perform private.billing_invalid_field('p_percent');
  end if;

  select b.referral_discount_percent into v_previous
  from public.billing_accounts b
  where b.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  if v_previous <> p_percent then
    update public.billing_accounts b
    set referral_discount_percent = p_percent
    where b.organization_id = p_organization_id;
  end if;

  return v_previous;
end;
$$;

revoke all on function public.set_referral_discount_percent(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.set_referral_discount_percent(text, uuid, integer) to anon, authenticated;

-- 4d. list_referral_grace_completions (cron diário): indicadas com 1ª fatura
-- paga em (p_paid_after, p_paid_until] (janela de até 31 dias). O app passa a
-- janela da carência (core) e recalcula os indicadores. Até 500 linhas.
-- Erros: 42501 chave; 22023 janela inválida.
create or replace function public.list_referral_grace_completions(
  p_server_key text default null,
  p_paid_after timestamptz default null,
  p_paid_until timestamptz default null
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

  return query
  select o.referred_by_organization_id, o.id, b.first_paid_at
  from public.organizations o
  join public.billing_accounts b on b.organization_id = o.id
  where o.referred_by_organization_id is not null
    and b.first_paid_at > p_paid_after
    and b.first_paid_at <= p_paid_until
  order by b.first_paid_at, o.id
  limit 500;
end;
$$;

revoke all on function public.list_referral_grace_completions(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.list_referral_grace_completions(text, timestamptz, timestamptz) to anon, authenticated;
