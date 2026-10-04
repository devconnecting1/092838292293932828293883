-- =============================================================================
-- 1720 - Painel: agregações dos gráficos (leads por semana, funil e imóveis)
-- =============================================================================
--  1. Índice (organization_id, created_at desc) em leads
--  2. RPC dashboard_leads_by_week: leads por semana (fuso de Brasília) e origem
--  3. RPC dashboard_leads_by_stage: leads por etapa do funil no período
--  4. RPC dashboard_properties_by_status: imóveis por status, com o valor somado
--
-- As três são `security invoker` (o padrão): quem manda no resultado é o RLS de
-- `leads` e de `properties`, então um corretor só soma os leads que ele vê e um
-- id de outra imobiliária devolve zero linhas. Elas existem só para a contagem
-- acontecer no Postgres, em vez de o app baixar todas as linhas para contar.

-- -----------------------------------------------------------------------------
-- 1. Índice
-- -----------------------------------------------------------------------------
-- Recorte por imobiliária + janela de tempo (usado pelos dois gráficos de leads).
create index if not exists leads_organization_created_at_idx
  on public.leads (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 2. dashboard_leads_by_week
-- -----------------------------------------------------------------------------
-- Uma linha por (semana, origem). A semana começa na segunda-feira no fuso de
-- Brasília. p_weeks fica entre 4 e 26 (padrão 12) e inclui a semana atual.
-- Semanas sem lead não voltam: o app completa a série com zero.
create or replace function public.dashboard_leads_by_week(
  p_organization_id uuid,
  p_weeks integer default 12
)
returns table (week_start date, source public.lead_source, total bigint)
language sql
stable
set search_path = ''
as $$
  select
    (date_trunc('week', l.created_at at time zone 'America/Sao_Paulo'))::date,
    l.source,
    count(*)
  from public.leads l
  where l.organization_id = p_organization_id
    and l.created_at >= (
      date_trunc('week', (now() at time zone 'America/Sao_Paulo'))
        - make_interval(weeks => least(greatest(coalesce(p_weeks, 12), 4), 26) - 1)
    ) at time zone 'America/Sao_Paulo'
  group by 1, 2;
$$;

comment on function public.dashboard_leads_by_week(uuid, integer) is
  'Painel: leads por semana (segunda a domingo, fuso de Brasília) e origem, nas últimas p_weeks semanas (4 a 26, padrão 12). Security invoker: respeita o RLS de leads.';

revoke all on function public.dashboard_leads_by_week(uuid, integer) from public, anon;
grant execute on function public.dashboard_leads_by_week(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. dashboard_leads_by_stage
-- -----------------------------------------------------------------------------
-- Uma linha por etapa atual do funil, contando os leads criados nos últimos
-- p_days dias (entre 7 e 365, padrão 90). Etapas sem lead não voltam.
create or replace function public.dashboard_leads_by_stage(
  p_organization_id uuid,
  p_days integer default 90
)
returns table (stage public.lead_stage, total bigint)
language sql
stable
set search_path = ''
as $$
  select l.stage, count(*)
  from public.leads l
  where l.organization_id = p_organization_id
    and l.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 90), 7), 365))
  group by l.stage;
$$;

comment on function public.dashboard_leads_by_stage(uuid, integer) is
  'Painel: leads por etapa atual do funil, entre os criados nos últimos p_days dias (7 a 365, padrão 90). Security invoker: respeita o RLS de leads.';

revoke all on function public.dashboard_leads_by_stage(uuid, integer) from public, anon;
grant execute on function public.dashboard_leads_by_stage(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. dashboard_properties_by_status
-- -----------------------------------------------------------------------------
-- Uma linha por status, com a quantidade e o valor somado da carteira: venda
-- (imóveis de venda e venda/locação) e locação (locação e venda/locação).
create or replace function public.dashboard_properties_by_status(p_organization_id uuid)
returns table (status public.property_status, total bigint, sale_value numeric, rent_value numeric)
language sql
stable
set search_path = ''
as $$
  select
    p.status,
    count(*),
    coalesce(sum(p.sale_price) filter (where p.purpose in ('sale', 'sale_rent')), 0),
    coalesce(sum(p.rent_price) filter (where p.purpose in ('rent', 'sale_rent')), 0)
  from public.properties p
  where p.organization_id = p_organization_id
  group by p.status;
$$;

comment on function public.dashboard_properties_by_status(uuid) is
  'Painel: imóveis por status, com a quantidade e a soma de sale_price/rent_price da carteira. Security invoker: respeita o RLS de properties.';

revoke all on function public.dashboard_properties_by_status(uuid) from public, anon;
grant execute on function public.dashboard_properties_by_status(uuid) to authenticated;
