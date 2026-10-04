-- =============================================================================
-- 1400 - Assinatura (Stripe): billing_accounts, estado, modo leitura e limites
-- =============================================================================
-- A Stripe é a fonte da verdade da cobrança. O banco guarda só o vínculo e um
-- resumo (1 linha por imobiliária) para liberar recursos sem ir à Stripe.
--  1. private.billing_trial_defaults (limites e recursos do teste grátis)
--  2. public.billing_accounts
--  3. Criação automática (after insert em organizations) e backfill idempotente
--  4. RLS e grants por coluna (stripe_* fora do SELECT; nenhuma escrita com sessão)
--  5. Helpers: billing_state, billing_limit, billing_has_feature, assentos
--  6. Modo leitura: private.assert_billing_writable nas tabelas de negócio
--  7. Limites aplicados no banco: users (membros + convites) e landing_pages
--     (publicadas). Imóveis são ilimitados em todos os planos.
--  8. RPC com sessão: get_billing_overview
--  9. RPCs do servidor (billing_server_key no Vault): sync_billing_account,
--     get_billing_account_ids e list_billing_reminders
--
-- Convenção de limits: -1 = ilimitado; chave ausente = ilimitado; 0 = não incluso.

-- -----------------------------------------------------------------------------
-- 1. Padrões do teste grátis (14 dias, limites do plano equipe com IA reduzida)
-- -----------------------------------------------------------------------------
-- Para mudar: create or replace com a mesma assinatura. Vale para imobiliárias
-- novas; as linhas existentes mudam pela sincronização.
create or replace function private.billing_trial_defaults(out limits jsonb, out features text[])
language sql
stable
set search_path = ''
as $$
  select
    '{"users": 8, "landing_pages": 50, "storage_gb": 100, "pipelines": 10, "ai_conversations": 20}'::jsonb,
    array[
      'feature_properties', 'feature_condominiums', 'feature_listing_score',
      'feature_capture_public_form', 'feature_keys', 'feature_proposals', 'feature_clients',
      'feature_calendar_tasks', 'feature_leads_kanban', 'feature_multiple_pipelines',
      'feature_landing_pages', 'feature_portal_feed_vrsync', 'feature_team_roles_invites',
      'feature_tenant_subdomain', 'feature_custom_domain', 'feature_data_export',
      'feature_assisted_migration'
    ]::text[];
$$;

-- seats a partir de limits.users (1 a 10.000; -1 ou chave ausente = 10.000).
create or replace function private.billing_seats_from_limits(p_limits jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_limits -> 'users') = 'number' and (p_limits ->> 'users') ~ '^[0-9]{1,9}$'
      then least(greatest((p_limits ->> 'users')::bigint, 1), 10000)::integer
    else 10000
  end;
$$;

revoke all on function private.billing_trial_defaults() from public, anon, authenticated;
revoke all on function private.billing_seats_from_limits(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. billing_accounts
-- -----------------------------------------------------------------------------
create table public.billing_accounts (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id text
    constraint billing_accounts_stripe_customer_id_key unique
    constraint billing_accounts_stripe_customer_id_format
      check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  stripe_subscription_id text
    constraint billing_accounts_stripe_subscription_id_key unique
    constraint billing_accounts_stripe_subscription_id_format
      check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,250}$'),
  -- Chaves de packages/core/src/billing (BillingPlanKey).
  plan_key text not null default 'trial'
    constraint billing_accounts_plan_key_check
      check (plan_key in ('trial', 'corretor', 'imobiliaria', 'equipe', 'rede')),
  billing_interval text
    constraint billing_accounts_billing_interval_check check (billing_interval in ('month', 'year')),
  status text not null default 'trialing'
    constraint billing_accounts_status_check check (status in (
      'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
    )),
  -- Usuários incluídos + extras contratados (informativo; o limite aplicado é limits.users).
  seats integer not null default 1
    constraint billing_accounts_seats_check check (seats between 1 and 10000),
  addon_keys text[] not null default '{}'
    constraint billing_accounts_addon_keys_format
      check (cardinality(addon_keys) <= 50 and array_position(addon_keys, null) is null),
  -- {"users": 8, "landing_pages": 50, ...}: -1 = ilimitado, 0 = não incluso, ausente = ilimitado.
  limits jsonb not null
    constraint billing_accounts_limits_format
      check (jsonb_typeof(limits) = 'object' and octet_length(limits::text) <= 4096),
  features text[] not null default '{}'
    constraint billing_accounts_features_format
      check (cardinality(features) <= 100 and array_position(features, null) is null),
  trial_ends_at timestamptz not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  synced_at timestamptz not null default now()
);

comment on table public.billing_accounts is
  'Resumo da assinatura por imobiliária (a Stripe é a fonte da verdade). Escrita só pelo trigger de criação e pela RPC sync_billing_account (chave do servidor).';

-- -----------------------------------------------------------------------------
-- 3. Criação automática e backfill
-- -----------------------------------------------------------------------------
create or replace function private.create_billing_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits jsonb;
  v_features text[];
begin
  select d.limits, d.features into v_limits, v_features
  from private.billing_trial_defaults() as d;

  insert into public.billing_accounts (
    organization_id, plan_key, status, seats, limits, features, trial_ends_at
  )
  values (
    new.id, 'trial', 'trialing', private.billing_seats_from_limits(v_limits), v_limits, v_features,
    greatest(new.created_at, now()) + interval '14 days'
  )
  on conflict (organization_id) do nothing;

  return null;
end;
$$;

revoke all on function private.create_billing_account() from public, anon, authenticated;

create trigger organizations_create_billing_account
  after insert on public.organizations
  for each row execute function private.create_billing_account();

-- Imobiliárias sem linha (as anteriores a esta migração): teste de 14 dias a
-- partir de agora. Idempotente; retorna quantas linhas criou.
create or replace function private.backfill_billing_accounts()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_limits jsonb;
  v_features text[];
  v_inserted integer;
begin
  select d.limits, d.features into v_limits, v_features
  from private.billing_trial_defaults() as d;

  insert into public.billing_accounts (
    organization_id, plan_key, status, seats, limits, features, trial_ends_at
  )
  select
    o.id, 'trial', 'trialing', private.billing_seats_from_limits(v_limits), v_limits, v_features,
    now() + interval '14 days'
  from public.organizations o
  where not exists (select 1 from public.billing_accounts b where b.organization_id = o.id)
  on conflict (organization_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function private.backfill_billing_accounts() from public, anon, authenticated;

select private.backfill_billing_accounts();

-- -----------------------------------------------------------------------------
-- 4. RLS e grants
-- -----------------------------------------------------------------------------
alter table public.billing_accounts enable row level security;

create policy "billing_accounts: membros leem"
  on public.billing_accounts for select to authenticated
  using (private.is_member(organization_id));

-- Nenhuma escrita com sessão; stripe_customer_id e stripe_subscription_id fora
-- do SELECT (select * falha com permission denied).
revoke all on public.billing_accounts from public, anon, authenticated;
grant select (
  organization_id, plan_key, billing_interval, status, seats, addon_keys, limits, features,
  trial_ends_at, current_period_end, cancel_at_period_end, synced_at
) on public.billing_accounts to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Helpers
-- -----------------------------------------------------------------------------

-- Fim do período que governa o estado (mesma regra de resolveBillingState no core):
--   trialing com plan_key 'trial' (teste local) ou sem current_period_end: trial_ends_at
--   trialing com plano pago (trial criado na Stripe): current_period_end
--   past_due, unpaid, incomplete: current_period_end (nulo = sem carência)
--   demais status: null
create or replace function private.billing_period_end(
  p_status text,
  p_plan_key text,
  p_trial_ends_at timestamptz,
  p_current_period_end timestamptz
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'trialing' then
      case
        when p_plan_key = 'trial' or p_current_period_end is null then p_trial_ends_at
        else p_current_period_end
      end
    when p_status in ('past_due', 'unpaid', 'incomplete') then p_current_period_end
  end;
$$;

-- Fim da carência: fim do período + 7 dias (168 h, como GRACE_DAYS no core);
-- null quando não há carência possível (active, canceled, pendente sem período...).
create or replace function private.billing_grace_ends_at(
  p_status text,
  p_plan_key text,
  p_trial_ends_at timestamptz,
  p_current_period_end timestamptz
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select private.billing_period_end(p_status, p_plan_key, p_trial_ends_at, p_current_period_end)
    + interval '168 hours';
$$;

-- Estado de acesso (limites inclusivos, igual ao core):
--   active    status = active
--   trialing  status = trialing e p_at <= fim do período
--   grace     status trialing, past_due, unpaid ou incomplete e p_at <= fim do período + 7 dias
--   read_only o resto (canceled, incomplete_expired, paused, status desconhecido,
--             datas ausentes, período vencido há mais de 7 dias)
create or replace function private.billing_state_at(
  p_status text,
  p_plan_key text,
  p_trial_ends_at timestamptz,
  p_current_period_end timestamptz,
  p_at timestamptz
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status = 'active' then 'active'
    when p_status = 'trialing'
         and p_at <= private.billing_period_end(p_status, p_plan_key, p_trial_ends_at, p_current_period_end)
      then 'trialing'
    when p_status in ('trialing', 'past_due', 'unpaid', 'incomplete')
         and p_at <= private.billing_grace_ends_at(p_status, p_plan_key, p_trial_ends_at, p_current_period_end)
      then 'grace'
    else 'read_only'
  end;
$$;

-- Sem linha em billing_accounts = read_only (falha fechada).
create or replace function private.billing_state(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.billing_state_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end, now())
    from public.billing_accounts b
    where b.organization_id = org
  ), 'read_only');
$$;

-- Valor inteiro de limits (-1 = ilimitado, 0 = não incluso, n). Chave ausente,
-- não numérica ou sem linha = null (ilimitado).
create or replace function private.billing_limit(org uuid, key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when jsonb_typeof(b.limits -> billing_limit.key) = 'number'
         and (b.limits ->> billing_limit.key) ~ '^(-1|[0-9]{1,9})$'
      then (b.limits ->> billing_limit.key)::integer
  end
  from public.billing_accounts b
  where b.organization_id = billing_limit.org;
$$;

create or replace function private.billing_has_feature(org uuid, key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select billing_has_feature.key = any (b.features)
    from public.billing_accounts b
    where b.organization_id = billing_has_feature.org
  ), false);
$$;

-- Convites que ocupam assento: não aceitos, dentro da validade e para e-mail
-- que ainda não é membro ativo (p_exclude_email não conta).
create or replace function private.billing_pending_invitations(org uuid, p_exclude_email text default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.invitations i
  where i.organization_id = org
    and i.accepted_at is null
    and i.expires_at >= now()
    and (p_exclude_email is null or i.email <> p_exclude_email)
    and not exists (
      select 1
      from public.memberships m
      join auth.users u on u.id = m.user_id
      where m.organization_id = org
        and m.active
        and lower(u.email) = i.email
    );
$$;

-- Membros ativos + convites pendentes.
create or replace function private.billing_seats_in_use(org uuid, p_exclude_email text default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select count(*)::integer
    from public.memberships m
    where m.organization_id = org
      and m.active
  ) + private.billing_pending_invitations(org, p_exclude_email);
$$;

-- Verdadeiro durante accept_invitation: o usuário da sessão tem convite
-- pendente e válido para o próprio e-mail nesta imobiliária.
create or replace function private.billing_accepting_invitation(org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null
    and p_user = (select auth.uid())
    and exists (
      select 1
      from public.invitations i
      join auth.users u on u.id = p_user
      where i.organization_id = org
        and i.accepted_at is null
        and i.expires_at >= now()
        and i.email = lower(u.email)
    );
$$;

revoke all on function private.billing_period_end(text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.billing_grace_ends_at(text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.billing_state_at(text, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.billing_state(uuid) from public, anon, authenticated;
revoke all on function private.billing_limit(uuid, text) from public, anon, authenticated;
revoke all on function private.billing_has_feature(uuid, text) from public, anon, authenticated;
revoke all on function private.billing_pending_invitations(uuid, text) from public, anon, authenticated;
revoke all on function private.billing_seats_in_use(uuid, text) from public, anon, authenticated;
revoke all on function private.billing_accepting_invitation(uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Modo leitura
-- -----------------------------------------------------------------------------
-- BEFORE INSERT/UPDATE nas tabelas de negócio. Erro P0001 com a mensagem
-- estável "assinatura_somente_leitura". Não age:
--   * sem sessão (RPCs públicas com chave do servidor, pg_cron, SQL/admin);
--   * em gravações disparadas por outro trigger ou por ação de FK
--     (pg_trigger_depth() > 1), ex.: excluir um cliente zera leads.client_id;
--   * em INSERT de quem não é membro ativo (o RLS recusa sem revelar o estado);
--   * no aceite de convite (membership e o próprio convite);
--   * em memberships, na desativação pura (libera assento);
--   * em leads criados por submit_landing_lead (landing_page_id só é gravável pela RPC).
-- DELETE não é bloqueado. profiles e organizations não recebem o trigger.
create or replace function private.assert_billing_writable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
begin
  if v_user is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'INSERT' and not private.is_member(new.organization_id) then
    return new;
  end if;

  if tg_table_name = 'memberships' then
    if private.billing_accepting_invitation(new.organization_id, new.user_id) then
      return new;
    end if;
    if tg_op = 'UPDATE' then
      if old.active and not new.active and new.role = old.role then
        return new;
      end if;
    end if;
  elsif tg_table_name = 'invitations' then
    if tg_op = 'UPDATE' then
      if old.accepted_at is null and new.accepted_at is not null and new.accepted_by = v_user then
        return new;
      end if;
    end if;
  elsif tg_table_name = 'leads' then
    if tg_op = 'INSERT' and new.landing_page_id is not null then
      return new;
    end if;
  end if;

  if private.billing_state(new.organization_id) = 'read_only' then
    raise exception 'assinatura_somente_leitura' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function private.assert_billing_writable() from public, anon, authenticated;

-- Prefixo "a0_": triggers BEFORE rodam em ordem alfabética, então o modo
-- leitura é verificado antes das demais validações da tabela.
create trigger a0_billing_writable before insert or update on public.activities
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.appointments
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before update on public.capture_requests
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.client_documents
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.client_interests
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.client_shares
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.clients
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.condominiums
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.invitations
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.key_movements
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.keys
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.landing_pages
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.leads
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.listing_authorizations
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.memberships
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.properties
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.property_media
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.property_owners
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.proposals
  for each row execute function private.assert_billing_writable();
create trigger a0_billing_writable before insert or update on public.tasks
  for each row execute function private.assert_billing_writable();

-- -----------------------------------------------------------------------------
-- 7. Limites do plano (só com sessão; P0001 com mensagem estável e
--    detail = {"limit": n, "usage": n})
-- -----------------------------------------------------------------------------

-- limits.users: membros ativos + convites pendentes + 1 <= limite.
--   * convite novo (ou convite vencido que volta a valer por expires_at);
--   * reativação de membro (active false -> true);
--   * aceite de convite não conta de novo; convite para e-mail de membro ativo
--     não ocupa assento; desativar sempre é permitido.
create or replace function private.enforce_billing_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org constant uuid := new.organization_id;
  v_email text;
  v_limit integer;
  v_used integer;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_table_name = 'invitations' then
    if new.accepted_at is not null or new.expires_at < now() then
      return new;
    end if;

    if tg_op = 'INSERT' then
      if not private.is_member(v_org) then
        return new;
      end if;
    else
      if old.accepted_at is null and old.expires_at >= now() then
        -- já estava pendente (e já ocupava assento)
        return new;
      end if;
    end if;

    v_email := new.email;

    if exists (
      select 1
      from public.memberships m
      join auth.users u on u.id = m.user_id
      where m.organization_id = v_org
        and m.active
        and lower(u.email) = v_email
    ) then
      return new;
    end if;
  else
    if tg_op <> 'UPDATE' then
      return new;
    end if;
    if old.active or not new.active then
      return new;
    end if;
    if private.billing_accepting_invitation(v_org, new.user_id) then
      return new;
    end if;

    select lower(u.email) into v_email from auth.users u where u.id = new.user_id;
  end if;

  v_limit := private.billing_limit(v_org, 'users');
  if v_limit is null or v_limit < 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing_users:' || v_org::text, 0));

  v_used := private.billing_seats_in_use(v_org, v_email);

  if v_used + 1 > v_limit then
    raise exception 'limite_usuarios'
      using errcode = 'P0001',
            detail = jsonb_build_object('limit', v_limit, 'usage', v_used)::text;
  end if;

  return new;
end;
$$;

-- limits.landing_pages: landing pages com status published + 1 <= limite.
create or replace function private.enforce_billing_landing_pages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if (select auth.uid()) is null or new.status <> 'published' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'published' then
      return new;
    end if;
  elsif not private.is_member(new.organization_id) then
    return new;
  end if;

  v_limit := private.billing_limit(new.organization_id, 'landing_pages');
  if v_limit is null or v_limit < 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing_landing_pages:' || new.organization_id::text, 0));

  select count(*)::integer into v_count
  from public.landing_pages lp
  where lp.organization_id = new.organization_id
    and lp.status = 'published'
    and lp.id <> new.id;

  if v_count + 1 > v_limit then
    raise exception 'limite_landing_pages'
      using errcode = 'P0001',
            detail = jsonb_build_object('limit', v_limit, 'usage', v_count)::text;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_billing_seats() from public, anon, authenticated;
revoke all on function private.enforce_billing_landing_pages() from public, anon, authenticated;

-- "a1_": depois do modo leitura (a0_) e antes das validações da tabela.
create trigger a1_billing_limit before insert or update of expires_at on public.invitations
  for each row execute function private.enforce_billing_seats();
create trigger a1_billing_limit before update of active on public.memberships
  for each row execute function private.enforce_billing_seats();
create trigger a1_billing_limit before insert or update of status on public.landing_pages
  for each row execute function private.enforce_billing_landing_pages();

-- -----------------------------------------------------------------------------
-- 8. RPC com sessão: get_billing_overview
-- -----------------------------------------------------------------------------
-- Só membro ativo da imobiliária informada (senão 42501, como get_feed_settings).
-- Retorno (snake_case, sem stripe_*):
--   { organization_id, state, status, plan_key, billing_interval, seats, addon_keys,
--     limits, features, usage: { users, landing_pages, active_properties },
--     trial_ends_at, current_period_end, cancel_at_period_end, has_subscription, synced_at }
--   usage.users = membros ativos + convites pendentes; usage.landing_pages = publicadas;
--   usage.active_properties só informativo (imóveis são ilimitados).
-- null se a linha não existir (não deveria acontecer: trigger + backfill).
create or replace function public.get_billing_overview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.billing_accounts%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.is_member(p_organization_id) then
    raise exception 'Você não tem acesso a esta imobiliária.' using errcode = '42501';
  end if;

  select b.* into v_row
  from public.billing_accounts b
  where b.organization_id = p_organization_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'organization_id', v_row.organization_id,
    'state', private.billing_state_at(v_row.status, v_row.plan_key, v_row.trial_ends_at, v_row.current_period_end, now()),
    'status', v_row.status,
    'plan_key', v_row.plan_key,
    'billing_interval', v_row.billing_interval,
    'seats', v_row.seats,
    'addon_keys', to_jsonb(v_row.addon_keys),
    'limits', v_row.limits,
    'features', to_jsonb(v_row.features),
    'usage', jsonb_build_object(
      'users', private.billing_seats_in_use(p_organization_id),
      'landing_pages', (
        select count(*)::integer
        from public.landing_pages lp
        where lp.organization_id = p_organization_id
          and lp.status = 'published'
      ),
      'active_properties', (
        select count(*)::integer
        from public.properties p
        where p.organization_id = p_organization_id
          and p.status = 'active'
      )
    ),
    'trial_ends_at', v_row.trial_ends_at,
    'current_period_end', v_row.current_period_end,
    'cancel_at_period_end', v_row.cancel_at_period_end,
    'has_subscription', v_row.stripe_subscription_id is not null,
    'synced_at', v_row.synced_at
  );
end;
$$;

revoke all on function public.get_billing_overview(uuid) from public, anon, authenticated;
grant execute on function public.get_billing_overview(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. RPCs do servidor (webhook da Stripe e cron), com a chave billing_server_key
-- -----------------------------------------------------------------------------

-- 9a. Segredo no Vault (gerado aqui; o valor não fica no arquivo da migração).
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'billing_server_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'billing_server_key',
      'Chave do servidor Next para sync_billing_account, get_billing_account_ids e list_billing_reminders (env BILLING_SERVER_KEY).'
    );
  end if;
end;
$$;

create or replace function private.billing_server_key_ok(p_server_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if p_server_key is null then
    return false;
  end if;

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'billing_server_key'
  limit 1;

  return v_secret is not null
    and extensions.digest(p_server_key, 'sha256') = extensions.digest(v_secret, 'sha256');
end;
$$;

-- 9b. Validação do payload
create or replace function private.billing_invalid_field(p_field text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Campo inválido: %.', p_field using errcode = '22023', detail = p_field;
end;
$$;

-- Data ISO 8601 com fuso (ex.: 2026-10-01T12:00:00Z, 2026-10-01T09:00:00.000-03:00),
-- entre 2000 e 2200. Qualquer outra coisa = null.
create or replace function private.billing_jsonb_timestamptz(p_value jsonb)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text;
  v_ts timestamptz;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then
    return null;
  end if;

  v_text := p_value #>> '{}';
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return null;
  end if;

  begin
    v_ts := v_text::timestamptz;
  exception
    when others then
      return null;
  end;

  if v_ts < '2000-01-01T00:00:00Z'::timestamptz or v_ts > '2200-01-01T00:00:00Z'::timestamptz then
    return null;
  end if;

  return v_ts;
end;
$$;

-- Lista de textos no formato p_pattern, sem repetição, até p_max. Inválida = null.
create or replace function private.billing_jsonb_keys(p_value jsonb, p_max integer, p_pattern text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) = 'array' then (
      select case
        when count(*) <= p_max
             and count(*) = count(distinct e.value #>> '{}')
             and bool_and(jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ p_pattern) is not false
          then coalesce(array_agg(e.value #>> '{}' order by e.ord), '{}')
      end
      from jsonb_array_elements(p_value) with ordinality as e (value, ord)
    )
  end;
$$;

-- limits: só as chaves LimitKey do core; valores inteiros -1 (ilimitado), 0
-- (não incluso) ou até 999.999.999.
create or replace function private.billing_limits_ok(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) = 'object' then not exists (
      select 1
      from jsonb_each(p_value) as e
      where e.key not in (
              'users', 'landing_pages', 'storage_gb', 'pipelines', 'ai_conversations',
              'whatsapp_numbers', 'rental_contracts', 'esign_docs', 'branches'
            )
         or jsonb_typeof(e.value) <> 'number'
         or (e.value #>> '{}') !~ '^(-1|[0-9]{1,9})$'
    )
    else false
  end;
$$;

revoke all on function private.billing_server_key_ok(text) from public, anon, authenticated;
revoke all on function private.billing_invalid_field(text) from public, anon, authenticated;
revoke all on function private.billing_jsonb_timestamptz(jsonb) from public, anon, authenticated;
revoke all on function private.billing_jsonb_keys(jsonb, integer, text) from public, anon, authenticated;
revoke all on function private.billing_limits_ok(jsonb) from public, anon, authenticated;

-- 9c. sync_billing_account
-- p_payload (objeto, até 16 KB; qualquer outra chave, inclusive trial_ends_at, é recusada):
--   stripe_customer_id      "cus_..." (obrigatório; diferente do já gravado = billing_customer_divergente)
--   stripe_subscription_id  "sub_..." | null (null grava null; ausente mantém)
--   plan_key                trial | corretor | imobiliaria | equipe | rede (null/ausente mantém)
--   billing_interval        "month" | "year" | null (null grava null; ausente mantém)
--   status                  trialing | active | past_due | canceled | unpaid | incomplete |
--                           incomplete_expired | paused (null/ausente mantém)
--   seats                   inteiro 1..10000 (null/ausente mantém)
--   addon_keys              lista [a-z][a-z0-9_]*, até 50, sem repetição (null/ausente mantém)
--   limits                  {LimitKey: -1 | 0..999999999} (null/ausente mantém)
--   features                lista feature_*, até 100, sem repetição (null/ausente mantém)
--   current_period_end      ISO 8601 com fuso | null (null grava null; ausente mantém)
--   cancel_at_period_end    booleano (null/ausente mantém)
-- trial_ends_at nunca muda por aqui. synced_at = now() sempre.
-- Erros: 42501 chave (Acesso negado.); 22023 payload (detail = campo);
-- P0002 imobiliária inexistente; P0001 billing_customer_divergente;
-- 23505 stripe_* já usado por outra imobiliária.
create or replace function public.sync_billing_account(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_payload jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed constant text[] := array[
    'stripe_customer_id', 'stripe_subscription_id', 'plan_key', 'billing_interval', 'status',
    'seats', 'addon_keys', 'limits', 'features', 'current_period_end', 'cancel_at_period_end'
  ];
  v_plans constant text[] := array['trial', 'corretor', 'imobiliaria', 'equipe', 'rede'];
  v_statuses constant text[] := array[
    'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
  ];
  v_field text;
  v_value jsonb;
  v_customer text;
  v_keys text[];
  v_ts timestamptz;
  v_limits jsonb;
  v_features text[];
  v_row public.billing_accounts%rowtype;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 16384 then
    raise exception 'Payload inválido: envie um objeto JSON de até 16 KB.' using errcode = '22023';
  end if;

  select k.name into v_field
  from jsonb_object_keys(p_payload) as k (name)
  where not (k.name = any (v_allowed))
  order by k.name
  limit 1;

  if v_field is not null then
    raise exception 'Campo desconhecido: %.', v_field using errcode = '22023', detail = v_field;
  end if;

  v_value := p_payload -> 'stripe_customer_id';
  if v_value is null
     or jsonb_typeof(v_value) <> 'string'
     or (v_value #>> '{}') !~ '^cus_[A-Za-z0-9]{1,250}$' then
    perform private.billing_invalid_field('stripe_customer_id');
  end if;
  v_customer := v_value #>> '{}';

  if p_organization_id is null
     or not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  select b.* into v_row
  from public.billing_accounts b
  where b.organization_id = p_organization_id
  for update;

  if not found then
    select d.limits, d.features into v_limits, v_features
    from private.billing_trial_defaults() as d;

    v_row.organization_id := p_organization_id;
    v_row.plan_key := 'trial';
    v_row.status := 'trialing';
    v_row.seats := private.billing_seats_from_limits(v_limits);
    v_row.addon_keys := '{}';
    v_row.limits := v_limits;
    v_row.features := v_features;
    v_row.trial_ends_at := now() + interval '14 days';
    v_row.cancel_at_period_end := false;
  end if;

  if v_row.stripe_customer_id is not null and v_row.stripe_customer_id <> v_customer then
    raise exception 'billing_customer_divergente' using errcode = 'P0001';
  end if;
  v_row.stripe_customer_id := v_customer;

  if p_payload ? 'stripe_subscription_id' then
    v_value := p_payload -> 'stripe_subscription_id';
    if jsonb_typeof(v_value) = 'null' then
      v_row.stripe_subscription_id := null;
    elsif jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') ~ '^sub_[A-Za-z0-9]{1,250}$' then
      v_row.stripe_subscription_id := v_value #>> '{}';
    else
      perform private.billing_invalid_field('stripe_subscription_id');
    end if;
  end if;

  v_value := p_payload -> 'plan_key';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') = any (v_plans) then
      v_row.plan_key := v_value #>> '{}';
    else
      perform private.billing_invalid_field('plan_key');
    end if;
  end if;

  if p_payload ? 'billing_interval' then
    v_value := p_payload -> 'billing_interval';
    if jsonb_typeof(v_value) = 'null' then
      v_row.billing_interval := null;
    elsif jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') in ('month', 'year') then
      v_row.billing_interval := v_value #>> '{}';
    else
      perform private.billing_invalid_field('billing_interval');
    end if;
  end if;

  v_value := p_payload -> 'status';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') = any (v_statuses) then
      v_row.status := v_value #>> '{}';
    else
      perform private.billing_invalid_field('status');
    end if;
  end if;

  v_value := p_payload -> 'seats';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if jsonb_typeof(v_value) = 'number'
       and (v_value #>> '{}') ~ '^[0-9]{1,5}$'
       and (v_value #>> '{}')::integer between 1 and 10000 then
      v_row.seats := (v_value #>> '{}')::integer;
    else
      perform private.billing_invalid_field('seats');
    end if;
  end if;

  v_value := p_payload -> 'addon_keys';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    v_keys := private.billing_jsonb_keys(v_value, 50, '^[a-z][a-z0-9_]{0,59}$');
    if v_keys is null then
      perform private.billing_invalid_field('addon_keys');
    end if;
    v_row.addon_keys := v_keys;
  end if;

  v_value := p_payload -> 'features';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    v_keys := private.billing_jsonb_keys(v_value, 100, '^feature_[a-z0-9_]{1,60}$');
    if v_keys is null then
      perform private.billing_invalid_field('features');
    end if;
    v_row.features := v_keys;
  end if;

  v_value := p_payload -> 'limits';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if not private.billing_limits_ok(v_value) then
      perform private.billing_invalid_field('limits');
    end if;
    v_row.limits := v_value;
  end if;

  if p_payload ? 'current_period_end' then
    v_value := p_payload -> 'current_period_end';
    if jsonb_typeof(v_value) = 'null' then
      v_row.current_period_end := null;
    else
      v_ts := private.billing_jsonb_timestamptz(v_value);
      if v_ts is null then
        perform private.billing_invalid_field('current_period_end');
      end if;
      v_row.current_period_end := v_ts;
    end if;
  end if;

  v_value := p_payload -> 'cancel_at_period_end';
  if v_value is not null and jsonb_typeof(v_value) <> 'null' then
    if jsonb_typeof(v_value) = 'boolean' then
      v_row.cancel_at_period_end := (v_value #>> '{}')::boolean;
    else
      perform private.billing_invalid_field('cancel_at_period_end');
    end if;
  end if;

  insert into public.billing_accounts as b (
    organization_id, stripe_customer_id, stripe_subscription_id, plan_key, billing_interval,
    status, seats, addon_keys, limits, features, trial_ends_at, current_period_end,
    cancel_at_period_end, synced_at
  )
  values (
    v_row.organization_id, v_row.stripe_customer_id, v_row.stripe_subscription_id, v_row.plan_key,
    v_row.billing_interval, v_row.status, v_row.seats, v_row.addon_keys, v_row.limits,
    v_row.features, v_row.trial_ends_at, v_row.current_period_end, v_row.cancel_at_period_end, now()
  )
  on conflict (organization_id) do update
  set stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      plan_key = excluded.plan_key,
      billing_interval = excluded.billing_interval,
      status = excluded.status,
      seats = excluded.seats,
      addon_keys = excluded.addon_keys,
      limits = excluded.limits,
      features = excluded.features,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      synced_at = excluded.synced_at;
end;
$$;

revoke all on function public.sync_billing_account(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_billing_account(text, uuid, jsonb) to anon, authenticated;

-- 9d. get_billing_account_ids: vínculo com a Stripe de uma imobiliária (webhook
-- confere o customer; ações de checkout/portal reaproveitam o customer).
-- Erros: 42501 chave (Acesso negado.); P0002 imobiliária inexistente.
create or replace function public.get_billing_account_ids(
  p_server_key text default null,
  p_organization_id uuid default null
)
returns table (
  stripe_customer_id text,
  stripe_subscription_id text,
  status text
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

  if p_organization_id is null
     or not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  return query
  select b.stripe_customer_id, b.stripe_subscription_id, b.status
  from public.billing_accounts b
  where b.organization_id = p_organization_id;
end;
$$;

revoke all on function public.get_billing_account_ids(text, uuid) from public, anon, authenticated;
grant execute on function public.get_billing_account_ids(text, uuid) to anon, authenticated;

-- 9e. list_billing_reminders (cron diário)
-- "Fim do período" e "fim da carência" seguem a mesma regra de billing_state.
-- p_kind (notice_date):
--   trial_ending_3d  estado trialing e fim do período em (agora + 2 dias, agora + 3 dias]
--                    (notice_date = fim do teste: trial_ends_at no teste local;
--                    current_period_end no trial criado na Stripe)
--   trial_ending_1d  estado trialing e fim do período em até 1 dia (idem)
--   past_due         status past_due, unpaid ou incomplete ainda na carência
--                    (notice_date = fim da carência, current_period_end + 7 dias)
--   read_only_today  entrou no modo leitura nas últimas 24 h
--                    (notice_date = fim da carência, quando o modo leitura começou)
-- Até 500 imobiliárias com ao menos um dono ativo com e-mail (e-mails em
-- minúsculas, sem repetição, em ordem alfabética). O slug monta o link do e-mail.
-- Erros: 42501 chave (Acesso negado.); 22023 tipo inválido.
create or replace function public.list_billing_reminders(
  p_server_key text default null,
  p_kind text default null
)
returns table (
  organization_id uuid,
  organization_slug text,
  organization_name text,
  owner_emails text[],
  notice_date timestamptz
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

  if p_kind is null
     or p_kind not in ('trial_ending_3d', 'trial_ending_1d', 'past_due', 'read_only_today') then
    raise exception 'Tipo de aviso inválido.' using errcode = '22023';
  end if;

  return query
  with accounts as (
    select
      b.organization_id as org_id,
      o.slug as org_slug,
      o.name as org_name,
      b.status as billing_status,
      private.billing_period_end(b.status, b.plan_key, b.trial_ends_at, b.current_period_end) as period_end,
      private.billing_grace_ends_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end) as grace_end,
      private.billing_state_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end, now()) as state
    from public.billing_accounts b
    join public.organizations o on o.id = b.organization_id
  )
  select
    a.org_id,
    a.org_slug,
    a.org_name,
    e.emails,
    case when p_kind like 'trial_%' then a.period_end else a.grace_end end
  from accounts a
  cross join lateral (
    select array_agg(distinct lower(u.email) order by lower(u.email)) as emails
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = a.org_id
      and m.role = 'owner'
      and m.active
      and u.email is not null
  ) e
  where e.emails is not null
    and case p_kind
      when 'trial_ending_3d' then
        a.state = 'trialing'
        and a.period_end > now() + interval '2 days'
        and a.period_end <= now() + interval '3 days'
      when 'trial_ending_1d' then
        a.state = 'trialing'
        and a.period_end <= now() + interval '1 day'
      when 'past_due' then
        a.billing_status in ('past_due', 'unpaid', 'incomplete') and a.state = 'grace'
      else
        a.state = 'read_only' and a.grace_end >= now() - interval '1 day'
    end
  order by case when p_kind like 'trial_%' then a.period_end else a.grace_end end, a.org_id
  limit 500;
end;
$$;

revoke all on function public.list_billing_reminders(text, text) from public, anon, authenticated;
grant execute on function public.list_billing_reminders(text, text) to anon, authenticated;
