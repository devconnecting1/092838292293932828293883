-- =============================================================================
-- 2900 - Comissionamento: tabela por imobiliária, divisão, extrato e desconto
-- =============================================================================
--  1. Enums
--  2. public.commission_settings (gerente que recebe, limite de desconto)
--  3. public.commission_rules (tabela versionada; o valor antigo nunca some)
--  4. public.commissions e public.commission_shares (o negócio fechado)
--  5. public.proposal_discount_requests (aprovação de desconto)
--  6. Cálculo: private.commission_total_cents e private.commission_split
--  7. Proposta aceita vira comissão (trigger AFTER UPDATE em proposals)
--  8. Trava de desconto (trigger BEFORE em proposals) e RPCs de aprovação
--  9. Pagamento das partes, parceiro externo e resumo do extrato
-- 10. RLS, grants por coluna, auditoria e modo somente leitura
-- 11. Semente por imobiliária e backfill
--
-- DINHEIRO: as tabelas deste módulo guardam CENTAVOS INTEIROS (bigint). O valor
-- da proposta é numeric(14,2) e entra como round(amount * 100). Nada de float.
--
-- ARREDONDAMENTO DA DIVISÃO (igual a packages/core/src/comissoes/split.ts):
--   1. papel sem pessoa tem o percentual REDIRECIONADO PARA A IMOBILIÁRIA;
--   2. cada papel que não é a imobiliária recebe round(total * percentual);
--   3. a IMOBILIÁRIA FICA COM A SOBRA (total - soma dos demais), e é isso que
--      faz a divisão fechar o centavo exato em qualquer valor;
--   4. se o arredondamento passar do total (só acontece com a imobiliária em
--      0%), a diferença sai da maior parte; empate resolve na ordem parceiro,
--      gerência, atendimento, captação.
-- A soma das partes é sempre exatamente o total da comissão: quem garante é o
-- constraint trigger commission_shares_total (deferrable).
--
-- REGRA CONGELADA: a comissão guarda rule_id E rule_snapshot (cópia jsonb da
-- regra vigente no fechamento). commission_rules é append-only: gravar uma
-- tabela nova fecha a anterior com effective_to e cria outra linha. Mudar a
-- tabela hoje não altera nenhum negócio antigo.

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
do $$
begin
  create type public.commission_basis as enum ('percent', 'fixed');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.commission_role as enum
    ('capturer', 'seller', 'manager', 'agency', 'partner');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.commission_status as enum
    ('pending', 'partially_paid', 'paid', 'canceled');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.discount_request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. public.commission_settings
-- -----------------------------------------------------------------------------
create table if not exists public.commission_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- Quem recebe a fatia de "gerência". Sem gerente escolhido, essa fatia fica
  -- com a imobiliária (regra 1 do arredondamento).
  manager_user_id uuid references auth.users (id) on delete set null,
  -- Trava de desconto: desligada por padrão (nenhuma proposta muda de
  -- comportamento até a imobiliária ligar).
  discount_approval_enabled boolean not null default false,
  max_discount_percent numeric(6, 3) not null default 10
    constraint commission_settings_max_discount_range
    check (max_discount_percent >= 0 and max_discount_percent <= 100),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commission_settings_manager_idx
  on public.commission_settings (manager_user_id);

comment on table public.commission_settings is
  'Ajustes de comissionamento por imobiliária: gerente que recebe a fatia de gerência e limite de desconto que dispensa aprovação.';

-- -----------------------------------------------------------------------------
-- 3. public.commission_rules (tabela de comissão, versionada)
-- -----------------------------------------------------------------------------
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Tipo de negócio: a tabela é diferente para venda e para locação.
  purpose public.listing_purpose not null
    constraint commission_rules_purpose_single check (purpose in ('sale', 'rent')),
  basis public.commission_basis not null default 'percent',
  percent numeric(6, 3) not null default 0
    constraint commission_rules_percent_range check (percent >= 0 and percent <= 100),
  fixed_cents bigint not null default 0
    constraint commission_rules_fixed_range check (fixed_cents >= 0 and fixed_cents <= 99999999999999),
  -- Divisão padrão. Os cinco percentuais precisam somar exatamente 100.
  capturer_percent numeric(6, 3) not null default 0
    constraint commission_rules_capturer_range check (capturer_percent between 0 and 100),
  seller_percent numeric(6, 3) not null default 0
    constraint commission_rules_seller_range check (seller_percent between 0 and 100),
  manager_percent numeric(6, 3) not null default 0
    constraint commission_rules_manager_range check (manager_percent between 0 and 100),
  agency_percent numeric(6, 3) not null default 0
    constraint commission_rules_agency_range check (agency_percent between 0 and 100),
  partner_percent numeric(6, 3) not null default 0
    constraint commission_rules_partner_range check (partner_percent between 0 and 100),
  note text check (char_length(note) <= 500),
  -- Vigência. effective_to nulo = regra em vigor. O banco preenche as duas.
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint commission_rules_split_closes check (
    capturer_percent + seller_percent + manager_percent + agency_percent + partner_percent = 100
  ),
  constraint commission_rules_basis_value check (
    (basis = 'percent' and fixed_cents = 0) or (basis = 'fixed' and percent = 0)
  ),
  constraint commission_rules_period check (effective_to is null or effective_to >= effective_from)
);
-- Só uma regra em vigor por tipo de negócio; o histórico fica com effective_to.
create unique index if not exists commission_rules_current_key
  on public.commission_rules (organization_id, purpose)
  where effective_to is null;
create index if not exists commission_rules_history_idx
  on public.commission_rules (organization_id, purpose, effective_from desc);
create index if not exists commission_rules_created_by_idx
  on public.commission_rules (created_by);

comment on table public.commission_rules is
  'Tabela de comissão por imobiliária e tipo de negócio, versionada: gravar uma nova fecha a anterior (effective_to) em vez de sobrescrever. Só INSERT; UPDATE e DELETE não são concedidos.';

-- -----------------------------------------------------------------------------
-- 4. public.commissions e public.commission_shares
-- -----------------------------------------------------------------------------
create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Os vínculos são "set null" e os dados do negócio ficam copiados: apagar o
  -- imóvel ou o cliente não pode apagar o histórico de dinheiro.
  proposal_id uuid references public.proposals (id) on delete set null,
  property_id uuid references public.properties (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  property_code text check (char_length(property_code) <= 40),
  property_title text check (char_length(property_title) <= 200),
  client_name text check (char_length(client_name) <= 200),
  purpose public.listing_purpose not null
    constraint commissions_purpose_single check (purpose in ('sale', 'rent')),
  -- Valor do negócio fechado, em centavos (proposals.amount * 100).
  deal_amount_cents bigint not null
    constraint commissions_deal_range check (deal_amount_cents >= 0),
  total_cents bigint not null
    constraint commissions_total_range check (total_cents >= 0),
  rule_id uuid references public.commission_rules (id) on delete set null,
  -- Congelamento da regra: basis, percentual e divisão como estavam no fechamento.
  rule_snapshot jsonb not null,
  status public.commission_status not null default 'pending',
  closed_at timestamptz not null default now(),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists commissions_proposal_key
  on public.commissions (proposal_id)
  where proposal_id is not null;
create index if not exists commissions_organization_status_idx
  on public.commissions (organization_id, status);
create index if not exists commissions_organization_closed_idx
  on public.commissions (organization_id, closed_at desc);
create index if not exists commissions_property_idx on public.commissions (property_id);
create index if not exists commissions_client_idx on public.commissions (client_id);
create index if not exists commissions_rule_idx on public.commissions (rule_id);

comment on table public.commissions is
  'Comissão de um negócio fechado (proposta aceita). rule_snapshot congela a regra vigente no fechamento: mudar a tabela depois não altera esta linha.';

create table if not exists public.commission_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  commission_id uuid not null references public.commissions (id) on delete cascade,
  role public.commission_role not null,
  -- Pessoa da equipe dona da parte. Nulo na imobiliária e no parceiro externo.
  user_id uuid references auth.users (id) on delete set null,
  partner_name text check (char_length(partner_name) <= 160),
  percent numeric(6, 3) not null
    constraint commission_shares_percent_range check (percent >= 0 and percent <= 100),
  amount_cents bigint not null
    constraint commission_shares_amount_range check (amount_cents >= 0),
  paid_at timestamptz,
  paid_note text check (char_length(paid_note) <= 500),
  paid_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_shares_role_key unique (commission_id, role),
  constraint commission_shares_owner check (
    case role
      when 'agency' then user_id is null and partner_name is null
      when 'partner' then user_id is null
      else partner_name is null
    end
  ),
  constraint commission_shares_paid_columns check (
    paid_at is not null or (paid_by is null and paid_note is null)
  )
);
create index if not exists commission_shares_commission_idx
  on public.commission_shares (commission_id);
create index if not exists commission_shares_user_idx
  on public.commission_shares (organization_id, user_id);
create index if not exists commission_shares_pending_idx
  on public.commission_shares (organization_id, user_id)
  where paid_at is null;
create index if not exists commission_shares_paid_by_idx on public.commission_shares (paid_by);

comment on table public.commission_shares is
  'Parte de cada papel na comissão (captação, atendimento, gerência, imobiliária, parceiro). A soma sempre fecha o total da comissão.';

-- -----------------------------------------------------------------------------
-- 5. public.proposal_discount_requests
-- -----------------------------------------------------------------------------
create table if not exists public.proposal_discount_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  amount_cents bigint not null
    constraint proposal_discount_requests_amount_range check (amount_cents >= 0),
  reference_cents bigint not null
    constraint proposal_discount_requests_reference_range check (reference_cents > 0),
  discount_percent numeric(6, 3) not null
    constraint proposal_discount_requests_percent_range
    check (discount_percent >= 0 and discount_percent <= 100),
  status public.discount_request_status not null default 'pending',
  reason text check (char_length(reason) <= 1000),
  review_note text check (char_length(review_note) <= 1000),
  requested_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposal_discount_requests_review check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null)
  )
);
-- Um pedido aberto por proposta.
create unique index if not exists proposal_discount_requests_pending_key
  on public.proposal_discount_requests (proposal_id)
  where status = 'pending';
create index if not exists proposal_discount_requests_organization_status_idx
  on public.proposal_discount_requests (organization_id, status);
create index if not exists proposal_discount_requests_proposal_idx
  on public.proposal_discount_requests (proposal_id, status);
create index if not exists proposal_discount_requests_requested_by_idx
  on public.proposal_discount_requests (requested_by);
create index if not exists proposal_discount_requests_reviewed_by_idx
  on public.proposal_discount_requests (reviewed_by);

comment on table public.proposal_discount_requests is
  'Pedido de aprovação de desconto de uma proposta. Escrito só pelas RPCs request_proposal_discount e review_proposal_discount.';

-- -----------------------------------------------------------------------------
-- 6. Cálculo
-- -----------------------------------------------------------------------------

-- Total da comissão em centavos. "percent": round(base * percentual), meio para
-- cima (round(numeric) do Postgres arredonda para longe do zero). "fixed": o
-- valor fixo, limitado ao valor do negócio.
create or replace function private.commission_total_cents(
  p_basis public.commission_basis,
  p_percent numeric,
  p_fixed_cents bigint,
  p_base_cents bigint
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_base_cents, 0) <= 0 then 0::bigint
    when p_basis = 'fixed' then least(greatest(coalesce(p_fixed_cents, 0), 0), p_base_cents)
    else round(p_base_cents::numeric * greatest(coalesce(p_percent, 0), 0) / 100)::bigint
  end;
$$;

revoke all on function private.commission_total_cents(
  public.commission_basis, numeric, bigint, bigint
) from public, anon, authenticated;

-- Divisão da comissão em centavos inteiros. Espelho exato de
-- packages/core/src/comissoes/split.ts (ver o cabeçalho desta migração).
-- A soma de share_cents é SEMPRE igual a p_total_cents.
create or replace function private.commission_split(
  p_total_cents bigint,
  p_capturer_percent numeric,
  p_seller_percent numeric,
  p_manager_percent numeric,
  p_agency_percent numeric,
  p_partner_percent numeric,
  p_has_capturer boolean,
  p_has_seller boolean,
  p_has_manager boolean,
  p_has_partner boolean
)
returns table (share_role public.commission_role, share_percent numeric, share_cents bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- Ordem fixa: 1 captação, 2 atendimento, 3 gerência, 4 imobiliária, 5 parceiro.
  v_roles constant public.commission_role[] :=
    array['capturer', 'seller', 'manager', 'agency', 'partner']::public.commission_role[];
  v_total constant bigint := greatest(coalesce(p_total_cents, 0), 0);
  v_raw constant numeric[] := array[
    greatest(coalesce(p_capturer_percent, 0), 0),
    greatest(coalesce(p_seller_percent, 0), 0),
    greatest(coalesce(p_manager_percent, 0), 0),
    greatest(coalesce(p_agency_percent, 0), 0),
    greatest(coalesce(p_partner_percent, 0), 0)
  ];
  v_has constant boolean[] := array[
    coalesce(p_has_capturer, false),
    coalesce(p_has_seller, false),
    coalesce(p_has_manager, false),
    true,
    coalesce(p_has_partner, false)
  ];
  -- Passo 4: quem perde o centavo primeiro quando o arredondamento passa.
  v_deficit_order constant integer[] := array[5, 3, 2, 1];
  v_percent numeric[] := array[0, 0, 0, 0, 0];
  v_amount bigint[] := array[0, 0, 0, 0, 0];
  v_distributed bigint := 0;
  v_deficit bigint;
  v_target integer;
  v_taken bigint;
  i integer;
  j integer;
begin
  -- Passo 1: papel sem pessoa cai para a imobiliária.
  for i in 1..5 loop
    if i <> 4 then
      if v_has[i] then
        v_percent[i] := v_raw[i];
      else
        v_percent[4] := v_percent[4] + v_raw[i];
      end if;
    end if;
  end loop;

  v_percent[4] := v_percent[4] + v_raw[4];

  -- Passo 2: todo mundo arredonda.
  for i in 1..5 loop
    if i <> 4 and v_percent[i] > 0 then
      v_amount[i] := round(v_total::numeric * v_percent[i] / 100)::bigint;
      v_distributed := v_distributed + v_amount[i];
    end if;
  end loop;

  -- Passo 3: a imobiliária fica com a sobra.
  v_amount[4] := v_total - v_distributed;

  -- Passo 4: o arredondamento passou do total.
  if v_amount[4] < 0 then
    v_deficit := -v_amount[4];
    v_amount[4] := 0;

    while v_deficit > 0 loop
      v_target := null;

      foreach j in array v_deficit_order loop
        if v_amount[j] > 0 and (v_target is null or v_amount[j] > v_amount[v_target]) then
          v_target := j;
        end if;
      end loop;

      exit when v_target is null;

      v_taken := least(v_deficit, v_amount[v_target]);
      v_amount[v_target] := v_amount[v_target] - v_taken;
      v_deficit := v_deficit - v_taken;
    end loop;
  end if;

  for i in 1..5 loop
    if i = 4 or v_percent[i] > 0 then
      share_role := v_roles[i];
      share_percent := v_percent[i];
      share_cents := v_amount[i];
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function private.commission_split(
  bigint, numeric, numeric, numeric, numeric, numeric, boolean, boolean, boolean, boolean
) from public, anon, authenticated;

-- A divisão precisa fechar o total, sempre. Constraint trigger adiado: o
-- gatilho do fechamento insere as partes uma a uma e a conferência só acontece
-- no fim da transação.
create or replace function private.commission_shares_assert_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commission uuid;
  v_total bigint;
  v_sum bigint;
begin
  if tg_op = 'DELETE' then
    v_commission := old.commission_id;
  else
    v_commission := new.commission_id;
  end if;

  select c.total_cents into v_total
  from public.commissions c
  where c.id = v_commission;

  -- A comissão saiu junto (cascade): não há o que conferir.
  if not found then
    return null;
  end if;

  select coalesce(sum(s.amount_cents), 0) into v_sum
  from public.commission_shares s
  where s.commission_id = v_commission;

  if v_sum <> v_total then
    raise exception
      'A divisão da comissão não fecha: as partes somam % e o total é %.', v_sum, v_total
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

revoke all on function private.commission_shares_assert_total() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Proposta aceita vira comissão
-- -----------------------------------------------------------------------------

-- Devolve o usuário só se ele ainda for membro ativo da imobiliária.
create or replace function private.commission_member(p_organization_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.memberships m
  where m.organization_id = p_organization_id
    and m.user_id = p_user_id
    and m.active
  limit 1;
$$;

revoke all on function private.commission_member(uuid, uuid) from public, anon, authenticated;

-- Regra em vigor para o tipo de negócio, ou nenhuma linha.
create or replace function private.commission_current_rule(
  p_organization_id uuid,
  p_purpose public.listing_purpose
)
returns public.commission_rules
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.commission_rules r
  where r.organization_id = p_organization_id
    and r.purpose = p_purpose
    and r.effective_to is null
  order by r.effective_from desc
  limit 1;
$$;

revoke all on function private.commission_current_rule(uuid, public.listing_purpose)
  from public, anon, authenticated;

-- Conversa com o módulo de propostas só pelo banco: nada em
-- apps/web/lib/propostas nem em packages/core/src/proposals precisou mudar.
-- Usada pelo gatilho da proposta aceita e pelo backfill.
create or replace function private.commission_register(
  p_proposal public.proposals,
  p_source_suffix text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal constant public.proposals := p_proposal;
  v_rule public.commission_rules;
  v_capturer uuid;
  v_seller uuid;
  v_manager uuid;
  v_code text;
  v_title text;
  v_client_name text;
  v_base bigint;
  v_total bigint;
  v_commission uuid;
  v_source text := 'rule';
  v_basis public.commission_basis;
  v_percent numeric;
  v_fixed bigint;
  v_split numeric[];
  v_share record;
begin
  -- Idempotente: uma proposta gera no máximo uma comissão.
  if exists (select 1 from public.commissions c where c.proposal_id = v_deal.id) then
    return null;
  end if;

  if v_deal.status <> 'accepted' then
    return null;
  end if;

  select p.code, p.title, private.commission_member(v_deal.organization_id, p.captured_by)
    into v_code, v_title, v_capturer
  from public.properties p
  where p.id = v_deal.property_id;

  select c.name into v_client_name
  from public.clients c
  where c.id = v_deal.client_id;

  -- Quem atendeu o cliente: o corretor da proposta; sem ele, o responsável pelo
  -- cliente; sem ele, quem registrou a proposta.
  v_seller := coalesce(
    private.commission_member(v_deal.organization_id, v_deal.broker_id),
    private.commission_member(
      v_deal.organization_id,
      (select c.assigned_to from public.clients c where c.id = v_deal.client_id)
    ),
    private.commission_member(v_deal.organization_id, v_deal.created_by)
  );

  select private.commission_member(v_deal.organization_id, s.manager_user_id) into v_manager
  from public.commission_settings s
  where s.organization_id = v_deal.organization_id;

  v_rule := private.commission_current_rule(v_deal.organization_id, v_deal.purpose);

  if v_rule.id is not null then
    v_basis := v_rule.basis;
    v_percent := v_rule.percent;
    v_fixed := v_rule.fixed_cents;
    v_split := array[
      v_rule.capturer_percent, v_rule.seller_percent, v_rule.manager_percent,
      v_rule.agency_percent, v_rule.partner_percent
    ];
  else
    -- Imobiliária sem tabela configurada: regra padrão do CRM, igual a
    -- DEFAULT_COMMISSION_RULES em packages/core/src/comissoes/rules.ts.
    v_source := 'default';
    v_basis := 'percent';
    v_percent := case when v_deal.purpose = 'rent' then 100 else 6 end;
    v_fixed := 0;
    v_split := array[20, 30, 10, 40, 0];
  end if;

  v_source := coalesce(p_source_suffix, v_source);

  v_base := round(v_deal.amount * 100)::bigint;
  v_total := private.commission_total_cents(v_basis, v_percent, v_fixed, v_base);

  insert into public.commissions (
    organization_id, proposal_id, property_id, client_id, property_code, property_title,
    client_name, purpose, deal_amount_cents, total_cents, rule_id, rule_snapshot, closed_at
  )
  values (
    v_deal.organization_id, v_deal.id, v_deal.property_id, v_deal.client_id, v_code, v_title,
    v_client_name, v_deal.purpose, v_base, v_total, v_rule.id,
    jsonb_build_object(
      'source', v_source,
      'rule_id', v_rule.id,
      'purpose', v_deal.purpose,
      'basis', v_basis,
      'percent', v_percent,
      'fixed_cents', v_fixed,
      'split', jsonb_build_object(
        'capturer', v_split[1],
        'seller', v_split[2],
        'manager', v_split[3],
        'agency', v_split[4],
        'partner', v_split[5]
      ),
      'effective_from', v_rule.effective_from,
      'frozen_at', now()
    ),
    coalesce(v_deal.decided_at, now())
  )
  returning id into v_commission;

  -- Parceiro externo não existe no fechamento (a proposta não tem esse campo):
  -- entra depois por public.set_commission_partner, tirando da imobiliária.
  for v_share in
    select *
    from private.commission_split(
      v_total, v_split[1], v_split[2], v_split[3], v_split[4], v_split[5],
      v_capturer is not null, v_seller is not null, v_manager is not null, false
    )
  loop
    insert into public.commission_shares (
      organization_id, commission_id, role, user_id, percent, amount_cents
    )
    values (
      v_deal.organization_id, v_commission, v_share.share_role,
      case v_share.share_role
        when 'capturer' then v_capturer
        when 'seller' then v_seller
        when 'manager' then v_manager
        else null
      end,
      v_share.share_percent, v_share.share_cents
    );
  end loop;

  return v_commission;
end;
$$;

revoke all on function private.commission_register(public.proposals, text)
  from public, anon, authenticated;

create or replace function private.proposals_create_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.commission_register(new);
  return null;
end;
$$;

revoke all on function private.proposals_create_commission() from public, anon, authenticated;

drop trigger if exists proposals_create_commission on public.proposals;
create trigger proposals_create_commission
  after update of status on public.proposals
  for each row
  when (new.status = 'accepted' and old.status is distinct from 'accepted')
  execute function private.proposals_create_commission();

-- Situação da comissão a partir das partes pagas.
create or replace function private.commissions_sync_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commission uuid;
  v_total integer;
  v_paid integer;
  v_status public.commission_status;
begin
  if tg_op = 'DELETE' then
    v_commission := old.commission_id;
  else
    v_commission := new.commission_id;
  end if;

  select count(*), count(*) filter (where s.paid_at is not null)
    into v_total, v_paid
  from public.commission_shares s
  where s.commission_id = v_commission;

  v_status := case
    when v_paid = 0 then 'pending'
    when v_paid < v_total then 'partially_paid'
    else 'paid'
  end;

  update public.commissions c
  set status = v_status
  where c.id = v_commission
    and c.status <> 'canceled'
    and c.status is distinct from v_status;

  return null;
end;
$$;

revoke all on function private.commissions_sync_status() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Trava de desconto e aprovação do gerente
-- -----------------------------------------------------------------------------

-- Percentual em milésimos de ponto, arredondado PARA CIMA (a favor da trava).
-- Igual a discountMilli em packages/core/src/comissoes/discount.ts.
create or replace function private.discount_milli(p_reference_cents bigint, p_amount_cents bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_reference_cents, 0) <= 0 then 0::bigint
    when coalesce(p_amount_cents, 0) >= p_reference_cents then 0::bigint
    else ceil(
      (p_reference_cents - greatest(coalesce(p_amount_cents, 0), 0))::numeric * 100000
      / p_reference_cents
    )::bigint
  end;
$$;

revoke all on function private.discount_milli(bigint, bigint) from public, anon, authenticated;

-- "12,5%" a partir de milésimos de ponto.
create or replace function private.milli_percent_text(p_milli bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(trim(to_char(coalesce(p_milli, 0) / 1000.0, 'FM999990.999')), '.', ',') || '%';
$$;

revoke all on function private.milli_percent_text(bigint) from public, anon, authenticated;

-- Preço anunciado do imóvel (venda ou locação) em centavos.
create or replace function private.property_reference_cents(
  p_property_id uuid,
  p_purpose public.listing_purpose
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select round(
    case p_purpose when 'rent' then p.rent_price else p.sale_price end * 100
  )::bigint
  from public.properties p
  where p.id = p_property_id;
$$;

revoke all on function private.property_reference_cents(uuid, public.listing_purpose)
  from public, anon, authenticated;

-- Proposta com desconto acima do limite só avança (enviada/aceita) com um
-- pedido aprovado. Nome com "zz_" de propósito: triggers BEFORE rodam em ordem
-- alfabética e esta checagem precisa vir DEPOIS da validação do fluxo de status.
create or replace function private.proposals_require_discount_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_limit_percent numeric;
  v_reference bigint;
  v_amount bigint;
  v_discount bigint;
  v_limit bigint;
begin
  -- Sem sessão (RPC de servidor, pg_cron, admin) e em gravação disparada por
  -- outro gatilho, não trava.
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status not in ('sent', 'accepted') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.amount is not distinct from old.amount then
    return new;
  end if;

  select s.discount_approval_enabled, s.max_discount_percent
    into v_enabled, v_limit_percent
  from public.commission_settings s
  where s.organization_id = new.organization_id;

  if not coalesce(v_enabled, false) then
    return new;
  end if;

  v_reference := private.property_reference_cents(new.property_id, new.purpose);
  v_amount := round(new.amount * 100)::bigint;
  v_discount := private.discount_milli(v_reference, v_amount);
  v_limit := round(coalesce(v_limit_percent, 0) * 1000)::bigint;

  -- Sem preço anunciado não há desconto para medir.
  if v_discount <= v_limit then
    return new;
  end if;

  if exists (
    select 1
    from public.proposal_discount_requests r
    where r.proposal_id = new.id
      and r.status = 'approved'
      and r.amount_cents <= v_amount
  ) then
    return new;
  end if;

  raise exception
    'Esta proposta dá % de desconto sobre o anunciado e passa do limite de % que dispensa aprovação. Peça a aprovação do gerente em Comissões.',
    private.milli_percent_text(v_discount), private.milli_percent_text(v_limit)
    using errcode = 'P0001';
end;
$$;

revoke all on function private.proposals_require_discount_approval()
  from public, anon, authenticated;

drop trigger if exists zz_proposals_discount_approval on public.proposals;
create trigger zz_proposals_discount_approval
  before insert or update on public.proposals
  for each row execute function private.proposals_require_discount_approval();

-- Pedido de aprovação. Devolve o pedido em jsonb.
create or replace function public.request_proposal_discount(
  p_proposal_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.proposals;
  v_enabled boolean;
  v_limit_percent numeric;
  v_reference bigint;
  v_amount bigint;
  v_discount bigint;
  v_limit bigint;
  v_request public.proposal_discount_requests;
begin
  select * into v_proposal from public.proposals p where p.id = p_proposal_id;

  if not found or not private.is_member(v_proposal.organization_id) then
    raise exception 'Proposta não encontrada.' using errcode = 'P0001';
  end if;

  if not (
    private.has_role(v_proposal.organization_id, '{owner,manager}')
    or v_proposal.broker_id = (select auth.uid())
    or private.can_edit_property(v_proposal.property_id)
  ) then
    raise exception 'Só o corretor da proposta ou quem edita o imóvel pode pedir aprovação de desconto.'
      using errcode = '42501';
  end if;

  if v_proposal.status in ('accepted', 'rejected', 'withdrawn') then
    raise exception 'Esta proposta já foi encerrada.' using errcode = 'P0001';
  end if;

  select s.discount_approval_enabled, s.max_discount_percent
    into v_enabled, v_limit_percent
  from public.commission_settings s
  where s.organization_id = v_proposal.organization_id;

  if not coalesce(v_enabled, false) then
    raise exception 'A aprovação de desconto está desligada nesta imobiliária.'
      using errcode = 'P0001';
  end if;

  v_reference := private.property_reference_cents(v_proposal.property_id, v_proposal.purpose);

  if coalesce(v_reference, 0) <= 0 then
    raise exception 'Este imóvel não tem preço anunciado para comparar com a proposta.'
      using errcode = 'P0001';
  end if;

  v_amount := round(v_proposal.amount * 100)::bigint;
  v_discount := private.discount_milli(v_reference, v_amount);
  v_limit := round(coalesce(v_limit_percent, 0) * 1000)::bigint;

  if v_discount <= v_limit then
    raise exception 'Esta proposta está dentro do limite de % e não precisa de aprovação.',
      private.milli_percent_text(v_limit)
      using errcode = 'P0001';
  end if;

  -- Já havia pedido em aberto: atualiza o valor e a justificativa.
  update public.proposal_discount_requests r
  set amount_cents = v_amount,
      reference_cents = v_reference,
      discount_percent = v_discount / 1000.0,
      reason = nullif(btrim(coalesce(p_reason, '')), ''),
      requested_by = coalesce((select auth.uid()), r.requested_by),
      updated_at = now()
  where r.proposal_id = p_proposal_id
    and r.status = 'pending'
  returning r.* into v_request;

  if not found then
    insert into public.proposal_discount_requests (
      organization_id, proposal_id, amount_cents, reference_cents, discount_percent,
      reason, requested_by
    )
    values (
      v_proposal.organization_id, p_proposal_id, v_amount, v_reference, v_discount / 1000.0,
      nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid())
    )
    returning * into v_request;
  end if;

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.request_proposal_discount(uuid, text) from public, anon;
grant execute on function public.request_proposal_discount(uuid, text) to authenticated;

-- Aprovação ou recusa pelo gerente (ou dono).
create or replace function public.review_proposal_discount(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.proposal_discount_requests;
  v_user constant uuid := (select auth.uid());
begin
  select * into v_request
  from public.proposal_discount_requests r
  where r.id = p_request_id;

  if not found or not private.is_member(v_request.organization_id) then
    raise exception 'Pedido não encontrado.' using errcode = 'P0001';
  end if;

  if not private.has_role(v_request.organization_id, '{owner,manager}') then
    raise exception 'Só o dono ou o gerente da imobiliária aprova desconto.'
      using errcode = '42501';
  end if;

  -- Gerente não aprova o próprio pedido; o dono responde por si.
  if v_request.requested_by = v_user
     and not private.has_role(v_request.organization_id, '{owner}') then
    raise exception 'Você pediu este desconto: quem aprova é o dono da imobiliária.'
      using errcode = '42501';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Este pedido já foi respondido.' using errcode = 'P0001';
  end if;

  update public.proposal_discount_requests r
  set status = case when coalesce(p_approve, false) then 'approved' else 'rejected' end,
      review_note = nullif(btrim(coalesce(p_note, '')), ''),
      reviewed_by = v_user,
      reviewed_at = now(),
      updated_at = now()
  where r.id = p_request_id
    and r.status = 'pending'
  returning r.* into v_request;

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.review_proposal_discount(uuid, boolean, text) from public, anon;
grant execute on function public.review_proposal_discount(uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Pagamento das partes, parceiro externo e resumo
-- -----------------------------------------------------------------------------

create or replace function private.commission_shares_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.paid_at is null then
    new.paid_by := null;
    new.paid_note := null;
    return new;
  end if;

  if new.paid_at > now() + interval '1 day' then
    raise exception 'A data do pagamento não pode ficar no futuro.' using errcode = 'P0001';
  end if;

  if new.paid_at is distinct from old.paid_at then
    new.paid_by := coalesce((select auth.uid()), new.paid_by, old.paid_by);
  else
    new.paid_by := coalesce(old.paid_by, (select auth.uid()));
  end if;

  return new;
end;
$$;

revoke all on function private.commission_shares_before_update()
  from public, anon, authenticated;

-- Situação da comissão só muda para "cancelada" (e de volta). O resto é
-- calculado pelos pagamentos.
create or replace function private.commissions_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'canceled' then
      if exists (
        select 1 from public.commission_shares s
        where s.commission_id = old.id and s.paid_at is not null
      ) then
        raise exception 'Esta comissão já tem parte paga e não pode ser cancelada.'
          using errcode = 'P0001';
      end if;
    elsif not (old.status = 'canceled' and new.status = 'pending') then
      raise exception 'A situação da comissão é calculada pelos pagamentos.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.commissions_before_update() from public, anon, authenticated;

-- Parceiro externo: entra depois do fechamento, tirando da parte da imobiliária.
-- Nome vazio remove o parceiro e devolve o valor para a imobiliária.
create or replace function public.set_commission_partner(
  p_commission_id uuid,
  p_partner_name text default null,
  p_percent numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commission public.commissions;
  v_agency public.commission_shares;
  v_partner public.commission_shares;
  v_name constant text := nullif(btrim(coalesce(p_partner_name, '')), '');
  v_percent numeric := least(greatest(coalesce(p_percent, 0), 0), 100);
  -- Valores do parceiro ANTES da mudança (v_partner é reescrito adiante).
  v_partner_cents_before bigint := 0;
  v_partner_percent_before numeric := 0;
  v_available bigint;
  v_cents bigint;
begin
  select * into v_commission from public.commissions c where c.id = p_commission_id;

  if not found or not private.is_member(v_commission.organization_id) then
    raise exception 'Comissão não encontrada.' using errcode = 'P0001';
  end if;

  if not private.has_role(v_commission.organization_id, '{owner,manager}') then
    raise exception 'Só o dono ou o gerente registra o parceiro externo.'
      using errcode = '42501';
  end if;

  if v_commission.status in ('paid', 'canceled') then
    raise exception 'Esta comissão já foi encerrada.' using errcode = 'P0001';
  end if;

  select * into v_agency
  from public.commission_shares s
  where s.commission_id = p_commission_id and s.role = 'agency';

  if not found then
    raise exception 'Esta comissão não tem a parte da imobiliária.' using errcode = 'P0001';
  end if;

  if v_agency.paid_at is not null then
    raise exception 'A parte da imobiliária já foi paga: não dá para tirar o parceiro dela.'
      using errcode = 'P0001';
  end if;

  select * into v_partner
  from public.commission_shares s
  where s.commission_id = p_commission_id and s.role = 'partner';

  if found and v_partner.paid_at is not null then
    raise exception 'A parte do parceiro já foi paga e não pode mudar.' using errcode = 'P0001';
  end if;

  -- O que dá para mover: o que está com a imobiliária mais o que já é do parceiro.
  v_partner_cents_before := coalesce(v_partner.amount_cents, 0);
  v_partner_percent_before := coalesce(v_partner.percent, 0);
  v_available := v_agency.amount_cents + v_partner_cents_before;

  if v_name is null then
    delete from public.commission_shares s
    where s.commission_id = p_commission_id and s.role = 'partner';

    update public.commission_shares s
    set amount_cents = v_available,
        percent = least(v_agency.percent + v_partner_percent_before, 100),
        updated_at = now()
    where s.id = v_agency.id;

    return jsonb_build_object('partner', null, 'agency_cents', v_available);
  end if;

  v_cents := round(v_commission.total_cents::numeric * v_percent / 100)::bigint;

  if v_cents > v_available then
    raise exception
      'A parte da imobiliária não cobre % para o parceiro.', private.milli_percent_text(round(v_percent * 1000)::bigint)
      using errcode = 'P0001';
  end if;

  if v_partner.id is null then
    insert into public.commission_shares (
      organization_id, commission_id, role, partner_name, percent, amount_cents
    )
    values (
      v_commission.organization_id, p_commission_id, 'partner', v_name, v_percent, v_cents
    )
    returning * into v_partner;
  else
    update public.commission_shares s
    set partner_name = v_name,
        percent = v_percent,
        amount_cents = v_cents,
        updated_at = now()
    where s.id = v_partner.id
    returning * into v_partner;
  end if;

  update public.commission_shares s
  set amount_cents = v_available - v_cents,
      percent = least(greatest(v_agency.percent + v_partner_percent_before - v_percent, 0), 100),
      updated_at = now()
  where s.id = v_agency.id;

  return jsonb_build_object(
    'partner', to_jsonb(v_partner),
    'agency_cents', v_available - v_cents
  );
end;
$$;

revoke all on function public.set_commission_partner(uuid, text, numeric) from public, anon;
grant execute on function public.set_commission_partner(uuid, text, numeric) to authenticated;

-- Resumo do extrato. SECURITY INVOKER de propósito: o RLS de commission_shares
-- decide o que entra na conta (corretor só vê o dele).
create or replace function public.commission_summary(p_user_id uuid default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'pending_cents', coalesce(sum(s.amount_cents) filter (where s.paid_at is null), 0),
    'paid_cents', coalesce(sum(s.amount_cents) filter (where s.paid_at is not null), 0),
    'deals', count(distinct s.commission_id),
    'shares', count(*)
  )
  from public.commission_shares s
  join public.commissions c on c.id = s.commission_id
  where c.status <> 'canceled'
    and (p_user_id is null or s.user_id = p_user_id);
$$;

revoke all on function public.commission_summary(uuid) from public, anon;
grant execute on function public.commission_summary(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 10. Triggers de escrita, RLS, grants por coluna e auditoria
-- -----------------------------------------------------------------------------

-- commission_settings ---------------------------------------------------------
create or replace function private.commission_settings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

revoke all on function private.commission_settings_before_write() from public, anon, authenticated;

drop trigger if exists a0_billing_writable on public.commission_settings;
create trigger a0_billing_writable
  before insert or update on public.commission_settings
  for each row execute function private.assert_billing_writable();

drop trigger if exists commission_settings_before_write on public.commission_settings;
create trigger commission_settings_before_write
  before insert or update on public.commission_settings
  for each row execute function private.commission_settings_before_write();

drop trigger if exists commission_settings_set_updated_at on public.commission_settings;
create trigger commission_settings_set_updated_at
  before update on public.commission_settings
  for each row execute function private.set_updated_at();

drop trigger if exists commission_settings_validate_members on public.commission_settings;
create trigger commission_settings_validate_members
  before insert or update of manager_user_id on public.commission_settings
  for each row execute function private.validate_member_columns(
    'manager_user_id', 'O gerente que recebe comissão'
  );

drop trigger if exists commission_settings_audit on public.commission_settings;
create trigger commission_settings_audit
  after insert or update or delete on public.commission_settings
  for each row execute function private.audit_row_change();

-- commission_rules ------------------------------------------------------------
-- A tabela é append-only: gravar uma regra nova FECHA a anterior (effective_to)
-- em vez de sobrescrever. O valor antigo nunca some — negócio fechado no mês
-- passado continua apontando para a regra daquele mês.
create or replace function private.commission_rules_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
begin
  new.effective_from := v_now;
  new.effective_to := null;
  new.created_by := coalesce((select auth.uid()), new.created_by);

  update public.commission_rules r
  set effective_to = v_now
  where r.organization_id = new.organization_id
    and r.purpose = new.purpose
    and r.effective_to is null;

  return new;
end;
$$;

revoke all on function private.commission_rules_before_insert() from public, anon, authenticated;

drop trigger if exists a0_billing_writable on public.commission_rules;
create trigger a0_billing_writable
  before insert on public.commission_rules
  for each row execute function private.assert_billing_writable();

drop trigger if exists commission_rules_before_insert on public.commission_rules;
create trigger commission_rules_before_insert
  before insert on public.commission_rules
  for each row execute function private.commission_rules_before_insert();

drop trigger if exists commission_rules_audit on public.commission_rules;
create trigger commission_rules_audit
  after insert on public.commission_rules
  for each row execute function private.audit_row_change();

-- commissions -----------------------------------------------------------------
drop trigger if exists commissions_set_updated_at on public.commissions;
create trigger commissions_set_updated_at
  before update on public.commissions
  for each row execute function private.set_updated_at();

drop trigger if exists commissions_lock_organization_id on public.commissions;
create trigger commissions_lock_organization_id
  before update on public.commissions
  for each row execute function private.lock_organization_id();

drop trigger if exists commissions_before_update on public.commissions;
create trigger commissions_before_update
  before update on public.commissions
  for each row execute function private.commissions_before_update();

drop trigger if exists commissions_audit on public.commissions;
create trigger commissions_audit
  after insert or update on public.commissions
  for each row execute function private.audit_row_change();

-- commission_shares -----------------------------------------------------------
drop trigger if exists a0_billing_writable on public.commission_shares;
create trigger a0_billing_writable
  before insert or update on public.commission_shares
  for each row execute function private.assert_billing_writable();

drop trigger if exists commission_shares_set_updated_at on public.commission_shares;
create trigger commission_shares_set_updated_at
  before update on public.commission_shares
  for each row execute function private.set_updated_at();

drop trigger if exists commission_shares_lock_organization_id on public.commission_shares;
create trigger commission_shares_lock_organization_id
  before update on public.commission_shares
  for each row execute function private.lock_organization_id();

drop trigger if exists commission_shares_before_update on public.commission_shares;
create trigger commission_shares_before_update
  before update on public.commission_shares
  for each row execute function private.commission_shares_before_update();

drop trigger if exists commission_shares_sync_status on public.commission_shares;
create trigger commission_shares_sync_status
  after update of paid_at or delete on public.commission_shares
  for each row execute function private.commissions_sync_status();

-- Adiado: o fechamento insere as partes uma a uma e a soma só fecha no fim.
drop trigger if exists commission_shares_total on public.commission_shares;
create constraint trigger commission_shares_total
  after insert or update or delete on public.commission_shares
  deferrable initially deferred
  for each row execute function private.commission_shares_assert_total();

drop trigger if exists commission_shares_audit on public.commission_shares;
create trigger commission_shares_audit
  after update on public.commission_shares
  for each row execute function private.audit_row_change();

-- proposal_discount_requests --------------------------------------------------
drop trigger if exists proposal_discount_requests_set_updated_at
  on public.proposal_discount_requests;
create trigger proposal_discount_requests_set_updated_at
  before update on public.proposal_discount_requests
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.commission_settings enable row level security;
alter table public.commission_rules enable row level security;
alter table public.commissions enable row level security;
alter table public.commission_shares enable row level security;
alter table public.proposal_discount_requests enable row level security;

-- Quem vê o extrato inteiro da imobiliária. O corretor vê só as partes dele.
create or replace function private.commission_auditor(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(p_organization_id, '{owner,manager,finance}');
$$;

revoke all on function private.commission_auditor(uuid) from public, anon;
grant execute on function private.commission_auditor(uuid) to authenticated;

-- Verdadeiro quando o usuário atual tem parte nesta comissão. SECURITY DEFINER
-- de propósito: usada na política de commissions, não pode passar de novo pelo
-- RLS de commission_shares.
create or replace function private.commission_has_share(p_commission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.commission_shares s
    where s.commission_id = p_commission_id
      and s.user_id = (select auth.uid())
  );
$$;

revoke all on function private.commission_has_share(uuid) from public, anon;
grant execute on function private.commission_has_share(uuid) to authenticated;

-- commission_settings: todo membro lê (o corretor precisa saber o limite de
-- desconto); só dono e gerente gravam.
drop policy if exists "commission_settings: membros leem" on public.commission_settings;
create policy "commission_settings: membros leem"
  on public.commission_settings for select to authenticated
  using ((select private.is_member(organization_id)));

drop policy if exists "commission_settings: dono e gerente criam" on public.commission_settings;
create policy "commission_settings: dono e gerente criam"
  on public.commission_settings for insert to authenticated
  with check ((select private.has_role(organization_id, '{owner,manager}')));

drop policy if exists "commission_settings: dono e gerente atualizam" on public.commission_settings;
create policy "commission_settings: dono e gerente atualizam"
  on public.commission_settings for update to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')))
  with check ((select private.has_role(organization_id, '{owner,manager}')));

revoke all on public.commission_settings from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.commission_settings from authenticated;
grant select on public.commission_settings to authenticated;
grant insert (
  organization_id, manager_user_id, discount_approval_enabled, max_discount_percent
) on public.commission_settings to authenticated;
grant update (
  manager_user_id, discount_approval_enabled, max_discount_percent
) on public.commission_settings to authenticated;

-- commission_rules: todo membro lê a tabela (e o histórico); só dono e gerente
-- criam versão nova. UPDATE e DELETE não existem para ninguém com sessão.
drop policy if exists "commission_rules: membros leem" on public.commission_rules;
create policy "commission_rules: membros leem"
  on public.commission_rules for select to authenticated
  using ((select private.is_member(organization_id)));

drop policy if exists "commission_rules: dono e gerente criam" on public.commission_rules;
create policy "commission_rules: dono e gerente criam"
  on public.commission_rules for insert to authenticated
  with check ((select private.has_role(organization_id, '{owner,manager}')));

revoke all on public.commission_rules from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.commission_rules from authenticated;
grant select on public.commission_rules to authenticated;
grant insert (
  organization_id, purpose, basis, percent, fixed_cents, capturer_percent, seller_percent,
  manager_percent, agency_percent, partner_percent, note
) on public.commission_rules to authenticated;

-- commissions: dono, gerente e financeiro veem tudo; quem tem parte no negócio
-- vê o negócio dele. Ex-membro não vê mais nada (is_member no OR).
drop policy if exists "commissions: gestão vê tudo, participante vê o dele" on public.commissions;
create policy "commissions: gestão vê tudo, participante vê o dele"
  on public.commissions for select to authenticated
  using (
    (select private.commission_auditor(organization_id))
    or (
      (select private.is_member(organization_id))
      and private.commission_has_share(id)
    )
  );

drop policy if exists "commissions: dono e gerente cancelam" on public.commissions;
create policy "commissions: dono e gerente cancelam"
  on public.commissions for update to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')))
  with check ((select private.has_role(organization_id, '{owner,manager}')));

revoke all on public.commissions from anon;
revoke insert, update, delete, truncate, trigger, references on public.commissions from authenticated;
grant select on public.commissions to authenticated;
grant update (status, note) on public.commissions to authenticated;

-- commission_shares: o corretor enxerga SÓ o extrato dele.
drop policy if exists "commission_shares: gestão vê tudo, corretor vê o dele"
  on public.commission_shares;
create policy "commission_shares: gestão vê tudo, corretor vê o dele"
  on public.commission_shares for select to authenticated
  using (
    (select private.commission_auditor(organization_id))
    or (user_id = (select auth.uid()) and (select private.is_member(organization_id)))
  );

drop policy if exists "commission_shares: gestão marca pagamento" on public.commission_shares;
create policy "commission_shares: gestão marca pagamento"
  on public.commission_shares for update to authenticated
  using ((select private.commission_auditor(organization_id)))
  with check ((select private.commission_auditor(organization_id)));

revoke all on public.commission_shares from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.commission_shares from authenticated;
grant select on public.commission_shares to authenticated;
grant update (paid_at, paid_note) on public.commission_shares to authenticated;

-- proposal_discount_requests: gestão vê todos; quem pediu vê o dele. Escrita só
-- pelas RPCs request_proposal_discount e review_proposal_discount.
drop policy if exists "proposal_discount_requests: gestão e autor leem"
  on public.proposal_discount_requests;
create policy "proposal_discount_requests: gestão e autor leem"
  on public.proposal_discount_requests for select to authenticated
  using (
    (select private.commission_auditor(organization_id))
    or (requested_by = (select auth.uid()) and (select private.is_member(organization_id)))
  );

revoke all on public.proposal_discount_requests from anon, authenticated;
grant select on public.proposal_discount_requests to authenticated;

-- -----------------------------------------------------------------------------
-- Comentários de coluna que valem manutenção
-- -----------------------------------------------------------------------------
comment on column public.commissions.rule_snapshot is
  'Regra congelada no fechamento (source, basis, percent, fixed_cents e a divisão). Mudar commission_rules depois não mexe aqui.';
comment on column public.commissions.deal_amount_cents is
  'Valor do negócio em centavos inteiros (proposals.amount * 100).';
comment on column public.commission_shares.amount_cents is
  'Parte em centavos inteiros. A soma das partes de uma comissão é sempre igual a commissions.total_cents (constraint trigger commission_shares_total).';
comment on column public.commission_rules.effective_to is
  'Nulo = regra em vigor. Preenchido automaticamente quando uma tabela nova é gravada.';

-- -----------------------------------------------------------------------------
-- 11. Semente por imobiliária e backfill
-- -----------------------------------------------------------------------------

create or replace function private.commission_defaults_seed(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.commission_settings (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  insert into public.commission_rules (
    organization_id, purpose, basis, percent, capturer_percent, seller_percent,
    manager_percent, agency_percent, partner_percent, note
  )
  select
    p_organization_id, v.purpose::public.listing_purpose, 'percent', v.percent,
    20, 30, 10, 40, 0, 'Tabela inicial sugerida pelo CRM.'
  from (values ('sale', 6::numeric), ('rent', 100::numeric)) as v (purpose, percent)
  where not exists (
    select 1
    from public.commission_rules r
    where r.organization_id = p_organization_id
      and r.purpose = v.purpose::public.listing_purpose
  );
end;
$$;

revoke all on function private.commission_defaults_seed(uuid) from public, anon, authenticated;

create or replace function private.create_commission_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.commission_defaults_seed(new.id);
  return null;
end;
$$;

revoke all on function private.create_commission_defaults() from public, anon, authenticated;

drop trigger if exists organizations_create_commission_defaults on public.organizations;
create trigger organizations_create_commission_defaults
  after insert on public.organizations
  for each row execute function private.create_commission_defaults();

-- Imobiliárias que já existiam ganham a tabela inicial.
do $$
declare
  v_org uuid;
begin
  for v_org in select o.id from public.organizations o loop
    perform private.commission_defaults_seed(v_org);
  end loop;
end
$$;

-- Propostas já aceitas antes desta migração viram comissão com a tabela inicial
-- (rule_snapshot marca source = 'backfill': não houve regra vigente no fechamento).
create or replace function private.backfill_commissions()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_proposal public.proposals;
  v_count integer := 0;
begin
  for v_proposal in
    select p.*
    from public.proposals p
    where p.status = 'accepted'
      and not exists (select 1 from public.commissions c where c.proposal_id = p.id)
    order by p.decided_at nulls last, p.created_at
  loop
    if private.commission_register(v_proposal, 'backfill') is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.backfill_commissions() from public, anon, authenticated;

select private.backfill_commissions();
