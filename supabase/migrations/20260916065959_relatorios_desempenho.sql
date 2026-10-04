-- =============================================================================
-- 2600 - Relatórios: desempenho por corretor, funil por etapa, origem e export
-- =============================================================================
--  1. Índices das varreduras por período
--  2. Ajudantes do schema private (janela, escopo do corretor, ordem das etapas)
--  3. RPCs de relatório: corretor, funil por etapa, origem e motivo de perda
--  4. RPCs de exportação: páginas de leads, imóveis, clientes e propostas
--  5. Grants
--
-- TUDO aqui é `security invoker` (o padrão): quem decide o que entra na conta é
-- o RLS da sessão que chamou. Um corretor só soma os leads e os clientes que já
-- enxerga em /leads e /clientes; um id de outra imobiliária devolve zero linhas.
-- As funções existem para a agregação acontecer no Postgres, nunca para o app
-- baixar listas e contar no Node.
--
-- `properties` e `proposals` são lidas por QUALQUER membro da imobiliária
-- (policies "properties: membros leem" e "proposals: membros leem"), então o RLS
-- sozinho não separaria o número de um corretor do número do colega. Por isso
-- todo relatório passa por `private.report_broker_filter`: dono e gerente
-- escolhem o corretor (ou veem todos); qualquer outro papel é forçado a si
-- mesmo, mesmo que mande o id do colega no parâmetro.
--
-- Definições que a tela e o supabase/README.md repetem, para o número não
-- mudar de significado entre a planilha e o painel:
--   - "leads recebidos": leads que ESTÃO com o corretor e foram entregues a ele
--     dentro do período (`leads.assigned_at`, mantido pelo trigger
--     `leads_before_write`; antes do rodízio existir, cai em `created_at`);
--   - "no prazo": primeiro contato até `assigned_at + lead_routing_settings.sla_minutes`
--     (mesma conta de `get_lead_routing_overview`);
--   - "ganhos"/"perdidos": leads que ENTRARAM em `won`/`lost` dentro do período,
--     segundo `lead_stage_events` — produção do período, não coorte de entrada;
--   - "em aberto": foto de hoje (nem ganho nem perdido), sem recorte de período;
--   - "imóveis captados": `properties.captured_by` (o campo Captador do
--     cadastro), criados no período;
--   - "propostas fechadas": `proposals.status = 'accepted'` com `decided_at` no
--     período.

-- -----------------------------------------------------------------------------
-- 1. Índices
-- -----------------------------------------------------------------------------
-- As varreduras de relatório são sempre (imobiliária + janela de tempo). `leads`
-- já tem (organization_id, created_at desc) desde `painel_charts`.
create index if not exists lead_stage_events_organization_created_idx
  on public.lead_stage_events (organization_id, created_at);
create index if not exists lead_assignment_events_organization_created_idx
  on public.lead_assignment_events (organization_id, created_at);
create index if not exists properties_organization_created_idx
  on public.properties (organization_id, created_at);
create index if not exists proposals_organization_created_idx
  on public.proposals (organization_id, created_at);
create index if not exists clients_organization_created_idx
  on public.clients (organization_id, created_at);

-- -----------------------------------------------------------------------------
-- 2. Ajudantes
-- -----------------------------------------------------------------------------
-- Janela do relatório, com os limites que impedem uma consulta absurda: sem
-- parâmetro são os últimos 30 dias, o fim nunca fica antes do início e o período
-- não passa de 400 dias.
create or replace function private.report_window(
  p_from timestamptz,
  p_to timestamptz
)
returns table (inicio timestamptz, fim timestamptz)
language sql
stable
set search_path = ''
as $$
  select
    s.i,
    least(
      greatest(coalesce(p_to, now()), s.i + interval '1 minute'),
      s.i + interval '400 days'
    )
  from (select coalesce(p_from, now() - interval '30 days') as i) s;
$$;

comment on function private.report_window(timestamptz, timestamptz) is
  'Janela de um relatório: padrão de 30 dias, fim sempre depois do início e no máximo 400 dias.';

-- Corretor efetivo do relatório. Dono e gerente escolhem (null = a equipe
-- inteira); qualquer outro papel só enxerga o próprio desempenho, ainda que
-- mande o id de um colega.
create or replace function private.report_broker_filter(
  p_organization_id uuid,
  p_user_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) then p_user_id
    else (select auth.uid())
  end;
$$;

comment on function private.report_broker_filter(uuid, uuid) is
  'Corretor que o relatório pode recortar: dono e gerente escolhem (null = todos), os demais papéis são forçados ao próprio usuário.';

-- Ordem das etapas que contam como AVANÇO no funil. 'lost' fica de fora (volta
-- null): sair para "Perdido" nunca é conversão.
create or replace function private.lead_stage_rank(p_stage public.lead_stage)
returns integer
language sql
immutable
set search_path = ''
as $$
  select array_position(
    array['new', 'contacted', 'qualified', 'visit_scheduled', 'proposal', 'won']::public.lead_stage[],
    p_stage
  );
$$;

comment on function private.lead_stage_rank(public.lead_stage) is
  'Posição da etapa no funil (1 a 6). Devolve null para "lost": perder não é avançar.';

-- -----------------------------------------------------------------------------
-- 3. Relatórios
-- -----------------------------------------------------------------------------

-- 3.1 Desempenho por corretor -------------------------------------------------
-- Uma linha por membro no escopo de quem chamou. Dono e gerente recebem a equipe
-- inteira (é a comparação entre corretores da mesma imobiliária); os demais
-- papéis recebem só a própria linha.
create or replace function public.report_broker_performance(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  user_id uuid,
  full_name text,
  member_role public.app_role,
  member_active boolean,
  leads_received bigint,
  leads_answered bigint,
  leads_in_sla bigint,
  leads_won bigint,
  leads_lost bigint,
  leads_open bigint,
  leads_taken_by_sla bigint,
  first_response_median_minutes numeric,
  properties_captured bigint,
  proposals_made bigint,
  proposals_closed bigint,
  proposals_closed_amount numeric
)
language sql
stable
set search_path = ''
as $$
  with janela as (
    select
      w.inicio,
      w.fim,
      coalesce(
        (
          select s.sla_minutes
          from public.lead_routing_settings s
          where s.organization_id = p_organization_id
        ),
        5
      ) as sla_minutes,
      private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) as ve_equipe,
      (select auth.uid()) as eu
    from private.report_window(p_from, p_to) w
  ),
  equipe as (
    select m.user_id, m.role, m.active
    from public.memberships m
    cross join janela j
    where m.organization_id = p_organization_id
      and (j.ve_equipe or m.user_id = j.eu)
  )
  select
    e.user_id,
    coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Membro sem nome'),
    e.role,
    e.active,
    atendimento.recebidos,
    atendimento.atendidos,
    atendimento.no_prazo,
    fechamento.ganhos,
    fechamento.perdidos,
    abertos.total,
    prazo.tomados,
    atendimento.mediana_minutos,
    imoveis.captados,
    propostas.feitas,
    propostas.fechadas,
    propostas.valor_fechado
  from equipe e
  cross join janela j
  left join public.profiles pr on pr.id = e.user_id
  cross join lateral (
    select
      count(*) as recebidos,
      count(*) filter (where l.last_contact_at is not null) as atendidos,
      count(*) filter (
        where l.last_contact_at is not null
          and l.last_contact_at
              <= coalesce(l.assigned_at, l.created_at) + make_interval(mins => j.sla_minutes)
      ) as no_prazo,
      round(
        percentile_cont(0.5) within group (
          -- Contato antes da entrega (lead reatribuído depois de atendido) não é
          -- tempo de resposta: vira null e a mediana o ignora.
          order by case
            when l.last_contact_at >= coalesce(l.assigned_at, l.created_at)
              then extract(epoch from (l.last_contact_at - coalesce(l.assigned_at, l.created_at))) / 60
          end
        )::numeric,
        1
      ) as mediana_minutos
    from public.leads l
    where l.organization_id = p_organization_id
      and l.assigned_to = e.user_id
      and coalesce(l.assigned_at, l.created_at) >= j.inicio
      and coalesce(l.assigned_at, l.created_at) < j.fim
  ) atendimento
  cross join lateral (
    select
      count(distinct ev.lead_id) filter (where ev.to_stage = 'won') as ganhos,
      count(distinct ev.lead_id) filter (where ev.to_stage = 'lost') as perdidos
    from public.lead_stage_events ev
    join public.leads l
      on l.organization_id = ev.organization_id and l.id = ev.lead_id
    where ev.organization_id = p_organization_id
      and ev.to_stage in ('won', 'lost')
      and ev.created_at >= j.inicio
      and ev.created_at < j.fim
      and l.assigned_to = e.user_id
  ) fechamento
  cross join lateral (
    -- Foto de hoje: quanto ainda está na mão do corretor, sem recorte de período.
    select count(*) as total
    from public.leads l
    where l.organization_id = p_organization_id
      and l.assigned_to = e.user_id
      and l.stage not in ('won', 'lost')
  ) abertos
  cross join lateral (
    -- Leads que a roleta TIROU deste corretor por estouro do prazo. Depois da
    -- troca o lead é de outra pessoa, então esta conta só fecha para quem vê a
    -- equipe inteira — é um número de gestão.
    select count(*) as tomados
    from public.lead_assignment_events ae
    where ae.organization_id = p_organization_id
      and ae.from_user_id = e.user_id
      and ae.reason = 'sla_reassign'
      and ae.created_at >= j.inicio
      and ae.created_at < j.fim
  ) prazo
  cross join lateral (
    select count(*) as captados
    from public.properties p
    where p.organization_id = p_organization_id
      and p.captured_by = e.user_id
      and p.created_at >= j.inicio
      and p.created_at < j.fim
  ) imoveis
  cross join lateral (
    select
      count(*) filter (where p.created_at >= j.inicio and p.created_at < j.fim) as feitas,
      count(*) filter (
        where p.status = 'accepted' and p.decided_at >= j.inicio and p.decided_at < j.fim
      ) as fechadas,
      coalesce(
        sum(p.amount) filter (
          where p.status = 'accepted' and p.decided_at >= j.inicio and p.decided_at < j.fim
        ),
        0
      ) as valor_fechado
    from public.proposals p
    where p.organization_id = p_organization_id
      and p.broker_id = e.user_id
      and (
        (p.created_at >= j.inicio and p.created_at < j.fim)
        or (p.decided_at >= j.inicio and p.decided_at < j.fim)
      )
  ) propostas
  -- Ordinais das colunas de saída: ganhos, depois recebidos, depois o nome.
  order by 8 desc, 5 desc, 2;
$$;

comment on function public.report_broker_performance(uuid, timestamptz, timestamptz) is
  'Relatório por corretor no período: leads recebidos, atendidos, dentro do SLA, ganhos, perdidos, em aberto, tomados por estouro de prazo, mediana do primeiro contato, imóveis captados e propostas feitas/fechadas. Security invoker; dono e gerente recebem a equipe inteira, os demais papéis só a própria linha.';

-- 3.2 Funil por etapa ---------------------------------------------------------
-- Vem de public.lead_stage_events: quantas ENTRADAS cada etapa teve no período,
-- quantas avançaram para uma etapa adiante, quantas foram para "Perdido",
-- quantas continuam ali hoje, e quanto tempo o lead ficou na fase (mediana e
-- média em horas). Um lead que volta de etapa conta duas entradas, de propósito.
create or replace function public.report_stage_funnel(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null
)
returns table (
  stage public.lead_stage,
  entered bigint,
  advanced bigint,
  lost_after bigint,
  still_there bigint,
  median_hours numeric,
  avg_hours numeric
)
language sql
stable
set search_path = ''
as $$
  with janela as (
    select w.inicio, w.fim, private.report_broker_filter(p_organization_id, p_user_id) as corretor
    from private.report_window(p_from, p_to) w
  ),
  eventos as (
    -- Sem limite superior de propósito: um lead que entrou na etapa dentro do
    -- período e só avançou depois do fim continua contando como avanço, e o
    -- tempo na fase é o tempo real, não o tempo até a borda do relatório.
    select
      ev.to_stage,
      ev.created_at,
      lead(ev.created_at) over w as proximo_em,
      max(private.lead_stage_rank(ev.to_stage)) over (
        partition by ev.lead_id
        order by ev.created_at, ev.id
        rows between 1 following and unbounded following
      ) as maior_depois,
      bool_or(ev.to_stage = 'lost') over (
        partition by ev.lead_id
        order by ev.created_at, ev.id
        rows between 1 following and unbounded following
      ) as perdeu_depois
    from public.lead_stage_events ev
    join public.leads l
      on l.organization_id = ev.organization_id and l.id = ev.lead_id
    cross join janela j
    where ev.organization_id = p_organization_id
      and ev.created_at >= j.inicio
      and (j.corretor is null or l.assigned_to = j.corretor)
    window w as (partition by ev.lead_id order by ev.created_at, ev.id)
  ),
  etapas as (
    select
      e.to_stage as stage,
      count(*) as entrou,
      count(*) filter (
        where e.maior_depois > private.lead_stage_rank(e.to_stage)
      ) as avancou,
      count(*) filter (where e.perdeu_depois) as perdeu,
      count(*) filter (where e.proximo_em is null) as parado,
      round(
        percentile_cont(0.5) within group (
          order by extract(epoch from (e.proximo_em - e.created_at)) / 3600
        )::numeric,
        2
      ) as mediana,
      round(
        avg(extract(epoch from (e.proximo_em - e.created_at)) / 3600)
          filter (where e.proximo_em is not null)::numeric,
        2
      ) as media
    from eventos e
    cross join janela j
    where e.created_at < j.fim
    group by e.to_stage
  )
  select
    s.stage,
    coalesce(et.entrou, 0),
    coalesce(et.avancou, 0),
    coalesce(et.perdeu, 0),
    coalesce(et.parado, 0),
    et.mediana,
    et.media
  from unnest(
    array['new', 'contacted', 'qualified', 'visit_scheduled', 'proposal', 'won', 'lost']::public.lead_stage[]
  ) with ordinality as s(stage, ordem)
  left join etapas et on et.stage = s.stage
  order by s.ordem;
$$;

comment on function public.report_stage_funnel(uuid, timestamptz, timestamptz, uuid) is
  'Funil por etapa a partir de public.lead_stage_events: entradas, avanços (base da taxa de conversão), perdas, quantos continuam na etapa e o tempo na fase (mediana e média em horas). Security invoker; p_user_id só é respeitado para dono e gerente.';

-- 3.3 Origem do lead ----------------------------------------------------------
-- Uma linha por (origem, landing page, utm_source/medium/campaign) com quantos
-- leads chegaram e quantos FECHARAM. É a conta que separa a origem que traz
-- volume da origem que traz negócio.
create or replace function public.report_lead_sources(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_limit integer default 100
)
returns table (
  source public.lead_source,
  landing_page_id uuid,
  landing_page_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  leads bigint,
  answered bigint,
  won bigint,
  lost bigint,
  open_leads bigint
)
language sql
stable
set search_path = ''
as $$
  with janela as (
    select w.inicio, w.fim, private.report_broker_filter(p_organization_id, p_user_id) as corretor
    from private.report_window(p_from, p_to) w
  )
  select
    l.source,
    l.landing_page_id,
    lp.name,
    nullif(btrim(l.utm ->> 'source'), ''),
    nullif(btrim(l.utm ->> 'medium'), ''),
    nullif(btrim(l.utm ->> 'campaign'), ''),
    count(*),
    count(*) filter (where l.last_contact_at is not null),
    count(*) filter (where l.stage = 'won'),
    count(*) filter (where l.stage = 'lost'),
    count(*) filter (where l.stage not in ('won', 'lost'))
  from public.leads l
  cross join janela j
  left join public.landing_pages lp
    on lp.organization_id = l.organization_id and lp.id = l.landing_page_id
  where l.organization_id = p_organization_id
    and l.created_at >= j.inicio
    and l.created_at < j.fim
    and (j.corretor is null or l.assigned_to = j.corretor)
  group by 1, 2, 3, 4, 5, 6
  order by 9 desc, 7 desc, 1
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

comment on function public.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer) is
  'Origem dos leads criados no período (canal, landing page e utm_source/medium/campaign) com quantos chegaram, foram atendidos, ganhos, perdidos e seguem abertos. Security invoker; p_user_id só é respeitado para dono e gerente.';

-- 3.4 Motivo da perda ---------------------------------------------------------
-- Leads que ENTRARAM em "Perdido" no período, agrupados pelo motivo que está no
-- registro hoje (leads.lost_reason é texto livre). Motivo em branco volta null.
create or replace function public.report_lead_lost_reasons(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_limit integer default 20
)
returns table (lost_reason text, total bigint)
language sql
stable
set search_path = ''
as $$
  with janela as (
    select w.inicio, w.fim, private.report_broker_filter(p_organization_id, p_user_id) as corretor
    from private.report_window(p_from, p_to) w
  ),
  perdidos as (
    select distinct l.id, nullif(btrim(l.lost_reason), '') as motivo
    from public.lead_stage_events ev
    join public.leads l
      on l.organization_id = ev.organization_id and l.id = ev.lead_id
    cross join janela j
    where ev.organization_id = p_organization_id
      and ev.to_stage = 'lost'
      and ev.created_at >= j.inicio
      and ev.created_at < j.fim
      and (j.corretor is null or l.assigned_to = j.corretor)
  )
  select p.motivo, count(*)
  from perdidos p
  group by p.motivo
  order by 2 desc, 1 nulls last
  limit least(greatest(coalesce(p_limit, 20), 1), 200);
$$;

comment on function public.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer) is
  'Motivos de perda dos leads que entraram em "Perdido" no período. Motivo em branco volta null (a tela mostra "Sem motivo informado"). Security invoker; p_user_id só é respeitado para dono e gerente.';

-- -----------------------------------------------------------------------------
-- 4. Exportação (uma página por chamada)
-- -----------------------------------------------------------------------------
-- Todas paginam por chave composta (created_at, id): a rota do Next pede a
-- próxima página a partir da última linha que já transmitiu, então nem o
-- Postgres nem a função do Next seguram a base inteira em memória.
--
-- Colunas sensíveis: `clients.document/birth_date` e `leads.click_ids` só saem
-- para dono e gerente (os mesmos papéis de `canSeeLeadTrackingIds` na
-- interface). Quem não pode ver recebe a coluna vazia — e continua exportando
-- apenas as LINHAS que o RLS já lhe mostra.

create or replace function public.export_leads_rows(
  p_organization_id uuid,
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
language sql
stable
set search_path = ''
as $$
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
$$;

comment on function public.export_leads_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) is
  'Uma página de leads para a exportação em CSV, ordenada por (created_at, id) e continuada por p_after_created_at/p_after_id. Security invoker: só as linhas que o RLS mostra. Os ids de clique só saem para dono e gerente.';

create or replace function public.export_properties_rows(
  p_organization_id uuid,
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
language sql
stable
set search_path = ''
as $$
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
$$;

comment on function public.export_properties_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) is
  'Uma página de imóveis para a exportação em CSV, ordenada por (created_at, id). Security invoker; fora de dono e gerente o recorte é sempre o próprio usuário (captador ou corretor do imóvel).';

create or replace function public.export_clients_rows(
  p_organization_id uuid,
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
language sql
stable
set search_path = ''
as $$
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
$$;

comment on function public.export_clients_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) is
  'Uma página de clientes para a exportação em CSV, ordenada por (created_at, id). Security invoker: só as linhas que o RLS mostra. CPF/CNPJ e data de nascimento só saem para dono e gerente.';

create or replace function public.export_proposals_rows(
  p_organization_id uuid,
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
language sql
stable
set search_path = ''
as $$
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
$$;

comment on function public.export_proposals_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) is
  'Uma página de propostas para a exportação em CSV, ordenada por (created_at, id). Security invoker; o nome do cliente sai em branco quando o RLS de clients não libera aquele cliente para quem exporta.';

-- -----------------------------------------------------------------------------
-- 5. Grants
-- -----------------------------------------------------------------------------
-- Os privilégios padrão do Supabase dariam EXECUTE a `public` (logo, a `anon`)
-- em toda função nova: aqui nenhuma é pública.
revoke all on function private.report_window(timestamptz, timestamptz) from public, anon;
grant execute on function private.report_window(timestamptz, timestamptz) to authenticated;

revoke all on function private.report_broker_filter(uuid, uuid) from public, anon;
grant execute on function private.report_broker_filter(uuid, uuid) to authenticated;

revoke all on function private.lead_stage_rank(public.lead_stage) from public, anon;
grant execute on function private.lead_stage_rank(public.lead_stage) to authenticated;

revoke all on function public.report_broker_performance(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_broker_performance(uuid, timestamptz, timestamptz) to authenticated;

revoke all on function public.report_stage_funnel(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.report_stage_funnel(uuid, timestamptz, timestamptz, uuid) to authenticated;

revoke all on function public.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer) from public, anon;
grant execute on function public.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer) to authenticated;

revoke all on function public.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer) from public, anon;
grant execute on function public.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer) to authenticated;

revoke all on function public.export_leads_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.export_leads_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to authenticated;

revoke all on function public.export_properties_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.export_properties_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to authenticated;

revoke all on function public.export_clients_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.export_clients_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to authenticated;

revoke all on function public.export_proposals_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.export_proposals_rows(uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to authenticated;
