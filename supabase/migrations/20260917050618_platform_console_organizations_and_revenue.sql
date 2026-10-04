-- =============================================================================
-- Console da Plataforma: Imobiliárias e Assinaturas e receita
-- =============================================================================
-- Área interna da equipe dona do SaaS (/plataforma/imobiliarias e
-- /plataforma/assinaturas). Mesmo contrato das RPCs do console
-- (20260917041803): security definer, search_path vazio, p_server_key
-- (segredo platform_server_key do Vault), EXECUTE só para anon, e toda mudança
-- grava o registro do console DENTRO da RPC, na mesma transação.
--
--  1. Bloqueio da plataforma na conta: billing_accounts.platform_blocked_at e
--     platform_blocked_reason. NÃO é um mecanismo novo de acesso: a conta
--     bloqueada entra no mesmo modo somente leitura da assinatura
--     (private.billing_state, que já decide escrita no CRM, uploads, importação,
--     feed dos portais, avisos por e-mail e propostas), a IA para
--     (private.ai_quota_context → billing_blocked) e o envio pelas conexões para
--     (private.connection_can_send, igual ao blocked_at por conexão). Como em
--     20260916073621_platform_block_keeps_tenant_switch, o eixo da plataforma
--     fica separado dos outros: a Stripe (status) não desbloqueia, e desbloquear
--     não mexe em nada da imobiliária nem das conexões. Nada é apagado.
--  2. private.billing_account_history: histórico de assinatura gravado por
--     gatilho em billing_accounts (plano, ciclo, status, fim do teste, fim do
--     período, cancelamento agendado e bloqueio). Base de "cancelamentos no mês".
--  3. Leitura: platform_list_organizations (lista paginada com busca e filtros),
--     platform_get_organization (ficha) e platform_list_revenue_accounts
--     (base de Assinaturas e receita; os cálculos ficam em
--     packages/core/src/platform/revenue.ts).
--  4. Ações: platform_set_organization_block (bloquear/desbloquear) e
--     platform_extend_trial (+7 ou +14 dias no teste grátis local).
--
-- Sem dado pessoal de cliente final: nenhuma RPC lê clients, leads (além da
-- contagem), proprietários ou mensagens. E-mail e nome aparecem só para os
-- MEMBROS da imobiliária na ficha (suporte), nunca na lista.

-- -----------------------------------------------------------------------------
-- 1. Bloqueio da plataforma na conta
-- -----------------------------------------------------------------------------
alter table public.billing_accounts
  add column platform_blocked_at timestamptz,
  add column platform_blocked_reason text
    constraint billing_accounts_platform_blocked_reason_check
      check (platform_blocked_reason is null or char_length(platform_blocked_reason) between 3 and 1000),
  add constraint billing_accounts_platform_block_consistency_check
    check ((platform_blocked_at is null) = (platform_blocked_reason is null));

comment on column public.billing_accounts.platform_blocked_at is
  'Bloqueio da plataforma (Console da Plataforma). Com valor, private.billing_state devolve read_only, a IA para e as conexões não enviam, seja qual for o status da Stripe. A sincronização da Stripe não mexe nesta coluna. Escrita só por platform_set_organization_block.';
comment on column public.billing_accounts.platform_blocked_reason is
  'Motivo do bloqueio escrito pela equipe da plataforma (3 a 1.000 caracteres). Fora do SELECT com sessão: só o console lê.';

-- Situação comercial da conta no console (teste, ativa, em atraso, cancelada,
-- bloqueada). Espelho de resolveAccountSituation em
-- packages/core/src/platform/accounts.ts.
create or replace function private.platform_account_situation(p_status text, p_blocked_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_blocked_at is not null then 'bloqueada'
    when p_status = 'trialing' then 'teste'
    when p_status = 'active' then 'ativa'
    when p_status in ('past_due', 'unpaid', 'incomplete') then 'em_atraso'
    else 'cancelada'
  end;
$$;

comment on function private.platform_account_situation(text, timestamptz) is
  'Situação da conta no Console da Plataforma: bloqueada (bloqueio da plataforma), teste (trialing), ativa (active), em_atraso (past_due, unpaid, incomplete) ou cancelada (o resto, inclusive sem conta).';

revoke all on function private.platform_account_situation(text, timestamptz) from public, anon, authenticated;

-- Estado de acesso: conta bloqueada pela plataforma = read_only.
create or replace function private.billing_state(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when b.platform_blocked_at is not null then 'read_only'
      else private.billing_state_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end, now())
    end
    from public.billing_accounts b
    where b.organization_id = org
  ), 'read_only');
$$;

comment on function private.billing_state(uuid) is
  'Estado de acesso da imobiliária (trialing, active, grace, read_only). Sem conta ou com bloqueio da plataforma (platform_blocked_at) = read_only.';

-- IA: a conta bloqueada cai em billing_blocked (reserve_ai_usage só libera
-- trialing e active).
create or replace function private.ai_quota_context(p_organization_id uuid, p_at timestamp with time zone)
returns table (
  period_start timestamp with time zone,
  period_end timestamp with time zone,
  plan_key text,
  billing_state text,
  conversations_limit integer,
  plan_cap_millicents bigint,
  overage_cap_millicents bigint,
  effective_cap_millicents bigint,
  day_cap_millicents bigint,
  week_cap_millicents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.ai_period_start(coalesce(b.current_period_end, b.trial_ends_at), p_at),
    private.ai_period_start(coalesce(b.current_period_end, b.trial_ends_at), p_at) + interval '1 month',
    b.plan_key,
    case
      when b.platform_blocked_at is not null then 'read_only'
      else private.billing_state_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end, p_at)
    end,
    -- Convenção de limits: chave ausente ou não numérica = ilimitado (null → -1).
    coalesce(
      case
        when jsonb_typeof(b.limits -> 'ai_conversations') = 'number'
             and (b.limits ->> 'ai_conversations') ~ '^(-1|[0-9]{1,9})$'
          then (b.limits ->> 'ai_conversations')::integer
      end,
      -1
    ),
    private.ai_cost_cap_cents(b.plan_key)::bigint * 1000,
    b.ai_overage_cap_cents::bigint * 1000,
    (private.ai_cost_cap_cents(b.plan_key) + b.ai_overage_cap_cents)::bigint * 1000,
    private.ai_daily_cap_cents(private.ai_cost_cap_cents(b.plan_key) + b.ai_overage_cap_cents)::bigint * 1000,
    private.ai_weekly_cap_cents(private.ai_cost_cap_cents(b.plan_key) + b.ai_overage_cap_cents)::bigint * 1000
  from public.billing_accounts b
  where b.organization_id = p_organization_id;
$$;

-- Conexões: bloqueio da conta para o envio, sem tocar no blocked_at nem no
-- enabled de cada conexão (desbloquear devolve tudo como estava).
create or replace function private.connection_can_send(p_connected_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.connected_accounts ca
    where ca.id = p_connected_account_id
      and ca.status = 'connected'
      and ca.enabled
      and ca.blocked_at is null
      and not exists (
        select 1
        from public.billing_accounts b
        where b.organization_id = ca.organization_id
          and b.platform_blocked_at is not null
      )
  );
$$;

comment on function private.connection_can_send(uuid) is
  'Verdadeiro só quando a conexão está conectada, ligada pela imobiliária, sem bloqueio da plataforma na conexão e sem bloqueio da plataforma na conta (billing_accounts.platform_blocked_at).';

-- Resumo da assinatura com sessão: estado read_only e platform_blocked = true
-- quando a plataforma bloqueou a conta (o CRM já mostra o modo somente leitura
-- pelo estado; o motivo não sai daqui).
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
    'state', case
      when v_row.platform_blocked_at is not null then 'read_only'
      else private.billing_state_at(v_row.status, v_row.plan_key, v_row.trial_ends_at, v_row.current_period_end, now())
    end,
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
    'platform_blocked', v_row.platform_blocked_at is not null,
    'synced_at', v_row.synced_at
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Histórico de assinatura
-- -----------------------------------------------------------------------------
create table private.billing_account_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  source text not null
    constraint billing_account_history_source_check
      check (source in ('inicial', 'criacao', 'stripe', 'plataforma')),
  changed_fields text[] not null default '{}'
    constraint billing_account_history_changed_fields_check
      check (cardinality(changed_fields) <= 10 and array_position(changed_fields, null) is null),
  plan_key text,
  billing_interval text,
  status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  platform_blocked boolean not null default false
);

comment on table private.billing_account_history is
  'Histórico de assinatura por imobiliária, gravado pelo gatilho billing_accounts_history: uma linha na criação e a cada mudança de plano, ciclo, status, fim do teste, fim do período, cancelamento agendado ou bloqueio da plataforma. Guarda o estado DEPOIS da mudança. Sem dado pessoal. Só leitura pelas RPCs do Console da Plataforma.';
comment on column private.billing_account_history.source is
  'inicial (retrato gravado quando o histórico começou), criacao (conta criada), stripe (sincronização da Stripe: synced_at mudou) ou plataforma (mudança fora da sincronização, ex.: Console da Plataforma).';
comment on column private.billing_account_history.changed_fields is
  'Colunas de billing_accounts que mudaram nesta linha (vazio em inicial e criacao).';

create index billing_account_history_organization_idx
  on private.billing_account_history (organization_id, occurred_at desc);

create index billing_account_history_canceled_idx
  on private.billing_account_history (occurred_at)
  where status = 'canceled';

alter table private.billing_account_history enable row level security;

revoke all on private.billing_account_history from public, anon, authenticated;

create or replace function private.record_billing_account_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[] := '{}';
begin
  if tg_op = 'UPDATE' then
    if new.plan_key is distinct from old.plan_key then
      v_changed := array_append(v_changed, 'plan_key');
    end if;
    if new.billing_interval is distinct from old.billing_interval then
      v_changed := array_append(v_changed, 'billing_interval');
    end if;
    if new.status is distinct from old.status then
      v_changed := array_append(v_changed, 'status');
    end if;
    if new.trial_ends_at is distinct from old.trial_ends_at then
      v_changed := array_append(v_changed, 'trial_ends_at');
    end if;
    if new.current_period_end is distinct from old.current_period_end then
      v_changed := array_append(v_changed, 'current_period_end');
    end if;
    if new.cancel_at_period_end is distinct from old.cancel_at_period_end then
      v_changed := array_append(v_changed, 'cancel_at_period_end');
    end if;
    if (new.platform_blocked_at is null) <> (old.platform_blocked_at is null) then
      v_changed := array_append(v_changed, 'platform_blocked');
    end if;

    if cardinality(v_changed) = 0 then
      return null;
    end if;
  end if;

  insert into private.billing_account_history (
    organization_id, source, changed_fields, plan_key, billing_interval, status,
    trial_ends_at, current_period_end, cancel_at_period_end, platform_blocked
  )
  values (
    new.organization_id,
    case
      when tg_op = 'INSERT' then 'criacao'
      when new.synced_at is distinct from old.synced_at then 'stripe'
      else 'plataforma'
    end,
    v_changed, new.plan_key, new.billing_interval, new.status, new.trial_ends_at,
    new.current_period_end, new.cancel_at_period_end, new.platform_blocked_at is not null
  );

  return null;
end;
$$;

comment on function private.record_billing_account_history() is
  'Gatilho de billing_accounts: grava em private.billing_account_history a criação e cada mudança relevante da assinatura.';

revoke all on function private.record_billing_account_history() from public, anon, authenticated;

create trigger billing_accounts_history
  after insert or update on public.billing_accounts
  for each row execute function private.record_billing_account_history();

-- Retrato inicial das contas que já existem (idempotente).
insert into private.billing_account_history (
  organization_id, source, plan_key, billing_interval, status, trial_ends_at,
  current_period_end, cancel_at_period_end, platform_blocked
)
select
  b.organization_id, 'inicial', b.plan_key, b.billing_interval, b.status, b.trial_ends_at,
  b.current_period_end, b.cancel_at_period_end, b.platform_blocked_at is not null
from public.billing_accounts b
where not exists (
  select 1 from private.billing_account_history h where h.organization_id = b.organization_id
);

-- -----------------------------------------------------------------------------
-- 3. Leitura
-- -----------------------------------------------------------------------------

-- Números de uma imobiliária para o console (só contagens e datas).
--   active_members      membros ativos
--   owned_listings      imóveis com foto (private.owned_listing_count, a régua do plano)
--   leads_last_30_days  leads criados nos últimos 30 dias (só a contagem)
--   ai_*                custo de IA do ciclo atual x teto efetivo (plano + excedente)
--   last_sign_in_at     último login de algum membro ativo
--   last_audit_event_at último evento do registro da imobiliária (audit_events)
create or replace function private.platform_organization_metrics(p_organization_id uuid, p_at timestamptz)
returns table (
  active_members integer,
  owned_listings integer,
  leads_last_30_days integer,
  ai_cost_cents integer,
  ai_cap_cents integer,
  ai_period_start timestamptz,
  ai_period_end timestamptz,
  last_sign_in_at timestamptz,
  last_audit_event_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      select count(*)::integer
      from public.memberships m
      where m.organization_id = p_organization_id
        and m.active
    ),
    coalesce(private.owned_listing_count(p_organization_id), 0),
    (
      select count(*)::integer
      from public.leads l
      where l.organization_id = p_organization_id
        and l.created_at >= p_at - interval '30 days'
    ),
    ai.cost_cents,
    ai.cap_cents,
    ai.period_start,
    ai.period_end,
    (
      select max(u.last_sign_in_at)
      from public.memberships m
      join auth.users u on u.id = m.user_id
      where m.organization_id = p_organization_id
        and m.active
    ),
    (
      select max(e.created_at)
      from public.audit_events e
      where e.organization_id = p_organization_id
    )
  from (select 1) as one
  left join lateral (
    select
      round(coalesce(up.cost_millicents, 0) / 1000.0)::integer as cost_cents,
      (ctx.effective_cap_millicents / 1000)::integer as cap_cents,
      ctx.period_start,
      ctx.period_end
    from private.ai_quota_context(p_organization_id, p_at) ctx
    left join public.ai_usage_periods up
      on up.organization_id = p_organization_id
     and up.period_start = ctx.period_start
  ) ai on true;
$$;

comment on function private.platform_organization_metrics(uuid, timestamptz) is
  'Números de uma imobiliária para o Console da Plataforma: membros ativos, imóveis com foto, leads dos últimos 30 dias (contagem), custo e teto de IA do ciclo, último login de membro e último evento do registro da imobiliária. Sem dado pessoal.';

revoke all on function private.platform_organization_metrics(uuid, timestamptz) from public, anon, authenticated;

-- Lista paginada de imobiliárias.
--   p_search    nome (sem acento), subdomínio ou e-mail de um dono ativo; até 100 caracteres
--   p_situation teste | ativa | em_atraso | cancelada | bloqueada | null (todas)
--   p_plan      trial | corretor | imobiliaria | equipe | rede | null (todos)
--   p_limit     1 a 100 (padrão 25); p_offset 0 a 100.000
-- Ordem: mais novas primeiro. total_count = total com os filtros (igual em
-- todas as linhas). O e-mail do dono só filtra: não sai na resposta.
-- Erros: 42501 chave; 22023 filtro inválido.
create or replace function public.platform_list_organizations(
  p_server_key text,
  p_search text default null,
  p_situation text default null,
  p_plan text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  organization_id uuid,
  name text,
  slug text,
  created_at timestamptz,
  plan_key text,
  billing_interval text,
  status text,
  situation text,
  access_state text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  platform_blocked_at timestamptz,
  active_members integer,
  owned_listings integer,
  leads_last_30_days integer,
  ai_cost_cents integer,
  ai_cap_cents integer,
  last_activity_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_now constant timestamptz := now();
  v_limit constant integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset constant integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
  v_term text := nullif(btrim(left(coalesce(p_search, ''), 100)), '');
  v_ids uuid[];
  v_total bigint;
begin
  perform private.check_platform_server_key(p_server_key);

  if p_situation is not null
     and p_situation not in ('teste', 'ativa', 'em_atraso', 'cancelada', 'bloqueada') then
    raise exception 'Situação inválida.' using errcode = '22023';
  end if;

  if p_plan is not null and p_plan not in ('trial', 'corretor', 'imobiliaria', 'equipe', 'rede') then
    raise exception 'Plano inválido.' using errcode = '22023';
  end if;

  if v_term is not null then
    v_term := '%' || replace(replace(replace(private.search_normalize(v_term), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(array_agg(f.id order by f.created_at desc, f.id), '{}'::uuid[])
  into v_ids
  from (
    select o.id, o.created_at
    from public.organizations o
    left join public.billing_accounts b on b.organization_id = o.id
    where (
        v_term is null
        or private.search_normalize(o.name) like v_term
        or lower(o.slug) like v_term
        or exists (
          select 1
          from public.memberships m
          join auth.users u on u.id = m.user_id
          where m.organization_id = o.id
            and m.role = 'owner'
            and m.active
            and lower(u.email) like v_term
        )
      )
      and (
        p_situation is null
        or private.platform_account_situation(b.status, b.platform_blocked_at) = p_situation
      )
      and (p_plan is null or b.plan_key = p_plan)
  ) f;

  v_total := cardinality(v_ids);

  return query
  select
    o.id,
    o.name,
    o.slug,
    o.created_at,
    b.plan_key,
    b.billing_interval,
    b.status,
    private.platform_account_situation(b.status, b.platform_blocked_at),
    case
      when b.organization_id is null or b.platform_blocked_at is not null then 'read_only'
      else private.billing_state_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end, v_now)
    end,
    b.trial_ends_at,
    b.current_period_end,
    coalesce(b.cancel_at_period_end, false),
    b.platform_blocked_at,
    mt.active_members,
    mt.owned_listings,
    mt.leads_last_30_days,
    mt.ai_cost_cents,
    mt.ai_cap_cents,
    greatest(mt.last_sign_in_at, mt.last_audit_event_at),
    v_total
  from unnest(v_ids[v_offset + 1 : v_offset + v_limit]) with ordinality as p (id, ord)
  join public.organizations o on o.id = p.id
  left join public.billing_accounts b on b.organization_id = o.id
  cross join lateral private.platform_organization_metrics(o.id, v_now) mt
  order by p.ord;
end;
$$;

comment on function public.platform_list_organizations(text, text, text, text, integer, integer) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: lista paginada de todas as imobiliárias com plano, situação da assinatura, datas, membros ativos, imóveis com foto, leads dos últimos 30 dias (contagem), IA do ciclo e última atividade. Busca por nome, subdomínio ou e-mail do dono (o e-mail não sai na resposta). Sem dado pessoal de cliente final.';

-- Ficha de uma imobiliária (jsonb):
--   organization { id, name, slug, created_at }
--   billing { plan_key, billing_interval, status, situation, access_state, seats,
--             trial_ends_at, current_period_end, cancel_at_period_end, synced_at,
--             first_paid_at, plan_net_monthly_cents, has_customer, has_subscription,
--             platform_blocked_at, platform_blocked_reason }
--   metrics { active_members, owned_listings, leads_last_30_days, ai_cost_cents,
--             ai_cap_cents, ai_period_start, ai_period_end, last_sign_in_at,
--             last_audit_event_at, last_activity_at }
--   members [{ name, email, role, active, joined_at, last_sign_in_at }]  (equipe
--             da imobiliária, para suporte; nada de clientes ou leads)
--   history [{ occurred_at, source, changed_fields, plan_key, billing_interval,
--             status, trial_ends_at, current_period_end, cancel_at_period_end,
--             platform_blocked }]  (até 50, mais novo primeiro)
-- Erros: 42501 chave; P0002 imobiliária inexistente.
create or replace function public.platform_get_organization(
  p_server_key text,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_org public.organizations%rowtype;
  v_billing public.billing_accounts%rowtype;
  v_has_billing boolean;
  v_metrics record;
begin
  perform private.check_platform_server_key(p_server_key);

  select o.* into v_org
  from public.organizations o
  where o.id = p_organization_id;

  if not found then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  select b.* into v_billing
  from public.billing_accounts b
  where b.organization_id = p_organization_id;

  v_has_billing := found;

  select * into v_metrics
  from private.platform_organization_metrics(p_organization_id, v_now);

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'slug', v_org.slug,
      'created_at', v_org.created_at
    ),
    'billing', case when v_has_billing then jsonb_build_object(
      'plan_key', v_billing.plan_key,
      'billing_interval', v_billing.billing_interval,
      'status', v_billing.status,
      'situation', private.platform_account_situation(v_billing.status, v_billing.platform_blocked_at),
      'access_state', case
        when v_billing.platform_blocked_at is not null then 'read_only'
        else private.billing_state_at(
          v_billing.status, v_billing.plan_key, v_billing.trial_ends_at, v_billing.current_period_end, v_now)
      end,
      'seats', v_billing.seats,
      'trial_ends_at', v_billing.trial_ends_at,
      'current_period_end', v_billing.current_period_end,
      'cancel_at_period_end', v_billing.cancel_at_period_end,
      'synced_at', v_billing.synced_at,
      'first_paid_at', v_billing.first_paid_at,
      'plan_net_monthly_cents', v_billing.plan_net_monthly_cents,
      'has_customer', v_billing.stripe_customer_id is not null,
      'has_subscription', v_billing.stripe_subscription_id is not null,
      'platform_blocked_at', v_billing.platform_blocked_at,
      'platform_blocked_reason', v_billing.platform_blocked_reason
    ) end,
    'metrics', jsonb_build_object(
      'active_members', v_metrics.active_members,
      'owned_listings', v_metrics.owned_listings,
      'leads_last_30_days', v_metrics.leads_last_30_days,
      'ai_cost_cents', v_metrics.ai_cost_cents,
      'ai_cap_cents', v_metrics.ai_cap_cents,
      'ai_period_start', v_metrics.ai_period_start,
      'ai_period_end', v_metrics.ai_period_end,
      'last_sign_in_at', v_metrics.last_sign_in_at,
      'last_audit_event_at', v_metrics.last_audit_event_at,
      'last_activity_at', greatest(v_metrics.last_sign_in_at, v_metrics.last_audit_event_at)
    ),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', nullif(btrim(coalesce(pr.full_name, '')), ''),
          'email', lower(u.email),
          'role', m.role,
          'active', m.active,
          'joined_at', m.created_at,
          'last_sign_in_at', u.last_sign_in_at
        )
        order by m.active desc,
          array_position(
            array['owner', 'manager', 'broker', 'capturer', 'assistant', 'finance']::text[], m.role::text),
          lower(coalesce(pr.full_name, u.email, ''))
      )
      from public.memberships m
      join auth.users u on u.id = m.user_id
      left join public.profiles pr on pr.id = m.user_id
      where m.organization_id = p_organization_id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'occurred_at', h.occurred_at,
          'source', h.source,
          'changed_fields', to_jsonb(h.changed_fields),
          'plan_key', h.plan_key,
          'billing_interval', h.billing_interval,
          'status', h.status,
          'trial_ends_at', h.trial_ends_at,
          'current_period_end', h.current_period_end,
          'cancel_at_period_end', h.cancel_at_period_end,
          'platform_blocked', h.platform_blocked
        )
        order by h.occurred_at desc, h.id desc
      )
      from (
        select *
        from private.billing_account_history hh
        where hh.organization_id = p_organization_id
        order by hh.occurred_at desc, hh.id desc
        limit 50
      ) h
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.platform_get_organization(text, uuid) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: ficha de uma imobiliária para o Console da Plataforma (dados da conta, assinatura, números, membros com nome, papel e e-mail para suporte, e histórico de assinatura). Nenhum dado de cliente ou lead da imobiliária.';

-- Base de "Assinaturas e receita": uma linha por conta (até 20.000), só o
-- necessário para MRR, contagens, testes acabando, inadimplentes, cancelamentos
-- e novas assinaturas (cálculo em packages/core/src/platform/revenue.ts).
-- canceled_at = última vez que o histórico registrou a mudança para canceled.
-- Erros: 42501 chave.
create or replace function public.platform_list_revenue_accounts(p_server_key text)
returns table (
  organization_id uuid,
  name text,
  slug text,
  organization_created_at timestamptz,
  plan_key text,
  billing_interval text,
  status text,
  seats integer,
  plan_net_monthly_cents integer,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  first_paid_at timestamptz,
  canceled_at timestamptz,
  platform_blocked_at timestamptz,
  has_subscription boolean,
  synced_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.check_platform_server_key(p_server_key);

  return query
  select
    o.id,
    o.name,
    o.slug,
    o.created_at,
    b.plan_key,
    b.billing_interval,
    b.status,
    b.seats,
    b.plan_net_monthly_cents,
    b.trial_ends_at,
    b.current_period_end,
    b.cancel_at_period_end,
    b.first_paid_at,
    (
      select max(h.occurred_at)
      from private.billing_account_history h
      where h.organization_id = b.organization_id
        and h.status = 'canceled'
        and 'status' = any (h.changed_fields)
    ),
    b.platform_blocked_at,
    b.stripe_subscription_id is not null,
    b.synced_at
  from public.billing_accounts b
  join public.organizations o on o.id = b.organization_id
  order by o.created_at desc, o.id
  limit 20000;
end;
$$;

comment on function public.platform_list_revenue_accounts(text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: uma linha por conta de assinatura (espelho da Stripe em billing_accounts) com o mínimo para calcular receita recorrente, contagens, testes acabando, inadimplentes, cancelamentos e novas assinaturas. Sem ids da Stripe e sem dado pessoal.';

-- -----------------------------------------------------------------------------
-- 4. Ações (motivo obrigatório; registro do console na mesma transação)
-- -----------------------------------------------------------------------------

-- Motivo: 3 a 1.000 caracteres depois de tirar espaços; senão 22023.
create or replace function private.platform_require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reason constant text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 or char_length(v_reason) > 1000 then
    raise exception 'motivo_obrigatorio' using errcode = '22023';
  end if;

  return v_reason;
end;
$$;

comment on function private.platform_require_reason(text) is
  'Motivo de ação do Console da Plataforma sem espaços nas pontas; levanta 22023 (motivo_obrigatorio) fora de 3 a 1.000 caracteres.';

revoke all on function private.platform_require_reason(text) from public, anon, authenticated;

-- Bloquear (p_blocked = true) ou desbloquear (false) a conta.
-- Retorno: { blocked, blocked_at }.
-- Erros: 42501 chave ou conta da equipe inválida; 22023 motivo ou p_blocked;
--        P0002 imobiliária inexistente; P0001 conta_ja_bloqueada | conta_nao_bloqueada.
create or replace function public.platform_set_organization_block(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_organization_id uuid,
  p_blocked boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_reason text;
  v_row public.billing_accounts%rowtype;
  v_blocked_at timestamptz;
begin
  perform private.check_platform_server_key(p_server_key);

  if p_blocked is null then
    raise exception 'Informe se a conta deve ser bloqueada ou desbloqueada.' using errcode = '22023';
  end if;

  v_reason := private.platform_require_reason(p_reason);

  select b.* into v_row
  from public.billing_accounts b
  where b.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  if p_blocked and v_row.platform_blocked_at is not null then
    raise exception 'conta_ja_bloqueada' using errcode = 'P0001';
  end if;

  if not p_blocked and v_row.platform_blocked_at is null then
    raise exception 'conta_nao_bloqueada' using errcode = 'P0001';
  end if;

  v_blocked_at := case when p_blocked then v_now end;

  update public.billing_accounts b
  set platform_blocked_at = v_blocked_at,
      platform_blocked_reason = case when p_blocked then v_reason end
  where b.organization_id = p_organization_id;

  perform private.record_platform_audit_event(
    p_actor_user_id,
    p_actor_email,
    case when p_blocked then 'organizacao.bloquear' else 'organizacao.desbloquear' end,
    'organizacao',
    p_organization_id::text,
    p_organization_id,
    v_reason,
    jsonb_build_object(
      'bloqueada', v_row.platform_blocked_at is not null,
      'bloqueada_em', v_row.platform_blocked_at,
      'situacao', private.platform_account_situation(v_row.status, v_row.platform_blocked_at)
    ),
    jsonb_build_object(
      'bloqueada', p_blocked,
      'bloqueada_em', v_blocked_at,
      'situacao', private.platform_account_situation(v_row.status, v_blocked_at)
    )
  );

  return jsonb_build_object('blocked', p_blocked, 'blocked_at', v_blocked_at);
end;
$$;

comment on function public.platform_set_organization_block(text, uuid, text, uuid, boolean, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: bloqueia ou desbloqueia a conta (billing_accounts.platform_blocked_at). Bloqueada = somente leitura, IA e envio pelas conexões parados; nada é apagado. Motivo obrigatório; grava organizacao.bloquear ou organizacao.desbloquear no registro do console na mesma transação.';

-- Prorrogar o teste grátis local em 7 ou 14 dias. Só conta em teste local
-- (status trialing, plan_key trial e sem assinatura na Stripe): o teste é do
-- banco (trial_ends_at, que a sincronização da Stripe nunca muda), então não há
-- chamada à Stripe. A contagem parte do fim atual ou de agora, o que for maior
-- (teste já vencido volta a valer por p_days a partir de agora), e o novo fim
-- não passa de agora + 45 dias.
-- Retorno: { trial_ends_at_before, trial_ends_at }.
-- Erros: 42501 chave ou conta da equipe inválida; 22023 motivo ou dias;
--        P0002 imobiliária inexistente; P0001 conta_fora_do_teste |
--        teste_controlado_pela_stripe | limite_de_prorrogacao.
create or replace function public.platform_extend_trial(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_organization_id uuid,
  p_days integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_reason text;
  v_row public.billing_accounts%rowtype;
  v_new_end timestamptz;
begin
  perform private.check_platform_server_key(p_server_key);

  if p_days is null or p_days not in (7, 14) then
    raise exception 'dias_invalidos' using errcode = '22023';
  end if;

  v_reason := private.platform_require_reason(p_reason);

  select b.* into v_row
  from public.billing_accounts b
  where b.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  if v_row.status <> 'trialing' then
    raise exception 'conta_fora_do_teste' using errcode = 'P0001';
  end if;

  if v_row.plan_key <> 'trial' or v_row.stripe_subscription_id is not null then
    raise exception 'teste_controlado_pela_stripe' using errcode = 'P0001';
  end if;

  v_new_end := greatest(v_row.trial_ends_at, v_now) + make_interval(days => p_days);

  if v_new_end > v_now + interval '45 days' then
    raise exception 'limite_de_prorrogacao' using errcode = 'P0001';
  end if;

  update public.billing_accounts b
  set trial_ends_at = v_new_end
  where b.organization_id = p_organization_id;

  perform private.record_platform_audit_event(
    p_actor_user_id,
    p_actor_email,
    'assinatura.prorrogar_teste',
    'organizacao',
    p_organization_id::text,
    p_organization_id,
    v_reason,
    jsonb_build_object(
      'fim_do_teste', v_row.trial_ends_at,
      'situacao_de_acesso', private.billing_state_at(
        v_row.status, v_row.plan_key, v_row.trial_ends_at, v_row.current_period_end, v_now)
    ),
    jsonb_build_object(
      'fim_do_teste', v_new_end,
      'dias', p_days,
      'situacao_de_acesso', private.billing_state_at(
        v_row.status, v_row.plan_key, v_new_end, v_row.current_period_end, v_now)
    )
  );

  return jsonb_build_object('trial_ends_at_before', v_row.trial_ends_at, 'trial_ends_at', v_new_end);
end;
$$;

comment on function public.platform_extend_trial(text, uuid, text, uuid, integer, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: prorroga em 7 ou 14 dias o teste grátis local (status trialing, plan_key trial, sem assinatura na Stripe), contando do fim atual ou de agora, até agora + 45 dias. Não chama a Stripe. Motivo obrigatório; grava assinatura.prorrogar_teste no registro do console na mesma transação.';

-- -----------------------------------------------------------------------------
-- Privilégios: RPCs com chave do servidor só para anon (o servidor chama sem sessão)
-- -----------------------------------------------------------------------------
revoke all on function public.platform_list_organizations(text, text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.platform_get_organization(text, uuid) from public, anon, authenticated;
revoke all on function public.platform_list_revenue_accounts(text) from public, anon, authenticated;
revoke all on function public.platform_set_organization_block(text, uuid, text, uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.platform_extend_trial(text, uuid, text, uuid, integer, text)
  from public, anon, authenticated;

grant execute on function public.platform_list_organizations(text, text, text, text, integer, integer) to anon;
grant execute on function public.platform_get_organization(text, uuid) to anon;
grant execute on function public.platform_list_revenue_accounts(text) to anon;
grant execute on function public.platform_set_organization_block(text, uuid, text, uuid, boolean, text) to anon;
grant execute on function public.platform_extend_trial(text, uuid, text, uuid, integer, text) to anon;
