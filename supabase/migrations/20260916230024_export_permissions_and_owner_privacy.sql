-- =============================================================================
-- Exportação com permissão por papel, trilha das exportações e sigilo do
-- contato do proprietário
-- =============================================================================
--  1. public.organization_permission_settings: quem pode exportar, por imobiliária
--  2. Ajudantes do schema private (permissão, registro e contagem de linhas)
--  3. RPCs públicas (security invoker): iniciar exportação, informar as linhas
--     dos relatórios agregados e mudar quem exporta
--  4. RPCs de exportação da base: exigem a exportação registrada e contam as
--     linhas no próprio banco
--  5. Proprietário: corretor e captador só leem o contato dos proprietários dos
--     imóveis em que são captador ou corretor
--  6. Índice e grants
--
-- Por que o banco, e não só a rota: a planilha da base (leads, clientes,
-- imóveis, propostas) sai das RPCs `export_*_rows`, que qualquer sessão
-- autenticada alcança por /rest/v1/rpc. Se a permissão e o registro ficassem só
-- no Next, bastaria chamar a RPC direto para levar a carteira sem deixar rastro.
-- Agora cada página exige um `p_export_id` criado por `start_data_export` para
-- aquele usuário, imobiliária, conjunto e filtros — e é a própria página que
-- soma as linhas no registro. Sem registro válido (ou sem permissão), a página
-- não sai.
--
-- O registro fica em `public.audit_events` (entity = 'data_export', action =
-- 'export'), com quem, quando, qual conjunto, filtros e quantidade de linhas.
-- Nenhum dado exportado é gravado. Tentativa negada também é registrada, com
-- `metadata.allowed = false`. A ação 'export' já está entre as que a rotina de
-- retenção guarda por 5 anos (`private.cleanup_old_audit_events`).

-- -----------------------------------------------------------------------------
-- 1. public.organization_permission_settings
-- -----------------------------------------------------------------------------
create table public.organization_permission_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  export_roles public.app_role[] not null default '{owner,manager}'::public.app_role[]
    constraint organization_permission_settings_export_roles_owner
      check ('owner'::public.app_role = any (export_roles)),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organization_permission_settings_updated_by_idx
  on public.organization_permission_settings (updated_by);

create trigger organization_permission_settings_set_updated_at
  before update on public.organization_permission_settings
  for each row execute function private.set_updated_at();

alter table public.organization_permission_settings enable row level security;

-- Todo membro lê (a tela precisa saber se mostra o botão de exportar); ninguém
-- escreve direto: só o dono, por `set_export_roles`, que também deixa rastro.
create policy "organization_permission_settings: membros leem"
  on public.organization_permission_settings
  for select
  to authenticated
  using (private.is_member(organization_id));

revoke all on table public.organization_permission_settings from anon;
revoke insert, update, delete, truncate on table public.organization_permission_settings
  from authenticated;

comment on table public.organization_permission_settings is
  'Permissões configuráveis pelo dono, por imobiliária. Sem linha = padrão (só dono e gerente exportam). Escrita apenas por public.set_export_roles.';
comment on column public.organization_permission_settings.export_roles is
  'Papéis que exportam CSV em /relatorios (relatórios e base). O dono sempre está na lista.';

-- -----------------------------------------------------------------------------
-- 2. Ajudantes (schema private)
-- -----------------------------------------------------------------------------
create or replace function private.can_export_data(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    left join public.organization_permission_settings s
      on s.organization_id = m.organization_id
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.active
      and (
        m.role = 'owner'
        or m.role = any (coalesce(s.export_roles, '{owner,manager}'::public.app_role[]))
      )
  );
$$;

comment on function private.can_export_data(uuid) is
  'Se o usuário da sessão pode exportar dados desta imobiliária: membro ativo com papel em organization_permission_settings.export_roles (padrão dono e gerente; o dono sempre pode).';

-- Registra a tentativa de exportação ANTES de qualquer linha sair. Não levanta
-- erro quando a permissão falta: um `raise` desfaria o próprio registro da
-- recusa. Quem chama olha `allowed` e responde 403.
create or replace function private.begin_data_export(
  p_organization_id uuid,
  p_dataset text,
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid,
  p_period_preset text
)
returns table (export_id uuid, allowed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role public.app_role;
  v_allowed boolean;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Sua sessão expirou. Entre novamente.' using errcode = '42501';
  end if;

  if p_dataset is null or p_dataset not in (
    'corretores', 'funil', 'origens', 'motivos-perda', 'leads', 'imoveis', 'clientes', 'propostas'
  ) then
    raise exception 'Exportação desconhecida.' using errcode = '22023';
  end if;

  if p_period_preset is not null and p_period_preset !~ '^[a-z0-9-]{1,20}$' then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;

  select m.role
    into v_role
  from public.memberships m
  where m.organization_id = p_organization_id
    and m.user_id = v_user
    and m.active;

  if v_role is null then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  v_allowed := private.can_export_data(p_organization_id);

  insert into public.audit_events (organization_id, actor_id, action, entity, metadata)
  values (
    p_organization_id,
    v_user,
    'export',
    'data_export',
    jsonb_build_object(
      'dataset', p_dataset,
      'allowed', v_allowed,
      'role', v_role,
      'rows', 0,
      'filters', jsonb_build_object(
        'period_preset', p_period_preset,
        'from', p_from,
        'to', p_to,
        'broker_id', p_user_id
      )
    )
  )
  returning id into v_id;

  return query select v_id, v_allowed;
end;
$$;

comment on function private.begin_data_export(uuid, text, timestamptz, timestamptz, uuid, text) is
  'Grava em audit_events (entity data_export, action export) quem tentou exportar, qual conjunto, os filtros e se era permitido. Devolve o id do registro e a decisão. Nunca grava os dados exportados.';

-- Soma (ou fixa) as linhas de uma exportação registrada. É também a trava: só
-- aceita o registro do próprio usuário, na mesma imobiliária, conjunto e
-- filtros, permitido, de até 1 hora atrás, e com a permissão ainda valendo.
create or replace function private.add_export_rows(
  p_export_id uuid,
  p_organization_id uuid,
  p_dataset text,
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid,
  p_rows integer,
  p_replace boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.audit_events e
  set metadata = jsonb_set(
    e.metadata,
    '{rows}',
    to_jsonb(
      (case when p_replace then 0 else coalesce((e.metadata ->> 'rows')::bigint, 0) end)
      + greatest(coalesce(p_rows, 0), 0)
    )
  )
  where e.id = p_export_id
    and e.organization_id = p_organization_id
    and e.actor_id = (select auth.uid())
    and e.entity = 'data_export'
    and e.action = 'export'
    and e.metadata ->> 'dataset' = p_dataset
    and coalesce((e.metadata ->> 'allowed')::boolean, false)
    and e.created_at > now() - interval '1 hour'
    and (e.metadata -> 'filters' ->> 'from')::timestamptz is not distinct from p_from
    and (e.metadata -> 'filters' ->> 'to')::timestamptz is not distinct from p_to
    and (e.metadata -> 'filters' ->> 'broker_id')::uuid is not distinct from p_user_id
    and private.can_export_data(p_organization_id);

  if not found then
    raise exception 'Exportação não autorizada. Só exporta quem o dono da imobiliária liberou em Configurações > Papéis e permissões.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function private.add_export_rows(uuid, uuid, text, timestamptz, timestamptz, uuid, integer, boolean) is
  'Soma (ou, com p_replace, fixa) a quantidade de linhas no registro da exportação. Levanta 42501 se o registro não for do usuário, não bater com conjunto/filtros, tiver mais de 1 hora, tiver sido negado ou se a permissão de exportar tiver sido retirada.';

create or replace function private.set_export_roles(
  p_organization_id uuid,
  p_roles public.app_role[]
)
returns public.app_role[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_previous public.app_role[];
  v_roles public.app_role[];
begin
  if v_user is null then
    raise exception 'Sua sessão expirou. Entre novamente.' using errcode = '42501';
  end if;

  if not private.has_role(p_organization_id, '{owner}'::public.app_role[]) then
    raise exception 'Somente o dono pode mudar quem exporta os dados da imobiliária.'
      using errcode = '42501';
  end if;

  -- O dono sempre exporta. Sem repetição, na ordem do enum (dono, gerente, …).
  select array_agg(x.role order by x.role)
    into v_roles
  from (
    select distinct r as role
    from unnest(coalesce(p_roles, '{}'::public.app_role[]) || '{owner}'::public.app_role[]) as r
    where r is not null
  ) x;

  select s.export_roles
    into v_previous
  from public.organization_permission_settings s
  where s.organization_id = p_organization_id
  for update;

  insert into public.organization_permission_settings (organization_id, export_roles, updated_by)
  values (p_organization_id, v_roles, v_user)
  on conflict (organization_id) do update
    set export_roles = excluded.export_roles,
        updated_by = excluded.updated_by;

  if coalesce(v_previous, '{owner,manager}'::public.app_role[]) is distinct from v_roles then
    insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, metadata)
    values (
      p_organization_id,
      v_user,
      'update',
      'organization_permission_settings',
      p_organization_id,
      jsonb_build_object(
        'changed_fields', jsonb_build_array('export_roles'),
        'export_roles', to_jsonb(v_roles),
        'previous_export_roles', to_jsonb(coalesce(v_previous, '{owner,manager}'::public.app_role[]))
      )
    );
  end if;

  return v_roles;
end;
$$;

comment on function private.set_export_roles(uuid, public.app_role[]) is
  'Só o dono: grava os papéis que exportam (o dono entra sempre) e registra a mudança em audit_events.';

-- -----------------------------------------------------------------------------
-- 3. RPCs públicas (security invoker; a checagem mora nos ajudantes)
-- -----------------------------------------------------------------------------
create or replace function public.start_data_export(
  p_organization_id uuid,
  p_dataset text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_period_preset text default null
)
returns table (export_id uuid, allowed boolean)
language sql
volatile
set search_path = ''
as $$
  select b.export_id, b.allowed
  from private.begin_data_export(
    p_organization_id, p_dataset, p_from, p_to, p_user_id, p_period_preset
  ) b;
$$;

comment on function public.start_data_export(uuid, text, timestamptz, timestamptz, uuid, text) is
  'Abre (e registra) uma exportação em CSV. allowed = false quando o papel não exporta: a recusa fica registrada e nenhuma linha sai. Os mesmos p_from/p_to/p_user_id precisam ser repassados às RPCs de exportação.';

create or replace function public.record_report_export_rows(
  p_organization_id uuid,
  p_export_id uuid,
  p_dataset text,
  p_rows integer,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  -- A base (leads, imóveis, clientes, propostas) é contada pela própria RPC de
  -- exportação; aqui só entram os relatórios agregados, que usam as mesmas
  -- RPCs da tela e não têm dado pessoal de contato.
  if p_dataset is null or p_dataset not in ('corretores', 'funil', 'origens', 'motivos-perda') then
    raise exception 'Conjunto de dados inválido para esta contagem.' using errcode = '22023';
  end if;

  perform private.add_export_rows(
    p_export_id, p_organization_id, p_dataset, p_from, p_to, p_user_id, p_rows, true
  );
end;
$$;

comment on function public.record_report_export_rows(uuid, uuid, text, integer, timestamptz, timestamptz, uuid) is
  'Informa quantas linhas saíram de um relatório agregado (corretores, funil, origens, motivos de perda) no registro da exportação.';

create or replace function public.set_export_roles(
  p_organization_id uuid,
  p_roles public.app_role[]
)
returns public.app_role[]
language sql
volatile
set search_path = ''
as $$
  select private.set_export_roles(p_organization_id, p_roles);
$$;

comment on function public.set_export_roles(uuid, public.app_role[]) is
  'Configuração do dono em /configuracoes/permissoes: quais papéis exportam CSV. O dono é sempre mantido.';

-- -----------------------------------------------------------------------------
-- 4. Exportação da base: exige o registro e conta as linhas
-- -----------------------------------------------------------------------------
-- Mesma consulta de `relatorios_desempenho`, agora em plpgsql para contar a
-- página depois do `return query`. Se o registro não valer, `add_export_rows`
-- levanta 42501 e a chamada inteira falha: nenhuma linha chega a quem chamou.
-- A assinatura muda (entra `p_export_id`), então as versões antigas saem.
drop function public.export_leads_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer);
drop function public.export_properties_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer);
drop function public.export_clients_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer);
drop function public.export_proposals_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer);

create function public.export_leads_rows(
  p_organization_id uuid,
  p_export_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 500
)
returns table (
  created_at timestamptz,
  id uuid,
  name text,
  email text,
  phone text,
  stage public.lead_stage,
  source public.lead_source,
  interest text,
  landing_page_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  assigned_to_name text,
  assigned_at timestamptz,
  first_contact_at timestamptz,
  lost_reason text,
  tracking_ids text
)
language plpgsql
volatile
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_rows integer;
begin
  return query
  with janela as (
    select
      w.inicio,
      w.fim,
      private.report_broker_filter(p_organization_id, p_user_id) as corretor,
      private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) as ve_rastreio
    from private.report_window(p_from, p_to) w
  )
  select
    l.created_at,
    l.id,
    l.name,
    l.email,
    l.phone,
    l.stage,
    l.source,
    l.interest,
    lp.name,
    nullif(btrim(l.utm ->> 'source'), ''),
    nullif(btrim(l.utm ->> 'medium'), ''),
    nullif(btrim(l.utm ->> 'campaign'), ''),
    coalesce(nullif(btrim(pr.full_name), ''), pr.email),
    l.assigned_at,
    l.last_contact_at,
    l.lost_reason,
    case when j.ve_rastreio and l.click_ids <> '{}'::jsonb then l.click_ids::text end
  from public.leads l
  cross join janela j
  left join public.landing_pages lp
    on lp.organization_id = l.organization_id and lp.id = l.landing_page_id
  left join public.profiles pr on pr.id = l.assigned_to
  where l.organization_id = p_organization_id
    and l.created_at >= j.inicio
    and l.created_at < j.fim
    and (j.corretor is null or l.assigned_to = j.corretor)
    and (
      p_after_created_at is null
      or (l.created_at, l.id) > (p_after_created_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by l.created_at, l.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);

  get diagnostics v_rows = row_count;

  perform private.add_export_rows(
    p_export_id, p_organization_id, 'leads', p_from, p_to, p_user_id, v_rows
  );
end;
$$;

comment on function public.export_leads_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) is
  'Uma página de leads para a exportação em CSV, ordenada por (created_at, id). Exige p_export_id de start_data_export (permitido, mesmos filtros) e soma as linhas nele. Security invoker: só as linhas que o RLS mostra; ids de clique só para dono e gerente.';

create function public.export_properties_rows(
  p_organization_id uuid,
  p_export_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 500
)
returns table (
  created_at timestamptz,
  id uuid,
  code text,
  title text,
  type public.property_type,
  purpose public.listing_purpose,
  status public.property_status,
  sale_price numeric,
  rent_price numeric,
  condo_fee numeric,
  neighborhood text,
  city text,
  state text,
  bedrooms smallint,
  parking_spaces smallint,
  living_area numeric,
  captured_by_name text,
  broker_name text,
  imob_score smallint,
  published_to_portals boolean
)
language plpgsql
volatile
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_rows integer;
begin
  return query
  with janela as (
    select w.inicio, w.fim, private.report_broker_filter(p_organization_id, p_user_id) as corretor
    from private.report_window(p_from, p_to) w
  )
  select
    p.created_at,
    p.id,
    p.code,
    p.title,
    p.type,
    p.purpose,
    p.status,
    p.sale_price,
    p.rent_price,
    p.condo_fee,
    p.neighborhood,
    p.city,
    p.state,
    p.bedrooms,
    p.parking_spaces,
    p.living_area,
    coalesce(nullif(btrim(cap.full_name), ''), cap.email),
    coalesce(nullif(btrim(cor.full_name), ''), cor.email),
    p.imob_score,
    p.published_to_portals
  from public.properties p
  cross join janela j
  left join public.profiles cap on cap.id = p.captured_by
  left join public.profiles cor on cor.id = p.broker_id
  where p.organization_id = p_organization_id
    and p.created_at >= j.inicio
    and p.created_at < j.fim
    and (j.corretor is null or p.captured_by = j.corretor or p.broker_id = j.corretor)
    and (
      p_after_created_at is null
      or (p.created_at, p.id) > (p_after_created_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by p.created_at, p.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);

  get diagnostics v_rows = row_count;

  perform private.add_export_rows(
    p_export_id, p_organization_id, 'imoveis', p_from, p_to, p_user_id, v_rows
  );
end;
$$;

comment on function public.export_properties_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) is
  'Uma página de imóveis para a exportação em CSV, ordenada por (created_at, id). Exige p_export_id de start_data_export e soma as linhas nele. Fora de dono e gerente o recorte é sempre o próprio usuário (captador ou corretor do imóvel).';

create function public.export_clients_rows(
  p_organization_id uuid,
  p_export_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 500
)
returns table (
  created_at timestamptz,
  id uuid,
  name text,
  kind public.client_kind,
  document text,
  birth_date date,
  email text,
  phone text,
  whatsapp text,
  neighborhood text,
  city text,
  state text,
  source text,
  tags text[],
  assigned_to_name text,
  lgpd_consent_at timestamptz
)
language plpgsql
volatile
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_rows integer;
begin
  return query
  with janela as (
    select
      w.inicio,
      w.fim,
      private.report_broker_filter(p_organization_id, p_user_id) as corretor,
      private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) as ve_documento
    from private.report_window(p_from, p_to) w
  )
  select
    c.created_at,
    c.id,
    c.name,
    c.kind,
    case when j.ve_documento then c.document end,
    case when j.ve_documento then c.birth_date end,
    c.email,
    c.phone,
    c.whatsapp,
    c.neighborhood,
    c.city,
    c.state,
    c.source,
    c.tags,
    coalesce(nullif(btrim(pr.full_name), ''), pr.email),
    c.lgpd_consent_at
  from public.clients c
  cross join janela j
  left join public.profiles pr on pr.id = c.assigned_to
  where c.organization_id = p_organization_id
    and c.created_at >= j.inicio
    and c.created_at < j.fim
    and (j.corretor is null or c.assigned_to = j.corretor)
    and (
      p_after_created_at is null
      or (c.created_at, c.id) > (p_after_created_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by c.created_at, c.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);

  get diagnostics v_rows = row_count;

  perform private.add_export_rows(
    p_export_id, p_organization_id, 'clientes', p_from, p_to, p_user_id, v_rows
  );
end;
$$;

comment on function public.export_clients_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) is
  'Uma página de clientes para a exportação em CSV, ordenada por (created_at, id). Exige p_export_id de start_data_export e soma as linhas nele. Security invoker: só as linhas que o RLS mostra; CPF/CNPJ e nascimento só para dono e gerente.';

create function public.export_proposals_rows(
  p_organization_id uuid,
  p_export_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 500
)
returns table (
  created_at timestamptz,
  id uuid,
  property_code text,
  property_title text,
  client_name text,
  broker_name text,
  purpose public.listing_purpose,
  amount numeric,
  status public.proposal_status,
  valid_until date,
  decided_at timestamptz
)
language plpgsql
volatile
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_rows integer;
begin
  return query
  with janela as (
    select w.inicio, w.fim, private.report_broker_filter(p_organization_id, p_user_id) as corretor
    from private.report_window(p_from, p_to) w
  )
  select
    pp.created_at,
    pp.id,
    im.code,
    im.title,
    cl.name,
    coalesce(nullif(btrim(pr.full_name), ''), pr.email),
    pp.purpose,
    pp.amount,
    pp.status,
    pp.valid_until,
    pp.decided_at
  from public.proposals pp
  cross join janela j
  left join public.properties im
    on im.organization_id = pp.organization_id and im.id = pp.property_id
  left join public.clients cl
    on cl.organization_id = pp.organization_id and cl.id = pp.client_id
  left join public.profiles pr on pr.id = pp.broker_id
  where pp.organization_id = p_organization_id
    and pp.created_at >= j.inicio
    and pp.created_at < j.fim
    and (j.corretor is null or pp.broker_id = j.corretor)
    and (
      p_after_created_at is null
      or (pp.created_at, pp.id) > (p_after_created_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
    )
  order by pp.created_at, pp.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);

  get diagnostics v_rows = row_count;

  perform private.add_export_rows(
    p_export_id, p_organization_id, 'propostas', p_from, p_to, p_user_id, v_rows
  );
end;
$$;

comment on function public.export_proposals_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) is
  'Uma página de propostas para a exportação em CSV, ordenada por (created_at, id). Exige p_export_id de start_data_export e soma as linhas nele. O nome do cliente sai em branco quando o RLS de clients não libera aquele cliente.';

-- -----------------------------------------------------------------------------
-- 5. Contato do proprietário
-- -----------------------------------------------------------------------------
-- Antes, o captador lia (e editava) QUALQUER cliente que fosse proprietário de
-- algum imóvel da imobiliária — telefone, e-mail e CPF inclusive. Agora:
--   owner/manager/assistant: todos (leitura e escrita), como antes
--   finance: todos, só leitura, como antes
--   broker: responsável ou compartilhado (como antes) + LEITURA do proprietário
--           dos imóveis em que ele é corretor ou captador
--   capturer: os que cadastrou + proprietários dos imóveis em que ele é
--             captador ou corretor
-- `property_owners` continua legível para a equipe (só liga imóvel a cliente e
-- guarda o percentual); nome, contato e documento vêm de `clients`, que é onde
-- esta regra vale — inclusive nos embeds do PostgREST e na busca por
-- proprietário de `search_properties` (security invoker).
create or replace function private.can_access_client_row(
  org uuid,
  client uuid,
  client_assigned_to uuid,
  client_created_by uuid,
  for_write boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.active
      and (
        m.role in ('owner', 'manager', 'assistant')
        or (m.role = 'finance' and not for_write)
        or (
          m.role = 'broker'
          and (
            client_assigned_to = m.user_id
            or exists (
              select 1 from public.client_shares s
              where s.client_id = client and s.user_id = m.user_id
            )
            or (
              not for_write
              and exists (
                select 1
                from public.property_owners po
                join public.properties p
                  on p.organization_id = po.organization_id and p.id = po.property_id
                where po.organization_id = org
                  and po.client_id = client
                  and m.user_id in (p.captured_by, p.broker_id)
              )
            )
          )
        )
        or (
          m.role = 'capturer'
          and (
            client_created_by = m.user_id
            or exists (
              select 1
              from public.property_owners po
              join public.properties p
                on p.organization_id = po.organization_id and p.id = po.property_id
              where po.organization_id = org
                and po.client_id = client
                and m.user_id in (p.captured_by, p.broker_id)
            )
          )
        )
      )
  );
$$;

comment on function private.can_access_client_row(uuid, uuid, uuid, uuid, boolean) is
  'Acesso a cliente pelas colunas da linha. Dono, gerente e assistente: todos. Financeiro: todos, só leitura. Corretor: responsável, compartilhado ou (só leitura) proprietário de imóvel em que é corretor/captador. Captador: os que cadastrou e os proprietários dos imóveis em que é captador/corretor.';

-- -----------------------------------------------------------------------------
-- 6. Índice e grants
-- -----------------------------------------------------------------------------
-- A tela de exportações lista só `data_export` da imobiliária, do mais recente.
create index audit_events_data_export_idx
  on public.audit_events (organization_id, created_at desc)
  where entity = 'data_export';

revoke all on function private.can_export_data(uuid) from public, anon;
grant execute on function private.can_export_data(uuid) to authenticated;

revoke all on function private.begin_data_export(uuid, text, timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function private.begin_data_export(uuid, text, timestamptz, timestamptz, uuid, text) to authenticated;

revoke all on function private.add_export_rows(uuid, uuid, text, timestamptz, timestamptz, uuid, integer, boolean) from public, anon;
grant execute on function private.add_export_rows(uuid, uuid, text, timestamptz, timestamptz, uuid, integer, boolean) to authenticated;

revoke all on function private.set_export_roles(uuid, public.app_role[]) from public, anon;
grant execute on function private.set_export_roles(uuid, public.app_role[]) to authenticated;

revoke all on function public.start_data_export(uuid, text, timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.start_data_export(uuid, text, timestamptz, timestamptz, uuid, text) to authenticated;

revoke all on function public.record_report_export_rows(uuid, uuid, text, integer, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.record_report_export_rows(uuid, uuid, text, integer, timestamptz, timestamptz, uuid) to authenticated;

revoke all on function public.set_export_roles(uuid, public.app_role[]) from public, anon;
grant execute on function public.set_export_roles(uuid, public.app_role[]) to authenticated;

revoke all on function public.export_leads_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.export_leads_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to authenticated;

revoke all on function public.export_properties_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.export_properties_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to authenticated;

revoke all on function public.export_clients_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.export_clients_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to authenticated;

revoke all on function public.export_proposals_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.export_proposals_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to authenticated;
