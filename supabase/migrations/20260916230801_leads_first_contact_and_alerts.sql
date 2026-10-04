-- =============================================================================
-- 2700 - Tempo de resposta verdadeiro e lead que não se perde
-- =============================================================================
--  1. leads.first_contact_at (1º contato, gravado uma vez) e leads.sla_breached_at
--  2. Backfill do 1º contato com o menor instante conhecido do histórico
--  3. leads_before_write: grava o 1º contato uma única vez e zera o estouro
--  4. Relatórios, exportação e painel do rodízio medem o 1º contato
--  5. Fila de avisos: novo tipo sla_breached (aviso à gestão)
--  6. Passada do rodízio: sem outro corretor elegível, o lead fica com o
--     responsável, o estouro é registrado e a gestão é avisada
--  7. route_lead: a roleta manual não tira o lead do único corretor
--  8. Todo lead que entra sem sessão (landing page, página do imóvel, portal,
--     Meta Lead Ads) enfileira o aviso de lead novo, com ou sem rodízio
--
-- Por que: o "1º contato" e o "SLA cumprido" dos relatórios usavam
-- leads.last_contact_at, que o botão "Registrar contato" sobrescreve a cada
-- clique — um lead atendido em 3 min e recontatado 2 dias depois virava "2 dias"
-- e saía do prazo. last_contact_at continua existindo como ÚLTIMO contato.

-- -----------------------------------------------------------------------------
-- 1. Colunas
-- -----------------------------------------------------------------------------
alter table public.leads
  add column if not exists first_contact_at timestamptz,
  add column if not exists sla_breached_at timestamptz;

comment on column public.leads.first_contact_at is
  'Primeiro contato com o lead. Gravado uma única vez pelo trigger leads_before_write, na primeira vez que last_contact_at é preenchido, e nunca muda depois (o app não escreve). Base do tempo de primeiro atendimento e do SLA nos relatórios e no painel do rodízio.';
comment on column public.leads.last_contact_at is
  'Último contato registrado ("Registrar contato", WhatsApp da ficha, mudança de etapa). Muda a cada contato; o primeiro fica em first_contact_at.';
comment on column public.leads.sla_breached_at is
  'Quando o prazo do primeiro contato estourou e o rodízio não tinha outro corretor elegível (ou o lead já esgotou as redistribuições): o lead continua com o responsável e a gestão recebe o aviso sla_breached. Um registro por atribuição; zera quando o responsável muda.';

-- -----------------------------------------------------------------------------
-- 2. Backfill: o menor instante de contato que o histórico comprova
-- -----------------------------------------------------------------------------
-- Fontes (nenhuma inventa dado; a menor vence):
--   * leads.last_contact_at (último contato gravado hoje);
--   * lead_stage_events: o lead saiu de "Novo" (ou nasceu fora dele), e o
--     banco/app preenchem last_contact_at nesse instante;
--   * audit_events: primeira alteração registrada de last_contact_at.
-- Só os triggers que mexeriam no resultado (ou no updated_at) ficam desligados
-- durante o UPDATE, e voltam logo em seguida.
alter table public.leads disable trigger a0_billing_writable;
alter table public.leads disable trigger leads_audit;
alter table public.leads disable trigger leads_before_write;
alter table public.leads disable trigger leads_set_updated_at;

update public.leads l
set first_contact_at = h.primeiro
from (
  select
    x.id,
    least(
      x.last_contact_at,
      (
        select min(e.created_at)
        from public.lead_stage_events e
        where e.organization_id = x.organization_id
          and e.lead_id = x.id
          and e.to_stage <> 'new'
          and (e.from_stage is null or e.from_stage = 'new')
      ),
      (
        select min(a.created_at)
        from public.audit_events a
        where a.organization_id = x.organization_id
          and a.entity = 'leads'
          and a.entity_id = x.id
          and a.action = 'update'
          and a.metadata -> 'changed_fields' ? 'last_contact_at'
      )
    ) as primeiro
  from public.leads x
  where x.first_contact_at is null
    and x.last_contact_at is not null
) h
where h.id = l.id
  and h.primeiro is not null;

alter table public.leads enable trigger a0_billing_writable;
alter table public.leads enable trigger leads_audit;
alter table public.leads enable trigger leads_before_write;
alter table public.leads enable trigger leads_set_updated_at;

-- -----------------------------------------------------------------------------
-- 3. leads_before_write: 1º contato gravado uma vez
-- -----------------------------------------------------------------------------
-- Igual à versão da migração lead_roulette_sla, mais:
--   * first_contact_at nasce do primeiro last_contact_at preenchido (contato
--     "no futuro" vira o instante da gravação) e nunca mais muda;
--   * o prazo do 1º contato olha first_contact_at, então apagar ou reescrever
--     last_contact_at não reabre nem encerra o prazo;
--   * sla_breached_at zera quando o responsável muda (nova atribuição, novo prazo).
create or replace function private.leads_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '');
  new.message := nullif(btrim(coalesce(new.message, '')), '');
  new.typology := nullif(btrim(coalesce(new.typology, '')), '');
  new.lost_reason := nullif(btrim(coalesce(new.lost_reason, '')), '');

  if char_length(coalesce(new.name, '')) not between 2 and 120 then
    raise exception 'Informe o nome do lead (2 a 120 caracteres).' using errcode = '23514';
  end if;

  if new.email is not null and (
    char_length(new.email) > 254
    or new.email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
    or position('..' in new.email) > 0
  ) then
    raise exception 'E-mail inválido.' using errcode = '23514';
  end if;

  if new.phone is not null and new.phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido: informe DDD e número.' using errcode = '23514';
  end if;

  if new.stage = 'lost' and new.lost_reason is null then
    raise exception 'Informe o motivo da perda do lead.' using errcode = '23514';
  end if;

  if new.stage <> 'new'
     and new.last_contact_at is null
     and (tg_op = 'INSERT' or old.stage = 'new') then
    new.last_contact_at := now();
  end if;

  -- Primeiro contato: uma única vez, na primeira vez que last_contact_at é
  -- preenchido. Depois disso nenhum UPDATE o altera.
  if tg_op = 'UPDATE' then
    if old.first_contact_at is not null then
      new.first_contact_at := old.first_contact_at;
    elsif new.last_contact_at is not null then
      new.first_contact_at := least(new.last_contact_at, now());
    else
      new.first_contact_at := null;
    end if;
  elsif new.last_contact_at is not null then
    new.first_contact_at := least(new.last_contact_at, now());
  else
    new.first_contact_at := null;
  end if;

  -- Quando o responsável muda, o relógio do primeiro contato recomeça.
  if tg_op = 'INSERT' then
    new.assigned_at := case when new.assigned_to is not null then now() end;
    new.sla_breached_at := null;
  elsif new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is not null then now() end;
    new.sla_warned_at := null;
    new.sla_breached_at := null;
  end if;

  -- Prazo de primeiro contato: só com responsável, em "Novo" e sem contato.
  if new.assigned_to is null or new.stage <> 'new' or new.first_contact_at is not null then
    new.first_response_due_at := null;
  elsif tg_op = 'INSERT'
     or new.assigned_to is distinct from old.assigned_to
     or old.first_response_due_at is null then
    new.first_response_due_at := coalesce(new.assigned_at, now())
      + make_interval(mins => private.lead_sla_minutes(new.organization_id));
  end if;

  return new;
end;
$$;

revoke all on function private.leads_before_write() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Relatórios, exportação e painel: 1º contato de verdade
-- -----------------------------------------------------------------------------

-- 4.1 Desempenho por corretor (mesma função, trocando a base do atendimento).
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
    -- Primeiro contato (first_contact_at, gravado uma vez): um "Registrar
    -- contato" dias depois não muda nem a mediana nem o "no prazo".
    select
      count(*) as recebidos,
      count(*) filter (where l.first_contact_at is not null) as atendidos,
      count(*) filter (
        where l.first_contact_at is not null
          and l.first_contact_at
              <= coalesce(l.assigned_at, l.created_at) + make_interval(mins => j.sla_minutes)
      ) as no_prazo,
      round(
        percentile_cont(0.5) within group (
          -- Contato antes da entrega (lead reatribuído depois de atendido) não é
          -- tempo de resposta: vira null e a mediana o ignora.
          order by case
            when l.first_contact_at >= coalesce(l.assigned_at, l.created_at)
              then extract(epoch from (l.first_contact_at - coalesce(l.assigned_at, l.created_at))) / 60
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
  'Relatório por corretor no período: leads recebidos, atendidos, dentro do SLA, ganhos, perdidos, em aberto, tomados por estouro de prazo, mediana do primeiro contato (leads.first_contact_at, gravado uma vez), imóveis captados e propostas feitas/fechadas. Security invoker; dono e gerente recebem a equipe inteira, os demais papéis só a própria linha.';

-- 4.2 Origem do lead: "atendidos" pelo primeiro contato.
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
    count(*) filter (where l.first_contact_at is not null),
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

-- 4.3 Exportação de leads: a coluna first_contact_at passa a ser o 1º contato.
-- Mesma função de export_permissions_and_owner_privacy (com p_export_id),
-- trocando só a coluna que saía de last_contact_at.
create or replace function public.export_leads_rows(
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
    l.first_contact_at,
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

-- 4.4 Painel do rodízio: tempo médio e "no prazo" pelo 1º contato.
create or replace function public.get_lead_routing_overview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.lead_routing_settings;
  v_now timestamptz := now();
  v_weekday smallint;
  v_minute integer;
  v_day_start timestamptz;
  v_members jsonb;
  v_totals jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    raise exception 'Você não tem acesso ao rodízio desta imobiliária.' using errcode = '42501';
  end if;

  v_config := private.lead_routing_config(p_organization_id);

  select c.weekday, c.minute_of_day into v_weekday, v_minute
  from private.lead_routing_clock(v_now, v_config.time_zone) c;

  v_day_start := private.lead_routing_day_start(v_now, v_config.time_zone);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'user_id', m.user_id,
        'role', ms.role,
        'member_active', ms.active,
        'active', m.active,
        'weight', m.weight,
        'daily_limit', m.daily_limit,
        'away_from', m.away_from,
        'away_until', m.away_until,
        'away_now', private.lead_member_away(m.away_from, m.away_until, v_now),
        'on_shift', private.lead_on_shift(m.id, v_weekday, v_minute),
        'last_assigned_at', m.last_assigned_at,
        'assigned_today', stats.assigned_today,
        'open_leads', stats.open_leads,
        'overdue_leads', stats.overdue_leads,
        'avg_first_response_minutes', stats.avg_minutes,
        'shifts', coalesce(shifts.items, '[]'::jsonb)
      )
      order by ms.active desc, m.active desc, m.user_id
    ),
    '[]'::jsonb
  )
  into v_members
  from public.lead_routing_members m
  left join public.memberships ms
    on ms.organization_id = m.organization_id
   and ms.user_id = m.user_id
  cross join lateral (
    select
      (
        select count(*)::integer
        from public.lead_assignment_events e
        where e.organization_id = m.organization_id
          and e.to_user_id = m.user_id
          and e.created_at >= v_day_start
          and e.reason not in ('bulk_transfer', 'bulk_release')
      ) as assigned_today,
      (
        select count(*)::integer
        from public.leads l
        where l.organization_id = m.organization_id
          and l.assigned_to = m.user_id
          and l.stage not in ('won', 'lost')
      ) as open_leads,
      (
        select count(*)::integer
        from public.leads l
        where l.organization_id = m.organization_id
          and l.assigned_to = m.user_id
          and l.first_response_due_at is not null
          and l.first_response_due_at <= v_now
      ) as overdue_leads,
      (
        select round(avg(extract(epoch from (l.first_contact_at - l.assigned_at)) / 60)::numeric, 1)
        from public.leads l
        where l.organization_id = m.organization_id
          and l.assigned_to = m.user_id
          and l.assigned_at is not null
          and l.first_contact_at is not null
          and l.first_contact_at >= l.assigned_at
          and l.assigned_at >= v_now - interval '30 days'
      ) as avg_minutes
  ) stats
  cross join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'weekday', s.weekday,
        'start_minute', s.start_minute,
        'end_minute', s.end_minute
      )
      order by s.weekday, s.start_minute
    ) as items
    from public.lead_routing_shifts s
    where s.member_id = m.id
  ) shifts
  where m.organization_id = p_organization_id;

  select jsonb_build_object(
    'leads_today', count(*) filter (where l.created_at >= v_day_start),
    'unassigned', count(*) filter (where l.assigned_to is null and l.stage = 'new'),
    'queued', count(*) filter (where l.routing_due_at is not null),
    'overdue', count(*) filter (
      where l.first_response_due_at is not null and l.first_response_due_at <= v_now
    ),
    'reassigned_7d', count(*) filter (
      where l.sla_reassignments > 0 and l.created_at >= v_now - interval '7 days'
    ),
    'answered_in_time_7d', count(*) filter (
      where l.created_at >= v_now - interval '7 days'
        and l.assigned_at is not null
        and l.first_contact_at is not null
        and l.first_contact_at <= l.assigned_at + make_interval(mins => v_config.sla_minutes)
    ),
    'answered_7d', count(*) filter (
      where l.created_at >= v_now - interval '7 days'
        and l.first_contact_at is not null
    )
  )
  into v_totals
  from public.leads l
  where l.organization_id = p_organization_id
    and l.created_at >= v_now - interval '30 days';

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'organization_id', p_organization_id,
      'roulette_enabled', v_config.roulette_enabled,
      'respect_schedule', v_config.respect_schedule,
      'fallback_to_page_assignee', v_config.fallback_to_page_assignee,
      'sla_minutes', v_config.sla_minutes,
      'sla_reassign_enabled', v_config.sla_reassign_enabled,
      'sla_warning_percent', v_config.sla_warning_percent,
      'max_reassignments', v_config.max_reassignments,
      'time_zone', v_config.time_zone,
      'configured', exists (
        select 1 from public.lead_routing_settings s where s.organization_id = p_organization_id
      )
    ),
    'members', v_members,
    'totals', coalesce(v_totals, '{}'::jsonb),
    'now', v_now
  );
end;
$$;

-- 4.5 Métricas por etapa: "contatados" e mediana pelo 1º contato.
create or replace function public.get_lead_stage_metrics(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from timestamptz := now() - make_interval(days => v_days);
  v_stages jsonb;
  v_funnel jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    raise exception 'Você não tem acesso às métricas desta imobiliária.' using errcode = '42501';
  end if;

  with eventos as (
    select
      e.lead_id,
      e.to_stage as stage,
      e.created_at,
      lead(e.created_at) over (partition by e.lead_id order by e.created_at, e.id) as next_at
    from public.lead_stage_events e
    where e.organization_id = p_organization_id
      and e.created_at >= v_from
  ),
  agregado as (
    select
      stage,
      count(*)::integer as entered,
      count(next_at)::integer as moved_on,
      round(
        percentile_cont(0.5) within group (
          order by extract(epoch from (next_at - created_at)) / 3600
        )::numeric,
        2
      ) as median_hours,
      round(
        avg(extract(epoch from (next_at - created_at)) / 3600) filter (where next_at is not null)::numeric,
        2
      ) as avg_hours
    from eventos
    group by stage
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'stage', a.stage,
        'entered', a.entered,
        'moved_on', a.moved_on,
        'still_there', a.entered - a.moved_on,
        'median_hours', a.median_hours,
        'avg_hours', a.avg_hours
      )
      order by array_position(
        array['new', 'contacted', 'qualified', 'visit_scheduled', 'proposal', 'won', 'lost']::public.lead_stage[],
        a.stage
      )
    ),
    '[]'::jsonb
  )
  into v_stages
  from agregado a;

  select jsonb_build_object(
    'leads', count(*)::integer,
    'contacted', count(*) filter (where l.first_contact_at is not null)::integer,
    'won', count(*) filter (where l.stage = 'won')::integer,
    'lost', count(*) filter (where l.stage = 'lost')::integer,
    'open', count(*) filter (where l.stage not in ('won', 'lost'))::integer,
    'median_first_response_minutes', round(
      percentile_cont(0.5) within group (
        order by extract(epoch from (l.first_contact_at - l.assigned_at)) / 60
      )::numeric,
      1
    )
  )
  into v_funnel
  from public.leads l
  where l.organization_id = p_organization_id
    and l.created_at >= v_from;

  return jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'stages', v_stages,
    'totals', coalesce(v_funnel, '{}'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Fila de avisos: aviso à gestão quando o prazo estoura sem redistribuição
-- -----------------------------------------------------------------------------
alter table private.lead_notifications
  drop constraint if exists lead_notifications_kind_check;
alter table private.lead_notifications
  add constraint lead_notifications_kind_check
  check (kind in ('assigned', 'sla_warning', 'sla_reassigned', 'sla_lost', 'sla_breached'));

comment on table private.lead_notifications is
  'Fila de avisos de lead por e-mail: lead novo (assigned), prazo acabando (sla_warning), lead redistribuído (sla_reassigned/sla_lost) e prazo estourado sem redistribuição, para a gestão (sla_breached). Drenada por public.claim_lead_notifications; registros enviados com mais de 7 dias são apagados pela passada agendada.';

-- Dono e gerentes ativos com e-mail confirmado (menos o próprio responsável),
-- um aviso por pessoa. Devolve quantos avisos entraram na fila.
create or replace function private.enqueue_lead_sla_breach_notice(p_lead_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  insert into private.lead_notifications (
    organization_id, lead_id, user_id, kind, round, due_at
  )
  select l.organization_id, l.id, g.user_id, 'sla_breached', l.sla_reassignments,
         l.first_response_due_at
  from public.leads l
  cross join lateral (
    select m.user_id
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = l.organization_id
      and m.active
      and m.role in ('owner', 'manager')
      and m.user_id is distinct from l.assigned_to
      and u.email is not null
      and u.email_confirmed_at is not null
    order by array_position(array['owner', 'manager']::public.app_role[], m.role), m.user_id
    limit 20
  ) g
  where l.id = p_lead_id
  on conflict (lead_id, user_id, kind, round) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function private.enqueue_lead_sla_breach_notice(uuid) is
  'Enfileira o aviso sla_breached para dono e gerentes (exceto o responsável): o prazo do primeiro contato estourou e o lead continuou com o responsável porque não havia outro corretor elegível ou ele já esgotou as redistribuições.';

revoke all on function private.enqueue_lead_sla_breach_notice(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Passada agendada: o lead nunca fica sem dono por estouro do prazo
-- -----------------------------------------------------------------------------
create or replace function private.run_lead_routing_pass(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_assigned integer := 0;
  v_queued integer := 0;
  v_warned integer := 0;
  v_reassigned integer := 0;
  v_released integer := 0;
  v_kept integer := 0;
  v_result jsonb;
  rec record;
begin
  -- (a) Leads que estavam esperando a próxima janela de plantão.
  for rec in
    select l.id
    from public.leads l
    join public.lead_routing_settings s on s.organization_id = l.organization_id
    where s.roulette_enabled
      and l.assigned_to is null
      and l.stage = 'new'
      and l.routing_due_at is not null
      and l.routing_due_at <= v_now
    order by l.routing_due_at
    limit v_limit
  loop
    v_result := private.route_lead(rec.id, 'roulette', true, '{}'::uuid[]);

    if (v_result ->> 'assigned_to') is not null then
      v_assigned := v_assigned + 1;
    else
      v_queued := v_queued + 1;
    end if;
  end loop;

  -- (b) Aviso de prazo perto de estourar (um por atribuição).
  for rec in
    select l.id, l.assigned_to, l.first_response_due_at, l.sla_reassignments
    from public.leads l
    join public.lead_routing_settings s on s.organization_id = l.organization_id
    where l.stage = 'new'
      and l.first_contact_at is null
      and l.assigned_to is not null
      and l.sla_warned_at is null
      and l.first_response_due_at is not null
      and l.first_response_due_at > v_now
      and l.assigned_at is not null
      and v_now >= l.assigned_at
        + (l.first_response_due_at - l.assigned_at) * (s.sla_warning_percent::numeric / 100)
    order by l.first_response_due_at
    limit v_limit
  loop
    update public.leads
    set sla_warned_at = v_now
    where id = rec.id
      and sla_warned_at is null;

    if found then
      perform private.enqueue_lead_notification(
        rec.id, rec.assigned_to, 'sla_warning', rec.sla_reassignments, rec.first_response_due_at
      );
      v_warned := v_warned + 1;
    end if;
  end loop;

  -- (c) Prazo estourado: devolve para a roleta e entrega ao próximo corretor.
  --     Sem outro corretor que possa receber AGORA (único da fila, os demais
  --     fora do plantão, de férias ou no limite do dia) ou com as redistribuições
  --     esgotadas, o lead NÃO fica sem dono: continua com o responsável, o
  --     estouro vai para sla_breached_at e a gestão recebe o aviso sla_breached
  --     (uma vez por atribuição — por isso sla_breached_at sai da varredura).
  for rec in
    select l.id, l.organization_id, l.assigned_to, l.sla_reassignments,
           l.first_response_due_at, s.max_reassignments
    from public.leads l
    join public.lead_routing_settings s on s.organization_id = l.organization_id
    where s.roulette_enabled
      and s.sla_reassign_enabled
      and l.stage = 'new'
      and l.first_contact_at is null
      and l.assigned_to is not null
      and l.sla_breached_at is null
      and l.first_response_due_at is not null
      and l.first_response_due_at <= v_now
    order by l.first_response_due_at
    limit v_limit
  loop
    if rec.sla_reassignments >= rec.max_reassignments
       or private.lead_routing_pick(rec.organization_id, v_now, array[rec.assigned_to]) is null then
      update public.leads
      set sla_breached_at = v_now
      where id = rec.id
        and sla_breached_at is null;

      if found then
        perform private.enqueue_lead_sla_breach_notice(rec.id);
        v_kept := v_kept + 1;
      end if;

      continue;
    end if;

    -- Avisa quem perdeu o lead antes de trocar o responsável.
    perform private.enqueue_lead_notification(
      rec.id, rec.assigned_to, 'sla_lost', rec.sla_reassignments, rec.first_response_due_at
    );

    update public.leads
    set sla_reassignments = sla_reassignments + 1
    where id = rec.id;

    v_result := private.route_lead(rec.id, 'sla_reassign', true, array[rec.assigned_to]);

    if (v_result ->> 'assigned_to') is not null then
      v_reassigned := v_reassigned + 1;
    else
      v_released := v_released + 1;
    end if;
  end loop;

  -- (d) Limpeza: avisos já enviados há mais de 7 dias.
  delete from private.lead_notifications n
  where n.sent_at is not null
    and n.sent_at < v_now - interval '7 days';

  -- (e) Avisos presos (reivindicados e não confirmados) voltam para a fila.
  update private.lead_notifications n
  set claimed_at = null
  where n.sent_at is null
    and n.claimed_at is not null
    and n.claimed_at < v_now - interval '15 minutes'
    and n.attempts < 5;

  return jsonb_build_object(
    'assigned', v_assigned,
    'queued', v_queued,
    'warned', v_warned,
    'reassigned', v_reassigned,
    'released', v_released,
    'kept', v_kept
  );
end;
$$;

comment on function private.run_lead_routing_pass(integer) is
  'Rotina agendada (pg_cron, job rodizio-de-leads, a cada minuto): entrega os leads que esperavam a próxima janela de plantão, avisa quem está perto de estourar o prazo de primeiro contato e redistribui os que estouraram. Sem outro corretor elegível (ou com as redistribuições esgotadas) o lead fica com o responsável, sla_breached_at é gravado e a gestão é avisada (kept). Devolve as contagens da passada.';

revoke all on function private.run_lead_routing_pass(integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. route_lead: fila vazia não tira o lead de quem já está com ele
-- -----------------------------------------------------------------------------
-- Antes, "Distribuir pela roleta" num lead do único corretor da fila devolvia
-- "Nenhum corretor na fila" E deixava o lead sem responsável. Agora só a
-- devolução em massa (bulk_release/member_removed, o corretor está saindo)
-- solta o lead; nos outros casos o responsável atual continua.
create or replace function private.route_lead(
  p_lead_id uuid,
  p_reason text default 'roulette',
  p_notify boolean default true,
  p_exclude uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_user uuid;
  v_next timestamptz;
  v_now timestamptz := now();
begin
  select l.id, l.organization_id, l.assigned_to, l.sla_reassignments, l.first_response_due_at
    into v_lead
  from public.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_user := private.lead_routing_pick(v_lead.organization_id, v_now, p_exclude);

  perform set_config('app.lead_event_reason', coalesce(p_reason, 'roulette'), true);

  if v_user is not null then
    update public.leads
    set assigned_to = v_user,
        routing_due_at = null
    where id = p_lead_id;

    if p_notify then
      perform private.enqueue_lead_notification(
        p_lead_id,
        v_user,
        case when coalesce(p_reason, '') = 'sla_reassign' then 'sla_reassigned' else 'assigned' end,
        v_lead.sla_reassignments,
        (select l.first_response_due_at from public.leads l where l.id = p_lead_id)
      );
    end if;

    perform set_config('app.lead_event_reason', '', true);

    return jsonb_build_object('ok', true, 'assigned_to', v_user, 'queued_until', null);
  end if;

  -- Ninguém na fila (nem mais tarde): o lead fica com quem já está, a não ser
  -- que o pedido seja justamente soltar os leads de quem está saindo.
  if not private.lead_routing_has_queue(v_lead.organization_id, v_now, p_exclude) then
    update public.leads
    set assigned_to = case
          when coalesce(p_reason, '') in ('bulk_release', 'member_removed') then null
          else assigned_to
        end,
        routing_due_at = null
    where id = p_lead_id;

    perform set_config('app.lead_event_reason', '', true);

    return jsonb_build_object('ok', false, 'reason', 'empty_queue', 'assigned_to', null);
  end if;

  v_next := coalesce(
    private.lead_routing_next_window(v_lead.organization_id, v_now, p_exclude),
    v_now + interval '15 minutes'
  );

  update public.leads
  set assigned_to = null,
      routing_due_at = v_next
  where id = p_lead_id;

  perform set_config('app.lead_event_reason', '', true);

  return jsonb_build_object('ok', true, 'assigned_to', null, 'queued_until', v_next);
end;
$$;

revoke all on function private.route_lead(uuid, text, boolean, uuid[]) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Lead novo sem sessão sempre entra na fila de avisos
-- -----------------------------------------------------------------------------
-- Landing page, página pública do imóvel, Grupo OLX e Meta Lead Ads gravam o
-- lead sem usuário logado (RPC com chave do servidor). Antes, só o rodízio
-- (route_lead) enfileirava o aviso; o lead que entrava direto no INSERT — com o
-- rodízio desligado ou entregue pela roleta no próprio INSERT — não avisava
-- ninguém pela fila. Agora vai um aviso "assigned" para o responsável ou, sem
-- responsável (ou sem e-mail confirmado), para o dono/gerente: o e-mail
-- new_lead já resolve os destinatários do mesmo jeito
-- (private.notification_recipients). Quem cadastra lead pela tela, com sessão,
-- continua avisado pelo app (apps/web/lib/leads/actions.ts).
create or replace function private.enqueue_new_lead_notice(p_lead_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_user uuid;
begin
  select l.id, l.organization_id, l.assigned_to, l.sla_reassignments, l.first_response_due_at
    into v_lead
  from public.leads l
  where l.id = p_lead_id;

  if not found then
    return false;
  end if;

  -- O rodízio já avisou alguém deste lead nesta rodada: não duplica.
  if exists (
    select 1
    from private.lead_notifications n
    where n.lead_id = p_lead_id
      and n.kind in ('assigned', 'sla_reassigned')
      and n.round = v_lead.sla_reassignments
  ) then
    return false;
  end if;

  select m.user_id
    into v_user
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.organization_id = v_lead.organization_id
    and m.active
    and u.email is not null
    and u.email_confirmed_at is not null
    and (m.user_id = v_lead.assigned_to or m.role in ('owner', 'manager'))
  order by
    coalesce(m.user_id = v_lead.assigned_to, false) desc,
    array_position(array['owner', 'manager']::public.app_role[], m.role),
    m.user_id
  limit 1;

  if v_user is null then
    return false;
  end if;

  perform private.enqueue_lead_notification(
    p_lead_id, v_user, 'assigned', v_lead.sla_reassignments, v_lead.first_response_due_at
  );

  return exists (
    select 1
    from private.lead_notifications n
    where n.lead_id = p_lead_id
      and n.user_id = v_user
      and n.kind = 'assigned'
      and n.round = v_lead.sla_reassignments
  );
end;
$$;

comment on function private.enqueue_new_lead_notice(uuid) is
  'Enfileira UM aviso de lead novo (kind assigned) para o responsável ou, sem ele, para o dono/gerente. Não enfileira quando o rodízio já avisou alguém na mesma rodada. Devolve true quando o aviso está na fila.';

revoke all on function private.enqueue_new_lead_notice(uuid) from public, anon, authenticated;

create or replace function private.leads_enqueue_new_lead_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Com sessão (cadastro pela tela), quem avisa é o app.
  if (select auth.uid()) is not null then
    return null;
  end if;

  if private.enqueue_new_lead_notice(new.id) then
    -- Com os segredos do webhook no Vault, o servidor drena a fila na hora;
    -- sem eles, a passada de cada minuto e o cron diário cuidam do envio.
    perform private.ping_lead_alerts_webhook();
  end if;

  return null;
end;
$$;

comment on function private.leads_enqueue_new_lead_notice() is
  'Trigger AFTER INSERT em public.leads: lead gravado sem sessão (landing page, página do imóvel, portal, Meta Lead Ads) enfileira o aviso de lead novo em private.lead_notifications, com ou sem rodízio.';

revoke all on function private.leads_enqueue_new_lead_notice() from public, anon, authenticated;

drop trigger if exists leads_enqueue_new_lead_notice on public.leads;
create trigger leads_enqueue_new_lead_notice
  after insert on public.leads
  for each row execute function private.leads_enqueue_new_lead_notice();
