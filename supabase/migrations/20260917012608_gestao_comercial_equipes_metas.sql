-- =============================================================================
-- Gestão comercial: equipes, metas, previsão de vendas e custo por lead
-- =============================================================================
--  1. Equipes (public.teams e public.team_members)
--  2. Recorte dos relatórios: dono/gerente, líder de equipe e demais papéis
--  3. Relatórios com filtro de equipe e venda/locação separadas
--  4. Exportação dos relatórios agregados com a equipe no registro
--  5. Metas mensais por corretor e por equipe (public.sales_goals)
--  6. Previsão de vendas: probabilidade por etapa e data prevista na proposta
--  7. Investimento em marketing e custo por lead (public.marketing_investments;
--     a tabela nasce no item 3.3, antes do relatório de origens que a lê)
--  8. Grants
--
-- Por que os relatórios passam a ser `security definer` (no schema private,
-- chamados por wrappers `security invoker` no public): o líder de uma equipe
-- costuma ser corretor, e o RLS de `leads` mostra ao corretor só os leads dele.
-- Para o líder somar a própria equipe sem ganhar acesso à LISTA de leads dos
-- colegas (telefone, e-mail), a conta sai de uma função que enxerga a tabela
-- inteira e aplica o recorte explicitamente em `private.report_member_scope`:
--   - dono e gerente: a imobiliária inteira, ou a equipe/corretor escolhido;
--   - líder: só os membros das equipes que lidera (e ele mesmo) — mandar o id de
--     outra equipe ou de outro corretor no parâmetro não amplia nada;
--   - qualquer outro papel: só o próprio número, como antes.
-- Essas funções devolvem SÓ agregados (contagens, somas, nomes de membro e de
-- equipe). A exportação da base (leads, clientes, imóveis, propostas) continua
-- `security invoker` e presa ao RLS.
--
-- Definições (repetidas na tela e no supabase/README.md):
--   - "Valor fechado" separa venda (`proposals.purpose = 'sale'`) de locação
--     (`'rent'`); o total antigo continua na RPC só por compatibilidade.
--   - Meta "leads atendidos" = coluna "Atendidos" de Por corretor no mês;
--     "visitas" = agenda com status "realizada" no mês; "propostas" = propostas
--     criadas no mês; "vendas"/"locações" = propostas aceitas no mês.
--   - Previsão: propostas em aberto (rascunho, enviada, contraproposta) com a
--     data prevista de fechamento no mês, valor × probabilidade da etapa; as
--     aceitas no mês entram como "comprometido" (100%).
--   - Custo por lead: investimento do mês por canal (+ campanha opcional),
--     proporcional aos dias do período. Campanha com investimento próprio casa
--     com `leads.utm ->> 'campaign'` (sem diferença de maiúsculas); o restante
--     do canal fica com o investimento lançado sem campanha. O valor é dividido
--     entre as linhas do relatório pela quantidade de leads.

-- -----------------------------------------------------------------------------
-- 1. Equipes
-- -----------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null
    constraint teams_name_length check (char_length(btrim(name)) between 1 and 80),
  leader_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_organization_id_id_key unique (organization_id, id),
  constraint teams_leader_fkey foreign key (leader_id, organization_id)
    references public.memberships (user_id, organization_id) on delete set null (leader_id)
);

create unique index teams_organization_name_key
  on public.teams (organization_id, lower(btrim(name)));
create index teams_leader_idx
  on public.teams (leader_id, organization_id)
  where leader_id is not null;
create index teams_created_by_idx on public.teams (created_by);

comment on table public.teams is
  'Equipes comerciais da imobiliária (ex.: "Equipe Zona Sul"). Cada membro fica em no máximo uma equipe (public.team_members). O líder vê os relatórios só das equipes que lidera.';
comment on column public.teams.leader_id is
  'Líder da equipe (membro da imobiliária). Ao ser escolhido, entra na equipe se ainda não estiver em nenhuma.';

create table public.team_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  team_id uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_members_pkey primary key (organization_id, user_id),
  constraint team_members_membership_fkey foreign key (user_id, organization_id)
    references public.memberships (user_id, organization_id) on delete cascade,
  constraint team_members_team_fkey foreign key (organization_id, team_id)
    references public.teams (organization_id, id) on delete cascade
);

create index team_members_team_idx on public.team_members (organization_id, team_id);
create index team_members_user_idx on public.team_members (user_id, organization_id);
create index team_members_created_by_idx on public.team_members (created_by);

comment on table public.team_members is
  'Em que equipe cada membro está. A chave (organization_id, user_id) garante uma equipe por pessoa; mover alguém é trocar o team_id.';

create trigger a0_billing_writable before insert or update on public.teams
  for each row execute function private.assert_billing_writable();
create trigger teams_set_updated_at before update on public.teams
  for each row execute function private.set_updated_at();
create trigger teams_enforce_author before insert or update of created_by on public.teams
  for each row execute function private.enforce_author_column('created_by');
create trigger teams_validate_members before insert or update of leader_id on public.teams
  for each row execute function private.validate_member_columns('leader_id', 'O líder da equipe');
create trigger teams_audit after insert or update or delete on public.teams
  for each row execute function private.audit_row_change();

create trigger a0_billing_writable before insert or update on public.team_members
  for each row execute function private.assert_billing_writable();
create trigger team_members_set_updated_at before update on public.team_members
  for each row execute function private.set_updated_at();
create trigger team_members_enforce_author before insert or update of created_by on public.team_members
  for each row execute function private.enforce_author_column('created_by');
create trigger team_members_audit after insert or update or delete on public.team_members
  for each row execute function private.audit_row_change();

-- O líder entra na equipe que lidera (se ainda não estiver em outra): assim o
-- número dele soma no subtotal da equipe sem um passo a mais na tela.
create or replace function private.teams_add_leader_as_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.leader_id is not null
     and (tg_op = 'INSERT' or new.leader_id is distinct from old.leader_id) then
    insert into public.team_members (organization_id, user_id, team_id, created_by)
    values (new.organization_id, new.leader_id, new.id, (select auth.uid()))
    on conflict (organization_id, user_id) do nothing;
  end if;

  return null;
end;
$$;

comment on function private.teams_add_leader_as_member() is
  'Depois de criar a equipe ou trocar o líder: coloca o líder na equipe quando ele ainda não está em nenhuma.';

create trigger teams_add_leader_as_member after insert or update of leader_id on public.teams
  for each row execute function private.teams_add_leader_as_member();

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

-- Nome da equipe e quem está nela não são dado sensível: todo membro lê (a tela
-- de relatórios e o filtro precisam). Só dono e gerente montam as equipes.
create policy "teams: membros leem" on public.teams
  for select to authenticated
  using (private.is_member(organization_id));
create policy "teams: dono e gerente criam" on public.teams
  for insert to authenticated
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "teams: dono e gerente alteram" on public.teams
  for update to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]))
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "teams: dono e gerente removem" on public.teams
  for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));

create policy "team_members: membros leem" on public.team_members
  for select to authenticated
  using (private.is_member(organization_id));
create policy "team_members: dono e gerente incluem" on public.team_members
  for insert to authenticated
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "team_members: dono e gerente movem" on public.team_members
  for update to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]))
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "team_members: dono e gerente retiram" on public.team_members
  for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));

-- -----------------------------------------------------------------------------
-- 2. Recorte dos relatórios
-- -----------------------------------------------------------------------------
-- Equipes que o usuário da sessão lidera nesta imobiliária (vazio se nenhuma).
create or replace function private.report_led_team_ids(p_organization_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id order by t.id), '{}'::uuid[])
  from public.teams t
  where t.organization_id = p_organization_id
    and t.leader_id = (select auth.uid())
    and private.is_member(p_organization_id);
$$;

comment on function private.report_led_team_ids(uuid) is
  'Ids das equipes que o usuário da sessão lidera na imobiliária (membro ativo). Vazio quando não lidera nenhuma.';

-- Quem entra na conta do relatório. `null` = a imobiliária inteira (só dono e
-- gerente sem filtro); array vazio = ninguém.
create or replace function private.report_member_scope(
  p_organization_id uuid,
  p_user_id uuid default null,
  p_team_id uuid default null
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me constant uuid := (select auth.uid());
  v_led uuid[];
  v_allowed uuid[];
  v_scope uuid[];
begin
  if v_me is null or not private.is_member(p_organization_id) then
    return '{}'::uuid[];
  end if;

  if private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) then
    if p_team_id is not null then
      select coalesce(array_agg(tm.user_id), '{}'::uuid[])
        into v_scope
      from public.team_members tm
      where tm.organization_id = p_organization_id
        and tm.team_id = p_team_id;
    end if;

    if p_user_id is not null then
      v_scope := case
        when v_scope is null or p_user_id = any (v_scope) then array[p_user_id]
        else '{}'::uuid[]
      end;
    end if;

    return v_scope;
  end if;

  v_led := private.report_led_team_ids(p_organization_id);

  -- Sem equipe para liderar: só o próprio número, qualquer que seja o parâmetro.
  if cardinality(v_led) = 0 then
    return array[v_me];
  end if;

  -- O teto do líder: os membros das equipes que lidera, e ele mesmo.
  select array_agg(distinct x.user_id)
    into v_allowed
  from (
    select tm.user_id
    from public.team_members tm
    where tm.organization_id = p_organization_id
      and tm.team_id = any (v_led)
    union all
    select v_me
  ) x;

  -- Equipe que ele não lidera é ignorada (não vira "ninguém" nem "todos").
  if p_team_id is not null and p_team_id = any (v_led) then
    select coalesce(array_agg(tm.user_id), '{}'::uuid[])
      into v_scope
    from public.team_members tm
    where tm.organization_id = p_organization_id
      and tm.team_id = p_team_id;
  else
    v_scope := v_allowed;
  end if;

  -- Corretor fora do teto também é ignorado.
  if p_user_id is not null and p_user_id = any (v_allowed) then
    v_scope := case when p_user_id = any (v_scope) then array[p_user_id] else '{}'::uuid[] end;
  end if;

  return v_scope;
end;
$$;

comment on function private.report_member_scope(uuid, uuid, uuid) is
  'Membros que entram num relatório. Dono e gerente: null (todos) ou o recorte de equipe/corretor pedido. Líder: os membros das equipes que lidera e ele mesmo; equipe ou corretor fora disso são ignorados. Demais papéis: só o próprio usuário. Não membro: vazio.';

-- Equipes que aparecem como linha nos relatórios de metas. `null` = todas.
create or replace function private.report_team_scope(
  p_organization_id uuid,
  p_team_id uuid default null
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_led uuid[];
begin
  if (select auth.uid()) is null or not private.is_member(p_organization_id) then
    return '{}'::uuid[];
  end if;

  if private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) then
    return case when p_team_id is null then null else array[p_team_id] end;
  end if;

  v_led := private.report_led_team_ids(p_organization_id);

  if p_team_id is not null and p_team_id = any (v_led) then
    return array[p_team_id];
  end if;

  return v_led;
end;
$$;

comment on function private.report_team_scope(uuid, uuid) is
  'Equipes visíveis como linha de relatório: dono e gerente todas (ou a escolhida); líder as que lidera; demais papéis nenhuma.';

-- -----------------------------------------------------------------------------
-- 3. Relatórios
-- -----------------------------------------------------------------------------

-- 3.1 Desempenho por corretor -------------------------------------------------
create or replace function private.report_broker_performance(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid,
  p_team_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  member_role public.app_role,
  member_active boolean,
  team_id uuid,
  team_name text,
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
  proposals_closed_amount numeric,
  sales_closed bigint,
  sales_closed_amount numeric,
  rentals_closed bigint,
  rentals_closed_amount numeric
)
language sql
stable
security definer
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
      private.report_member_scope(p_organization_id, p_user_id, p_team_id) as membros
    from private.report_window(p_from, p_to) w
  ),
  equipe as (
    select m.user_id, m.role, m.active
    from public.memberships m
    cross join janela j
    where m.organization_id = p_organization_id
      and (j.membros is null or m.user_id = any (j.membros))
  )
  select
    e.user_id,
    coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Membro sem nome'),
    e.role,
    e.active,
    t.id,
    t.name,
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
    propostas.valor_vendas + propostas.valor_locacoes,
    propostas.vendas,
    propostas.valor_vendas,
    propostas.locacoes,
    propostas.valor_locacoes
  from equipe e
  cross join janela j
  left join public.profiles pr on pr.id = e.user_id
  left join public.team_members tm
    on tm.organization_id = p_organization_id and tm.user_id = e.user_id
  left join public.teams t
    on t.organization_id = tm.organization_id and t.id = tm.team_id
  cross join lateral (
    -- Primeiro contato (first_contact_at, gravado uma vez).
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
    select count(*) as total
    from public.leads l
    where l.organization_id = p_organization_id
      and l.assigned_to = e.user_id
      and l.stage not in ('won', 'lost')
  ) abertos
  cross join lateral (
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
      count(*) filter (
        where p.status = 'accepted' and p.decided_at >= j.inicio and p.decided_at < j.fim
          and p.purpose = 'sale'
      ) as vendas,
      coalesce(
        sum(p.amount) filter (
          where p.status = 'accepted' and p.decided_at >= j.inicio and p.decided_at < j.fim
            and p.purpose = 'sale'
        ),
        0
      ) as valor_vendas,
      count(*) filter (
        where p.status = 'accepted' and p.decided_at >= j.inicio and p.decided_at < j.fim
          and p.purpose = 'rent'
      ) as locacoes,
      coalesce(
        sum(p.amount) filter (
          where p.status = 'accepted' and p.decided_at >= j.inicio and p.decided_at < j.fim
            and p.purpose = 'rent'
        ),
        0
      ) as valor_locacoes
    from public.proposals p
    where p.organization_id = p_organization_id
      and p.broker_id = e.user_id
      and (
        (p.created_at >= j.inicio and p.created_at < j.fim)
        or (p.decided_at >= j.inicio and p.decided_at < j.fim)
      )
  ) propostas
  -- Ordinais das colunas de saída: ganhos, depois recebidos, depois o nome.
  order by 10 desc, 7 desc, 2;
$$;

comment on function private.report_broker_performance(uuid, timestamptz, timestamptz, uuid, uuid) is
  'Desempenho por corretor com equipe e valor fechado separado em venda e locação. Security definer: o recorte vem de private.report_member_scope (dono/gerente, líder da equipe ou o próprio usuário).';

-- Assinatura antiga mantida (mesmas colunas), agora com o recorte do líder.
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
  select
    r.user_id,
    r.full_name,
    r.member_role,
    r.member_active,
    r.leads_received,
    r.leads_answered,
    r.leads_in_sla,
    r.leads_won,
    r.leads_lost,
    r.leads_open,
    r.leads_taken_by_sla,
    r.first_response_median_minutes,
    r.properties_captured,
    r.proposals_made,
    r.proposals_closed,
    r.proposals_closed_amount
  from private.report_broker_performance(p_organization_id, p_from, p_to, null, null) r
  order by r.leads_won desc, r.leads_received desc, r.full_name;
$$;

comment on function public.report_broker_performance(uuid, timestamptz, timestamptz) is
  'Relatório por corretor no período (assinatura original). Dono e gerente recebem a imobiliária inteira; o líder, as equipes que lidera; os demais papéis, só a própria linha. A tela usa report_broker_performance_by_team.';

create or replace function public.report_broker_performance_by_team(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_team_id uuid default null
)
returns table (
  user_id uuid,
  full_name text,
  member_role public.app_role,
  member_active boolean,
  team_id uuid,
  team_name text,
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
  proposals_closed_amount numeric,
  sales_closed bigint,
  sales_closed_amount numeric,
  rentals_closed bigint,
  rentals_closed_amount numeric
)
language sql
stable
set search_path = ''
as $$
  select r.*
  from private.report_broker_performance(p_organization_id, p_from, p_to, p_user_id, p_team_id) r
  order by r.leads_won desc, r.leads_received desc, r.full_name;
$$;

comment on function public.report_broker_performance_by_team(uuid, timestamptz, timestamptz, uuid, uuid) is
  'Relatório por corretor com filtro de equipe e de corretor, a equipe de cada linha e o valor fechado separado em venda (sales_*) e locação (rentals_*). O recorte por papel e por liderança é aplicado no banco.';

-- 3.2 Funil por etapa ---------------------------------------------------------
drop function public.report_stage_funnel(uuid, timestamptz, timestamptz, uuid);

create or replace function private.report_stage_funnel(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid,
  p_team_id uuid
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
security definer
set search_path = ''
as $$
  with janela as (
    select
      w.inicio,
      w.fim,
      private.report_member_scope(p_organization_id, p_user_id, p_team_id) as membros
    from private.report_window(p_from, p_to) w
  ),
  eventos as (
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
      and (j.membros is null or l.assigned_to = any (j.membros))
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

comment on function private.report_stage_funnel(uuid, timestamptz, timestamptz, uuid, uuid) is
  'Funil por etapa (lead_stage_events) no recorte de private.report_member_scope.';

create function public.report_stage_funnel(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_team_id uuid default null
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
  select f.* from private.report_stage_funnel(p_organization_id, p_from, p_to, p_user_id, p_team_id) f;
$$;

comment on function public.report_stage_funnel(uuid, timestamptz, timestamptz, uuid, uuid) is
  'Funil por etapa a partir de public.lead_stage_events: entradas, avanços, perdas, quantos continuam na etapa e o tempo na fase. p_user_id e p_team_id respeitam o papel: dono e gerente escolhem, o líder só dentro das equipes que lidera, os demais papéis veem só o próprio funil.';

-- 3.3 Origem do lead, com investimento ----------------------------------------
drop function public.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer);

-- -----------------------------------------------------------------------------
-- 7 (antecipado). Investimento em marketing — a tabela precisa existir antes do
-- relatório de origens que a lê.
-- -----------------------------------------------------------------------------
create table public.marketing_investments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  month date not null
    constraint marketing_investments_month_check
      check (extract(day from month) = 1 and month >= date '2000-01-01' and month < date '2100-01-01'),
  source public.lead_source not null,
  utm_campaign text
    constraint marketing_investments_campaign_check
      check (utm_campaign is null or (char_length(utm_campaign) between 1 and 200 and utm_campaign = btrim(utm_campaign))),
  amount numeric(14, 2) not null
    constraint marketing_investments_amount_check check (amount >= 0),
  notes text
    constraint marketing_investments_notes_check check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index marketing_investments_key
  on public.marketing_investments (organization_id, month, source, (lower(coalesce(utm_campaign, ''))));
create index marketing_investments_created_by_idx on public.marketing_investments (created_by);
create index marketing_investments_updated_by_idx on public.marketing_investments (updated_by);

comment on table public.marketing_investments is
  'Quanto a imobiliária investiu em marketing por mês, canal (lead_source) e, opcionalmente, campanha (utm_campaign). Base do custo por lead e do custo por ganho em /relatorios (aba Origem do lead). Dono e gerente lançam; financeiro lê.';
comment on column public.marketing_investments.utm_campaign is
  'Campanha como chega em leads.utm ->> ''campaign'' (sem diferença de maiúsculas). Vazio = investimento do canal inteiro, que cobre os leads do canal sem campanha com investimento próprio.';

-- Normaliza antes das checagens: mês no dia 1, campanha e observação aparadas.
create or replace function private.marketing_investments_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.month := date_trunc('month', new.month)::date;
  new.utm_campaign := nullif(btrim(new.utm_campaign), '');
  new.notes := nullif(btrim(new.notes), '');

  if (select auth.uid()) is not null then
    new.updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function private.marketing_investments_normalize() is
  'Antes de gravar investimento: mês no primeiro dia, campanha e observação sem espaços nas pontas (vazio vira null) e quem alterou por último.';

create trigger a0_billing_writable before insert or update on public.marketing_investments
  for each row execute function private.assert_billing_writable();
create trigger marketing_investments_normalize before insert or update on public.marketing_investments
  for each row execute function private.marketing_investments_normalize();
create trigger marketing_investments_set_updated_at before update on public.marketing_investments
  for each row execute function private.set_updated_at();
create trigger marketing_investments_enforce_author
  before insert or update of created_by on public.marketing_investments
  for each row execute function private.enforce_author_column('created_by');
create trigger marketing_investments_audit after insert or update or delete on public.marketing_investments
  for each row execute function private.audit_row_change();

alter table public.marketing_investments enable row level security;

create policy "marketing_investments: gestão e financeiro leem" on public.marketing_investments
  for select to authenticated
  using (private.has_role(organization_id, '{owner,manager,finance}'::public.app_role[]));
create policy "marketing_investments: dono e gerente lançam" on public.marketing_investments
  for insert to authenticated
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "marketing_investments: dono e gerente alteram" on public.marketing_investments
  for update to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]))
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "marketing_investments: dono e gerente removem" on public.marketing_investments
  for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));

create or replace function private.report_lead_sources(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid,
  p_limit integer,
  p_team_id uuid
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
  open_leads bigint,
  investment numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with janela as (
    select
      w.inicio,
      w.fim,
      private.report_member_scope(p_organization_id, p_user_id, p_team_id) as membros
    from private.report_window(p_from, p_to) w
  ),
  -- Investimento só na visão da imobiliária inteira (dono e gerente sem filtro):
  -- o gasto não é dividido por equipe, e recortado ele inflaria o custo por lead.
  investimento as (
    select
      mi.source,
      lower(mi.utm_campaign) as chave,
      min(mi.utm_campaign) as campanha,
      sum(
        mi.amount
        * extract(epoch from (
            least(j.fim, (mi.month + interval '1 month')::timestamp at time zone 'America/Sao_Paulo')
            - greatest(j.inicio, mi.month::timestamp at time zone 'America/Sao_Paulo')
          ))
        / extract(epoch from (
            ((mi.month + interval '1 month')::timestamp at time zone 'America/Sao_Paulo')
            - (mi.month::timestamp at time zone 'America/Sao_Paulo')
          ))
      ) as valor
    from public.marketing_investments mi
    cross join janela j
    where mi.organization_id = p_organization_id
      and j.membros is null
      and (mi.month::timestamp at time zone 'America/Sao_Paulo') < j.fim
      and ((mi.month + interval '1 month')::timestamp at time zone 'America/Sao_Paulo') > j.inicio
    group by 1, 2
  ),
  grupos as (
    select
      l.source,
      l.landing_page_id,
      lp.name as landing_page_name,
      nullif(btrim(l.utm ->> 'source'), '') as utm_source,
      nullif(btrim(l.utm ->> 'medium'), '') as utm_medium,
      nullif(btrim(l.utm ->> 'campaign'), '') as utm_campaign,
      count(*) as leads,
      count(*) filter (where l.first_contact_at is not null) as answered,
      count(*) filter (where l.stage = 'won') as won,
      count(*) filter (where l.stage = 'lost') as lost,
      count(*) filter (where l.stage not in ('won', 'lost')) as open_leads
    from public.leads l
    cross join janela j
    left join public.landing_pages lp
      on lp.organization_id = l.organization_id and lp.id = l.landing_page_id
    where l.organization_id = p_organization_id
      and l.created_at >= j.inicio
      and l.created_at < j.fim
      and (j.membros is null or l.assigned_to = any (j.membros))
    group by 1, 2, 3, 4, 5, 6
  ),
  -- Campanha com investimento próprio fica com ele; o resto do canal cai no
  -- investimento lançado sem campanha (chave null).
  com_chave as (
    select
      g.*,
      (
        select i.chave
        from investimento i
        where i.source = g.source
          and i.chave = lower(g.utm_campaign)
      ) as chave
    from grupos g
  ),
  por_chave as (
    select c.source, c.chave, sum(c.leads) as leads
    from com_chave c
    group by 1, 2
  )
  select
    c.source,
    c.landing_page_id,
    c.landing_page_name,
    c.utm_source,
    c.utm_medium,
    c.utm_campaign,
    c.leads,
    c.answered,
    c.won,
    c.lost,
    c.open_leads,
    case
      when j.membros is null
        then round(coalesce(i.valor, 0) * c.leads / nullif(pc.leads, 0), 2)
    end
  from com_chave c
  cross join janela j
  join por_chave pc
    on pc.source = c.source and pc.chave is not distinct from c.chave
  left join investimento i
    on i.source = c.source and i.chave is not distinct from c.chave
  union all
  -- Investimento que não trouxe lead nenhum no período também aparece.
  select
    i.source,
    null,
    null,
    null,
    null,
    i.campanha,
    0,
    0,
    0,
    0,
    0,
    round(i.valor, 2)
  from investimento i
  where not exists (
    select 1
    from com_chave c
    where c.source = i.source
      and c.chave is not distinct from i.chave
  )
  order by 9 desc, 7 desc, 12 desc nulls last, 1
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

comment on function private.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer, uuid) is
  'Origem dos leads criados no período com o investimento proporcional (só para dono e gerente sem filtro de corretor ou equipe; null nos demais casos).';

create function public.report_lead_sources(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_limit integer default 100,
  p_team_id uuid default null
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
  open_leads bigint,
  investment numeric
)
language sql
stable
set search_path = ''
as $$
  select s.*
  from private.report_lead_sources(p_organization_id, p_from, p_to, p_user_id, p_limit, p_team_id) s;
$$;

comment on function public.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer, uuid) is
  'Origem dos leads criados no período (canal, landing page, utm_source/medium/campaign) com atendidos, ganhos, perdidos, em aberto e o investimento em marketing atribuído à linha (proporcional aos dias do período e dividido pela quantidade de leads). investment é null com filtro de corretor/equipe ou fora de dono e gerente.';

-- 3.4 Motivo da perda ---------------------------------------------------------
drop function public.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer);

create or replace function private.report_lead_lost_reasons(
  p_organization_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid,
  p_limit integer,
  p_team_id uuid
)
returns table (lost_reason text, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with janela as (
    select
      w.inicio,
      w.fim,
      private.report_member_scope(p_organization_id, p_user_id, p_team_id) as membros
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
      and (j.membros is null or l.assigned_to = any (j.membros))
  )
  select p.motivo, count(*)
  from perdidos p
  group by p.motivo
  order by 2 desc, 1 nulls last
  limit least(greatest(coalesce(p_limit, 20), 1), 200);
$$;

comment on function private.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer, uuid) is
  'Motivos de perda no recorte de private.report_member_scope.';

create function public.report_lead_lost_reasons(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_limit integer default 20,
  p_team_id uuid default null
)
returns table (lost_reason text, total bigint)
language sql
stable
set search_path = ''
as $$
  select m.*
  from private.report_lead_lost_reasons(p_organization_id, p_from, p_to, p_user_id, p_limit, p_team_id) m;
$$;

comment on function public.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer, uuid) is
  'Motivos de perda dos leads que entraram em "Perdido" no período, com filtro de corretor e de equipe respeitando o papel. Motivo em branco volta null.';

-- -----------------------------------------------------------------------------
-- 4. Exportação dos relatórios agregados com a equipe no registro
-- -----------------------------------------------------------------------------
-- `start_data_export` e `record_report_export_rows` continuam como estão (a
-- base e as chamadas antigas). Estas duas acrescentam a equipe aos filtros
-- gravados em audit_events e exigem a MESMA equipe na contagem das linhas.
create or replace function private.begin_report_export(
  p_organization_id uuid,
  p_dataset text,
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid,
  p_team_id uuid,
  p_period_preset text
)
returns table (export_id uuid, allowed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_allowed boolean;
begin
  if p_dataset is null or p_dataset not in ('corretores', 'funil', 'origens', 'motivos-perda') then
    raise exception 'Exportação desconhecida.' using errcode = '22023';
  end if;

  select b.export_id, b.allowed
    into v_id, v_allowed
  from private.begin_data_export(
    p_organization_id, p_dataset, p_from, p_to, p_user_id, p_period_preset
  ) b;

  update public.audit_events e
  set metadata = jsonb_set(
    e.metadata,
    '{filters,team_id}',
    coalesce(to_jsonb(p_team_id), 'null'::jsonb)
  )
  where e.id = v_id;

  return query select v_id, v_allowed;
end;
$$;

comment on function private.begin_report_export(uuid, text, timestamptz, timestamptz, uuid, uuid, text) is
  'Abre a exportação de um relatório agregado por private.begin_data_export e grava também a equipe filtrada (metadata.filters.team_id).';

create or replace function private.add_report_export_rows(
  p_export_id uuid,
  p_organization_id uuid,
  p_dataset text,
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid,
  p_team_id uuid,
  p_rows integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_dataset is null or p_dataset not in ('corretores', 'funil', 'origens', 'motivos-perda') then
    raise exception 'Conjunto de dados inválido para esta contagem.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.audit_events e
    where e.id = p_export_id
      and e.organization_id = p_organization_id
      and e.actor_id = (select auth.uid())
      and e.entity = 'data_export'
      and (e.metadata -> 'filters' ->> 'team_id')::uuid is not distinct from p_team_id
  ) then
    raise exception 'Exportação não autorizada. Só exporta quem o dono da imobiliária liberou em Configurações > Papéis e permissões.'
      using errcode = '42501';
  end if;

  perform private.add_export_rows(
    p_export_id, p_organization_id, p_dataset, p_from, p_to, p_user_id, p_rows, true
  );
end;
$$;

comment on function private.add_report_export_rows(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid, integer) is
  'Fixa a quantidade de linhas de um relatório agregado exportado, exigindo a mesma equipe gravada na abertura (além das travas de private.add_export_rows).';

create or replace function public.start_report_export(
  p_organization_id uuid,
  p_dataset text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_team_id uuid default null,
  p_period_preset text default null
)
returns table (export_id uuid, allowed boolean)
language sql
volatile
set search_path = ''
as $$
  select b.export_id, b.allowed
  from private.begin_report_export(
    p_organization_id, p_dataset, p_from, p_to, p_user_id, p_team_id, p_period_preset
  ) b;
$$;

comment on function public.start_report_export(uuid, text, timestamptz, timestamptz, uuid, uuid, text) is
  'Abre (e registra) a exportação em CSV de um relatório agregado (corretores, funil, origens, motivos de perda) com período, corretor e equipe. allowed = false quando o papel não exporta.';

create or replace function public.record_report_export(
  p_organization_id uuid,
  p_export_id uuid,
  p_dataset text,
  p_rows integer,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_user_id uuid default null,
  p_team_id uuid default null
)
returns void
language sql
volatile
set search_path = ''
as $$
  select private.add_report_export_rows(
    p_export_id, p_organization_id, p_dataset, p_from, p_to, p_user_id, p_team_id, p_rows
  );
$$;

comment on function public.record_report_export(uuid, uuid, text, integer, timestamptz, timestamptz, uuid, uuid) is
  'Informa quantas linhas saíram de um relatório agregado aberto por start_report_export (mesmos filtros, inclusive a equipe).';

-- -----------------------------------------------------------------------------
-- 5. Metas mensais
-- -----------------------------------------------------------------------------
create table public.sales_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  month date not null
    constraint sales_goals_month_check
      check (extract(day from month) = 1 and month >= date '2000-01-01' and month < date '2100-01-01'),
  user_id uuid,
  team_id uuid,
  leads_answered integer constraint sales_goals_leads_answered_check check (leads_answered >= 0),
  visits integer constraint sales_goals_visits_check check (visits >= 0),
  proposals integer constraint sales_goals_proposals_check check (proposals >= 0),
  sales_count integer constraint sales_goals_sales_count_check check (sales_count >= 0),
  sales_amount numeric(14, 2) constraint sales_goals_sales_amount_check check (sales_amount >= 0),
  rentals_count integer constraint sales_goals_rentals_count_check check (rentals_count >= 0),
  rentals_amount numeric(14, 2) constraint sales_goals_rentals_amount_check check (rentals_amount >= 0),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_goals_target_check check (num_nonnulls(user_id, team_id) = 1),
  constraint sales_goals_member_fkey foreign key (user_id, organization_id)
    references public.memberships (user_id, organization_id) on delete cascade,
  constraint sales_goals_team_fkey foreign key (organization_id, team_id)
    references public.teams (organization_id, id) on delete cascade,
  constraint sales_goals_target_key unique nulls not distinct (organization_id, month, user_id, team_id)
);

create index sales_goals_member_idx
  on public.sales_goals (user_id, organization_id)
  where user_id is not null;
create index sales_goals_team_idx
  on public.sales_goals (organization_id, team_id)
  where team_id is not null;
create index sales_goals_created_by_idx on public.sales_goals (created_by);
create index sales_goals_updated_by_idx on public.sales_goals (updated_by);

comment on table public.sales_goals is
  'Metas do mês por corretor (user_id) ou por equipe (team_id): leads atendidos, visitas realizadas, propostas, vendas e locações (quantidade e valor). Coluna vazia = sem meta para aquele indicador. Dono e gerente definem.';

create or replace function private.stamp_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function private.stamp_updated_by() is
  'Grava em updated_by quem fez a última alteração (sessão autenticada).';

create trigger a0_billing_writable before insert or update on public.sales_goals
  for each row execute function private.assert_billing_writable();
create trigger sales_goals_set_updated_at before update on public.sales_goals
  for each row execute function private.set_updated_at();
create trigger sales_goals_stamp_updated_by before insert or update on public.sales_goals
  for each row execute function private.stamp_updated_by();
create trigger sales_goals_enforce_author before insert or update of created_by on public.sales_goals
  for each row execute function private.enforce_author_column('created_by');
create trigger sales_goals_audit after insert or update or delete on public.sales_goals
  for each row execute function private.audit_row_change();

-- Quem lê uma meta: dono e gerente todas; o próprio corretor a dele; o líder as
-- das equipes que lidera e as dos membros delas.
create or replace function private.can_view_sales_goal(
  p_organization_id uuid,
  p_user_id uuid,
  p_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_member(p_organization_id)
    and (
      private.has_role(p_organization_id, '{owner,manager}'::public.app_role[])
      or p_user_id = (select auth.uid())
      or exists (
        select 1
        from public.teams t
        where t.organization_id = p_organization_id
          and t.leader_id = (select auth.uid())
          and (
            t.id = p_team_id
            or exists (
              select 1
              from public.team_members tm
              where tm.organization_id = t.organization_id
                and tm.team_id = t.id
                and tm.user_id = p_user_id
            )
          )
      )
    );
$$;

comment on function private.can_view_sales_goal(uuid, uuid, uuid) is
  'Leitura de meta: dono e gerente todas; corretor a própria; líder as das equipes que lidera e dos membros delas.';

alter table public.sales_goals enable row level security;

create policy "sales_goals: gestão, líder e o próprio leem" on public.sales_goals
  for select to authenticated
  using (private.can_view_sales_goal(organization_id, user_id, team_id));
create policy "sales_goals: dono e gerente criam" on public.sales_goals
  for insert to authenticated
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "sales_goals: dono e gerente alteram" on public.sales_goals
  for update to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]))
  with check (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));
create policy "sales_goals: dono e gerente removem" on public.sales_goals
  for delete to authenticated
  using (private.has_role(organization_id, '{owner,manager}'::public.app_role[]));

-- Grava (ou apaga, quando nenhum indicador vem preenchido) a meta de um mês.
create or replace function public.save_sales_goal(
  p_organization_id uuid,
  p_month date,
  p_user_id uuid default null,
  p_team_id uuid default null,
  p_leads_answered integer default null,
  p_visits integer default null,
  p_proposals integer default null,
  p_sales_count integer default null,
  p_sales_amount numeric default null,
  p_rentals_count integer default null,
  p_rentals_amount numeric default null
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sua sessão expirou. Entre novamente.' using errcode = '42501';
  end if;

  if not private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) then
    raise exception 'Só o dono e o gerente definem metas.' using errcode = '42501';
  end if;

  if v_month is null then
    raise exception 'Informe o mês da meta.' using errcode = '22023';
  end if;

  if num_nonnulls(p_user_id, p_team_id) <> 1 then
    raise exception 'A meta precisa ser de um corretor ou de uma equipe.' using errcode = '22023';
  end if;

  if num_nonnulls(
    p_leads_answered, p_visits, p_proposals, p_sales_count, p_sales_amount,
    p_rentals_count, p_rentals_amount
  ) = 0 then
    delete from public.sales_goals g
    where g.organization_id = p_organization_id
      and g.month = v_month
      and g.user_id is not distinct from p_user_id
      and g.team_id is not distinct from p_team_id;

    return null;
  end if;

  insert into public.sales_goals as g (
    organization_id, month, user_id, team_id, leads_answered, visits, proposals,
    sales_count, sales_amount, rentals_count, rentals_amount
  )
  values (
    p_organization_id, v_month, p_user_id, p_team_id, p_leads_answered, p_visits, p_proposals,
    p_sales_count, p_sales_amount, p_rentals_count, p_rentals_amount
  )
  on conflict (organization_id, month, user_id, team_id) do update
    set leads_answered = excluded.leads_answered,
        visits = excluded.visits,
        proposals = excluded.proposals,
        sales_count = excluded.sales_count,
        sales_amount = excluded.sales_amount,
        rentals_count = excluded.rentals_count,
        rentals_amount = excluded.rentals_amount
  returning g.id into v_id;

  return v_id;
end;
$$;

comment on function public.save_sales_goal(uuid, date, uuid, uuid, integer, integer, integer, integer, numeric, integer, numeric) is
  'Dono e gerente: grava a meta do mês de um corretor ou de uma equipe (substitui a anterior). Sem nenhum indicador preenchido, apaga a meta.';

-- Copia as metas de um mês para outro sem sobrescrever o que já existe.
create or replace function public.copy_sales_goals(
  p_organization_id uuid,
  p_from_month date,
  p_to_month date
)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) then
    raise exception 'Só o dono e o gerente definem metas.' using errcode = '42501';
  end if;

  if p_from_month is null or p_to_month is null
     or date_trunc('month', p_from_month) = date_trunc('month', p_to_month) then
    raise exception 'Escolha meses diferentes para copiar as metas.' using errcode = '22023';
  end if;

  insert into public.sales_goals (
    organization_id, month, user_id, team_id, leads_answered, visits, proposals,
    sales_count, sales_amount, rentals_count, rentals_amount
  )
  select
    g.organization_id, date_trunc('month', p_to_month)::date, g.user_id, g.team_id,
    g.leads_answered, g.visits, g.proposals, g.sales_count, g.sales_amount,
    g.rentals_count, g.rentals_amount
  from public.sales_goals g
  where g.organization_id = p_organization_id
    and g.month = date_trunc('month', p_from_month)::date
    and (
      g.user_id is null
      or exists (
        select 1
        from public.memberships m
        where m.organization_id = g.organization_id
          and m.user_id = g.user_id
          and m.active
      )
    )
  on conflict (organization_id, month, user_id, team_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.copy_sales_goals(uuid, date, date) is
  'Dono e gerente: copia as metas de um mês para outro (só de membros ativos e equipes existentes), sem sobrescrever metas já definidas no destino. Devolve quantas foram copiadas.';

create or replace function private.report_sales_goals(
  p_organization_id uuid,
  p_month date,
  p_user_id uuid,
  p_team_id uuid
)
returns table (
  kind text,
  target_id uuid,
  name text,
  member_role public.app_role,
  team_id uuid,
  team_name text,
  member_active boolean,
  goal_leads_answered integer,
  goal_visits integer,
  goal_proposals integer,
  goal_sales_count integer,
  goal_sales_amount numeric,
  goal_rentals_count integer,
  goal_rentals_amount numeric,
  leads_answered bigint,
  visits bigint,
  proposals bigint,
  sales_count bigint,
  sales_amount numeric,
  rentals_count bigint,
  rentals_amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with mes as (
    select
      m.dia,
      (m.dia::timestamp at time zone 'America/Sao_Paulo') as inicio,
      ((m.dia + interval '1 month')::timestamp at time zone 'America/Sao_Paulo') as fim,
      private.report_member_scope(p_organization_id, p_user_id, p_team_id) as membros,
      case
        when p_user_id is null then private.report_team_scope(p_organization_id, p_team_id)
        else '{}'::uuid[]
      end as equipes
    from (
      select date_trunc(
        'month',
        coalesce(p_month, (now() at time zone 'America/Sao_Paulo')::date)
      )::date as dia
    ) m
  ),
  corretores as (
    select
      m.user_id,
      m.role,
      m.active,
      coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Membro sem nome') as nome,
      tm.team_id,
      t.name as team_name
    from public.memberships m
    cross join mes x
    left join public.profiles pr on pr.id = m.user_id
    left join public.team_members tm
      on tm.organization_id = m.organization_id and tm.user_id = m.user_id
    left join public.teams t
      on t.organization_id = tm.organization_id and t.id = tm.team_id
    where m.organization_id = p_organization_id
      and (x.membros is null or m.user_id = any (x.membros))
  ),
  realizado as (
    select
      c.user_id,
      atendidos.total as leads_answered,
      visitas.total as visits,
      propostas.feitas as proposals,
      propostas.vendas,
      propostas.valor_vendas,
      propostas.locacoes,
      propostas.valor_locacoes
    from corretores c
    cross join mes x
    cross join lateral (
      -- Mesma conta da coluna "Atendidos" de Por corretor com o período do mês.
      select count(*) as total
      from public.leads l
      where l.organization_id = p_organization_id
        and l.assigned_to = c.user_id
        and coalesce(l.assigned_at, l.created_at) >= x.inicio
        and coalesce(l.assigned_at, l.created_at) < x.fim
        and l.first_contact_at is not null
    ) atendidos
    cross join lateral (
      select count(*) as total
      from public.appointments a
      where a.organization_id = p_organization_id
        and a.broker_id = c.user_id
        and a.status = 'done'
        and a.starts_at >= x.inicio
        and a.starts_at < x.fim
    ) visitas
    cross join lateral (
      select
        count(*) filter (where p.created_at >= x.inicio and p.created_at < x.fim) as feitas,
        count(*) filter (
          where p.status = 'accepted' and p.decided_at >= x.inicio and p.decided_at < x.fim
            and p.purpose = 'sale'
        ) as vendas,
        coalesce(
          sum(p.amount) filter (
            where p.status = 'accepted' and p.decided_at >= x.inicio and p.decided_at < x.fim
              and p.purpose = 'sale'
          ),
          0
        ) as valor_vendas,
        count(*) filter (
          where p.status = 'accepted' and p.decided_at >= x.inicio and p.decided_at < x.fim
            and p.purpose = 'rent'
        ) as locacoes,
        coalesce(
          sum(p.amount) filter (
            where p.status = 'accepted' and p.decided_at >= x.inicio and p.decided_at < x.fim
              and p.purpose = 'rent'
          ),
          0
        ) as valor_locacoes
      from public.proposals p
      where p.organization_id = p_organization_id
        and p.broker_id = c.user_id
        and (
          (p.created_at >= x.inicio and p.created_at < x.fim)
          or (p.decided_at >= x.inicio and p.decided_at < x.fim)
        )
    ) propostas
  ),
  realizado_equipe as (
    select
      tm.team_id,
      sum(r.leads_answered) as leads_answered,
      sum(r.visits) as visits,
      sum(r.proposals) as proposals,
      sum(r.vendas) as vendas,
      sum(r.valor_vendas) as valor_vendas,
      sum(r.locacoes) as locacoes,
      sum(r.valor_locacoes) as valor_locacoes
    from public.team_members tm
    join realizado r on r.user_id = tm.user_id
    where tm.organization_id = p_organization_id
    group by tm.team_id
  )
  select
    'team'::text,
    t.id,
    t.name,
    null::public.app_role,
    t.id,
    t.name,
    true,
    g.leads_answered,
    g.visits,
    g.proposals,
    g.sales_count,
    g.sales_amount,
    g.rentals_count,
    g.rentals_amount,
    coalesce(re.leads_answered, 0)::bigint,
    coalesce(re.visits, 0)::bigint,
    coalesce(re.proposals, 0)::bigint,
    coalesce(re.vendas, 0)::bigint,
    coalesce(re.valor_vendas, 0),
    coalesce(re.locacoes, 0)::bigint,
    coalesce(re.valor_locacoes, 0)
  from public.teams t
  cross join mes x
  left join public.sales_goals g
    on g.organization_id = t.organization_id and g.month = x.dia and g.team_id = t.id
  left join realizado_equipe re on re.team_id = t.id
  where t.organization_id = p_organization_id
    and (x.equipes is null or t.id = any (x.equipes))
  union all
  select
    'broker'::text,
    c.user_id,
    c.nome,
    c.role,
    c.team_id,
    c.team_name,
    c.active,
    g.leads_answered,
    g.visits,
    g.proposals,
    g.sales_count,
    g.sales_amount,
    g.rentals_count,
    g.rentals_amount,
    r.leads_answered,
    r.visits,
    r.proposals,
    r.vendas,
    r.valor_vendas,
    r.locacoes,
    r.valor_locacoes
  from corretores c
  cross join mes x
  join realizado r on r.user_id = c.user_id
  left join public.sales_goals g
    on g.organization_id = p_organization_id and g.month = x.dia and g.user_id = c.user_id
  -- Assistente e financeiro só aparecem se tiverem meta ou movimento no mês.
  where (c.active and c.role in ('owner', 'manager', 'broker', 'capturer'))
     or g.id is not null
     or (r.leads_answered + r.visits + r.proposals + r.vendas + r.locacoes) > 0
  order by 1 desc, 6 nulls last, 3;
$$;

comment on function private.report_sales_goals(uuid, date, uuid, uuid) is
  'Metas e realizado do mês por equipe e por corretor, no recorte de private.report_member_scope / report_team_scope.';

create or replace function public.report_sales_goals(
  p_organization_id uuid,
  p_month date default null,
  p_user_id uuid default null,
  p_team_id uuid default null
)
returns table (
  kind text,
  target_id uuid,
  name text,
  member_role public.app_role,
  team_id uuid,
  team_name text,
  member_active boolean,
  goal_leads_answered integer,
  goal_visits integer,
  goal_proposals integer,
  goal_sales_count integer,
  goal_sales_amount numeric,
  goal_rentals_count integer,
  goal_rentals_amount numeric,
  leads_answered bigint,
  visits bigint,
  proposals bigint,
  sales_count bigint,
  sales_amount numeric,
  rentals_count bigint,
  rentals_amount numeric
)
language sql
stable
set search_path = ''
as $$
  select g.* from private.report_sales_goals(p_organization_id, p_month, p_user_id, p_team_id) g;
$$;

comment on function public.report_sales_goals(uuid, date, uuid, uuid) is
  'Aba Metas: uma linha por equipe (kind = team; só dono, gerente e líder) e por corretor (kind = broker) com a meta do mês (goal_*, null = sem meta) e o realizado: leads atendidos, visitas realizadas, propostas feitas, vendas e locações aceitas (quantidade e valor).';

-- -----------------------------------------------------------------------------
-- 6. Previsão de vendas
-- -----------------------------------------------------------------------------
alter table public.proposals
  add column expected_close_date date
    constraint proposals_expected_close_date_check
      check (expected_close_date between date '2000-01-01' and date '2100-12-31');

comment on column public.proposals.expected_close_date is
  'Data prevista de fechamento (dia civil). Base da previsão de vendas em /relatorios (aba Previsão).';

-- `proposals` tem privilégio por coluna para `authenticated`: sem este grant,
-- um `select *` passaria a falhar.
grant select (expected_close_date), insert (expected_close_date), update (expected_close_date)
  on public.proposals to authenticated;

create index proposals_open_expected_close_idx
  on public.proposals (organization_id, expected_close_date)
  where status in ('draft', 'sent', 'countered');

create table public.proposal_stage_probabilities (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status public.proposal_status not null
    constraint proposal_stage_probabilities_open_status
      check (status in ('draft', 'sent', 'countered')),
  probability smallint not null
    constraint proposal_stage_probabilities_range check (probability between 0 and 100),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposal_stage_probabilities_pkey primary key (organization_id, status)
);

create index proposal_stage_probabilities_updated_by_idx
  on public.proposal_stage_probabilities (updated_by);

comment on table public.proposal_stage_probabilities is
  'Probabilidade de fechamento por etapa da proposta (rascunho, enviada, contraproposta), usada no pipeline ponderado. Sem linha = padrão (10%, 30% e 50%). Só o dono altera.';

create trigger a0_billing_writable before insert or update on public.proposal_stage_probabilities
  for each row execute function private.assert_billing_writable();
create trigger proposal_stage_probabilities_set_updated_at
  before update on public.proposal_stage_probabilities
  for each row execute function private.set_updated_at();
create trigger proposal_stage_probabilities_stamp_updated_by
  before insert or update on public.proposal_stage_probabilities
  for each row execute function private.stamp_updated_by();
create trigger proposal_stage_probabilities_audit
  after insert or update or delete on public.proposal_stage_probabilities
  for each row execute function private.audit_row_change();

alter table public.proposal_stage_probabilities enable row level security;

create policy "proposal_stage_probabilities: membros leem" on public.proposal_stage_probabilities
  for select to authenticated
  using (private.is_member(organization_id));
create policy "proposal_stage_probabilities: dono cria" on public.proposal_stage_probabilities
  for insert to authenticated
  with check (private.has_role(organization_id, '{owner}'::public.app_role[]));
create policy "proposal_stage_probabilities: dono altera" on public.proposal_stage_probabilities
  for update to authenticated
  using (private.has_role(organization_id, '{owner}'::public.app_role[]))
  with check (private.has_role(organization_id, '{owner}'::public.app_role[]));
create policy "proposal_stage_probabilities: dono remove" on public.proposal_stage_probabilities
  for delete to authenticated
  using (private.has_role(organization_id, '{owner}'::public.app_role[]));

create or replace function private.proposal_default_probability(p_status public.proposal_status)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select (
    case p_status::text
      when 'draft' then 10
      when 'sent' then 30
      when 'countered' then 50
      when 'accepted' then 100
      else 0
    end
  )::smallint;
$$;

comment on function private.proposal_default_probability(public.proposal_status) is
  'Probabilidade padrão de fechamento por etapa da proposta: rascunho 10%, enviada 30%, contraproposta 50%, aceita 100%, encerrada sem venda 0%.';

create or replace function public.get_proposal_stage_probabilities(p_organization_id uuid)
returns table (status public.proposal_status, probability smallint, is_default boolean)
language sql
stable
set search_path = ''
as $$
  select
    s.status,
    coalesce(p.probability, private.proposal_default_probability(s.status)),
    p.probability is null
  from unnest('{draft,sent,countered}'::public.proposal_status[]) with ordinality as s(status, ordem)
  left join public.proposal_stage_probabilities p
    on p.organization_id = p_organization_id and p.status = s.status
  where private.is_member(p_organization_id)
  order by s.ordem;
$$;

comment on function public.get_proposal_stage_probabilities(uuid) is
  'Probabilidade em vigor para cada etapa em aberto da proposta (a do dono ou a padrão).';

create or replace function public.set_proposal_stage_probabilities(
  p_organization_id uuid,
  p_draft smallint,
  p_sent smallint,
  p_countered smallint
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if not private.has_role(p_organization_id, '{owner}'::public.app_role[]) then
    raise exception 'Só o dono muda a probabilidade de fechamento por etapa.' using errcode = '42501';
  end if;

  if p_draft is null or p_sent is null or p_countered is null
     or least(p_draft, p_sent, p_countered) < 0
     or greatest(p_draft, p_sent, p_countered) > 100 then
    raise exception 'Cada probabilidade precisa estar entre 0%% e 100%%.' using errcode = '22023';
  end if;

  insert into public.proposal_stage_probabilities (organization_id, status, probability)
  values
    (p_organization_id, 'draft', p_draft),
    (p_organization_id, 'sent', p_sent),
    (p_organization_id, 'countered', p_countered)
  on conflict (organization_id, status) do update
    set probability = excluded.probability;
end;
$$;

comment on function public.set_proposal_stage_probabilities(uuid, smallint, smallint, smallint) is
  'Só o dono: grava a probabilidade de fechamento de rascunho, enviada e contraproposta.';

create or replace function public.set_proposal_expected_close_date(
  p_organization_id uuid,
  p_proposal_id uuid,
  p_expected_close_date date
)
returns date
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_status public.proposal_status;
  v_date date;
begin
  if (select auth.uid()) is null then
    raise exception 'Sua sessão expirou. Entre novamente.' using errcode = '42501';
  end if;

  if p_expected_close_date is not null
     and (
       p_expected_close_date < date '2000-01-01'
       or p_expected_close_date > (now() at time zone 'America/Sao_Paulo')::date + 3650
     ) then
    raise exception 'Escolha uma data prevista de fechamento dentro dos próximos 10 anos.'
      using errcode = '22023';
  end if;

  select p.status
    into v_status
  from public.proposals p
  where p.organization_id = p_organization_id
    and p.id = p_proposal_id;

  if not found then
    raise exception 'Proposta não encontrada.' using errcode = 'P0002';
  end if;

  if v_status not in ('draft', 'sent', 'countered') then
    raise exception 'Só propostas em aberto têm data prevista de fechamento.' using errcode = 'P0001';
  end if;

  -- Security invoker: quem decide se pode é a policy de UPDATE de proposals.
  update public.proposals p
  set expected_close_date = p_expected_close_date
  where p.organization_id = p_organization_id
    and p.id = p_proposal_id
  returning p.expected_close_date into v_date;

  if not found then
    raise exception 'Seu papel não permite editar esta proposta.' using errcode = '42501';
  end if;

  return v_date;
end;
$$;

comment on function public.set_proposal_expected_close_date(uuid, uuid, date) is
  'Grava (ou limpa, com null) a data prevista de fechamento de uma proposta em aberto. Security invoker: vale a mesma permissão de editar a proposta.';

create or replace function private.report_sales_forecast(
  p_organization_id uuid,
  p_user_id uuid,
  p_team_id uuid,
  p_today date
)
returns table (
  user_id uuid,
  full_name text,
  team_id uuid,
  team_name text,
  bucket text,
  purpose public.listing_purpose,
  proposals bigint,
  amount numeric,
  weighted_amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with ref as (
    select
      date_trunc('month', d.hoje)::date as mes,
      (date_trunc('month', d.hoje) + interval '1 month')::date as proximo,
      (date_trunc('month', d.hoje) + interval '2 months')::date as depois,
      (date_trunc('month', d.hoje)::timestamp at time zone 'America/Sao_Paulo') as mes_inicio,
      ((date_trunc('month', d.hoje) + interval '1 month')::timestamp at time zone 'America/Sao_Paulo') as mes_fim,
      private.report_member_scope(p_organization_id, p_user_id, p_team_id) as membros
    from (
      select coalesce(p_today, (now() at time zone 'America/Sao_Paulo')::date) as hoje
    ) d
  ),
  propostas as (
    select
      p.broker_id,
      p.purpose,
      p.amount,
      case
        when p.status = 'accepted' then 'committed'
        when p.expected_close_date is null then 'no_date'
        when p.expected_close_date < r.mes then 'overdue'
        when p.expected_close_date < r.proximo then 'current_month'
        when p.expected_close_date < r.depois then 'next_month'
        else 'later'
      end as bucket,
      case
        when p.status = 'accepted' then 100
        else coalesce(ps.probability, private.proposal_default_probability(p.status))
      end as probabilidade
    from public.proposals p
    cross join ref r
    left join public.proposal_stage_probabilities ps
      on ps.organization_id = p.organization_id and ps.status = p.status
    where p.organization_id = p_organization_id
      and (r.membros is null or p.broker_id = any (r.membros))
      and (
        p.status in ('draft', 'sent', 'countered')
        or (p.status = 'accepted' and p.decided_at >= r.mes_inicio and p.decided_at < r.mes_fim)
      )
  )
  select
    p.broker_id,
    case
      when p.broker_id is null then 'Sem corretor'
      else coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Membro sem nome')
    end,
    t.id,
    t.name,
    p.bucket,
    p.purpose,
    count(*),
    sum(p.amount),
    round(sum(p.amount * p.probabilidade / 100.0), 2)
  from propostas p
  left join public.profiles pr on pr.id = p.broker_id
  left join public.team_members tm
    on tm.organization_id = p_organization_id and tm.user_id = p.broker_id
  left join public.teams t
    on t.organization_id = tm.organization_id and t.id = tm.team_id
  group by p.broker_id, pr.full_name, pr.email, t.id, t.name, p.bucket, p.purpose
  order by 2, 5, 6;
$$;

comment on function private.report_sales_forecast(uuid, uuid, uuid, date) is
  'Pipeline ponderado por corretor, faixa de data prevista e finalidade, no recorte de private.report_member_scope.';

create or replace function public.report_sales_forecast(
  p_organization_id uuid,
  p_user_id uuid default null,
  p_team_id uuid default null,
  p_today date default null
)
returns table (
  user_id uuid,
  full_name text,
  team_id uuid,
  team_name text,
  bucket text,
  purpose public.listing_purpose,
  proposals bigint,
  amount numeric,
  weighted_amount numeric
)
language sql
stable
set search_path = ''
as $$
  select f.* from private.report_sales_forecast(p_organization_id, p_user_id, p_team_id, p_today) f;
$$;

comment on function public.report_sales_forecast(uuid, uuid, uuid, date) is
  'Aba Previsão: por corretor e finalidade (venda/locação), as propostas em aberto somadas por faixa da data prevista (current_month, next_month, overdue = antes deste mês, later, no_date) com o valor bruto e o ponderado pela probabilidade da etapa; bucket committed = aceitas neste mês (100%). p_today só serve para testes.';

create or replace function private.report_forecast_proposals(
  p_organization_id uuid,
  p_user_id uuid,
  p_team_id uuid,
  p_limit integer
)
returns table (
  id uuid,
  created_at timestamptz,
  property_id uuid,
  property_code text,
  property_title text,
  broker_id uuid,
  broker_name text,
  team_name text,
  purpose public.listing_purpose,
  amount numeric,
  status public.proposal_status,
  probability smallint,
  expected_close_date date,
  valid_until date,
  can_edit boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with escopo as (
    select private.report_member_scope(p_organization_id, p_user_id, p_team_id) as membros
  )
  select
    p.id,
    p.created_at,
    p.property_id,
    im.code,
    im.title,
    p.broker_id,
    coalesce(nullif(btrim(pr.full_name), ''), pr.email),
    t.name,
    p.purpose,
    p.amount,
    p.status,
    coalesce(ps.probability, private.proposal_default_probability(p.status)),
    p.expected_close_date,
    p.valid_until,
    -- Espelho das policies de UPDATE de proposals, só para a tela saber se
    -- desenha o campo editável. Quem decide é o UPDATE da própria sessão em
    -- public.set_proposal_expected_close_date.
    (
      (
        private.can_edit_property(p.property_id)
        or (
          private.has_role(p.organization_id, '{broker,capturer}'::public.app_role[])
          and p.broker_id = (select auth.uid())
        )
      )
      and private.has_role(p.organization_id, '{owner,manager,broker,capturer,assistant}'::public.app_role[])
      and private.can_access_client(p.client_id)
      and (
        private.has_role(p.organization_id, '{owner,manager}'::public.app_role[])
        or p.broker_id = (select auth.uid())
        or private.can_edit_property(p.property_id)
      )
    )
  from public.proposals p
  cross join escopo e
  left join public.properties im
    on im.organization_id = p.organization_id and im.id = p.property_id
  left join public.profiles pr on pr.id = p.broker_id
  left join public.team_members tm
    on tm.organization_id = p.organization_id and tm.user_id = p.broker_id
  left join public.teams t
    on t.organization_id = tm.organization_id and t.id = tm.team_id
  left join public.proposal_stage_probabilities ps
    on ps.organization_id = p.organization_id and ps.status = p.status
  where p.organization_id = p_organization_id
    and p.status in ('draft', 'sent', 'countered')
    and (e.membros is null or p.broker_id = any (e.membros))
  order by p.expected_close_date nulls first, p.amount desc, p.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

comment on function private.report_forecast_proposals(uuid, uuid, uuid, integer) is
  'Propostas em aberto do recorte (sem dado do cliente), com a probabilidade da etapa e se a sessão pode editar a data prevista.';

create or replace function public.report_forecast_proposals(
  p_organization_id uuid,
  p_user_id uuid default null,
  p_team_id uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  created_at timestamptz,
  property_id uuid,
  property_code text,
  property_title text,
  broker_id uuid,
  broker_name text,
  team_name text,
  purpose public.listing_purpose,
  amount numeric,
  status public.proposal_status,
  probability smallint,
  expected_close_date date,
  valid_until date,
  can_edit boolean
)
language sql
stable
set search_path = ''
as $$
  select f.* from private.report_forecast_proposals(p_organization_id, p_user_id, p_team_id, p_limit) f;
$$;

comment on function public.report_forecast_proposals(uuid, uuid, uuid, integer) is
  'Aba Previsão: propostas em aberto (rascunho, enviada, contraproposta) no recorte do papel, sem data prevista primeiro. Não traz dado do cliente.';

-- -----------------------------------------------------------------------------
-- 7. Investimento em marketing: gravação e importação
-- -----------------------------------------------------------------------------
create or replace function public.save_marketing_investment(
  p_organization_id uuid,
  p_month date,
  p_source public.lead_source,
  p_utm_campaign text,
  p_amount numeric,
  p_notes text default null
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) then
    raise exception 'Só o dono e o gerente lançam investimento em marketing.' using errcode = '42501';
  end if;

  if p_month is null or p_source is null or p_amount is null or p_amount < 0 then
    raise exception 'Informe mês, canal e um valor maior ou igual a zero.' using errcode = '22023';
  end if;

  insert into public.marketing_investments as mi (
    organization_id, month, source, utm_campaign, amount, notes
  )
  values (
    p_organization_id,
    date_trunc('month', p_month)::date,
    p_source,
    nullif(btrim(p_utm_campaign), ''),
    round(p_amount, 2),
    nullif(btrim(p_notes), '')
  )
  on conflict (organization_id, month, source, (lower(coalesce(utm_campaign, '')))) do update
    set amount = excluded.amount,
        notes = excluded.notes,
        utm_campaign = excluded.utm_campaign
  returning mi.id into v_id;

  return v_id;
end;
$$;

comment on function public.save_marketing_investment(uuid, date, public.lead_source, text, numeric, text) is
  'Dono e gerente: lança o investimento de um mês + canal + campanha (vazia = canal inteiro). Lançar de novo a mesma combinação substitui o valor.';

create or replace function public.import_marketing_investments(
  p_organization_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) then
    raise exception 'Só o dono e o gerente lançam investimento em marketing.' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'O arquivo não tem nenhuma linha para importar.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Importe no máximo 500 linhas por vez.' using errcode = '22023';
  end if;

  -- Linhas repetidas (mesmo mês, canal e campanha) são somadas.
  insert into public.marketing_investments (organization_id, month, source, utm_campaign, amount)
  select
    p_organization_id,
    x.mes,
    x.source,
    min(x.campanha),
    round(sum(x.amount), 2)
  from (
    select
      date_trunc('month', r.month)::date as mes,
      r.source,
      nullif(btrim(r.utm_campaign), '') as campanha,
      r.amount
    from jsonb_to_recordset(p_rows) as r(
      month date,
      source public.lead_source,
      utm_campaign text,
      amount numeric
    )
  ) x
  where x.mes is not null
    and x.source is not null
    and x.amount is not null
    and x.amount >= 0
  group by x.mes, x.source, lower(coalesce(x.campanha, ''))
  on conflict (organization_id, month, source, (lower(coalesce(utm_campaign, '')))) do update
    set amount = excluded.amount;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.import_marketing_investments(uuid, jsonb) is
  'Dono e gerente: importa até 500 linhas [{month, source, utm_campaign, amount}] (a planilha já validada pela tela). Linhas iguais somam; combinação já lançada é substituída. Devolve quantas combinações foram gravadas.';

create or replace function public.list_lead_campaigns(
  p_organization_id uuid,
  p_since timestamptz default null
)
returns table (source public.lead_source, utm_campaign text, leads bigint)
language sql
stable
set search_path = ''
as $$
  select l.source, min(btrim(l.utm ->> 'campaign')), count(*)
  from public.leads l
  where l.organization_id = p_organization_id
    and private.has_role(p_organization_id, '{owner,manager}'::public.app_role[])
    and l.created_at >= coalesce(p_since, now() - interval '180 days')
    and nullif(btrim(l.utm ->> 'campaign'), '') is not null
  group by l.source, lower(btrim(l.utm ->> 'campaign'))
  order by 3 desc
  limit 200;
$$;

comment on function public.list_lead_campaigns(uuid, timestamptz) is
  'Campanhas (utm_campaign) que trouxeram leads desde p_since (padrão 180 dias), por canal: sugestão para o lançamento de investimento casar com a atribuição. Só dono e gerente.';

-- -----------------------------------------------------------------------------
-- 8. Grants
-- -----------------------------------------------------------------------------
revoke all on table public.teams from anon;
revoke truncate, trigger, references on table public.teams from authenticated;
revoke all on table public.team_members from anon;
revoke truncate, trigger, references on table public.team_members from authenticated;
revoke all on table public.sales_goals from anon;
revoke truncate, trigger, references on table public.sales_goals from authenticated;
revoke all on table public.marketing_investments from anon;
revoke truncate, trigger, references on table public.marketing_investments from authenticated;
revoke all on table public.proposal_stage_probabilities from anon;
revoke truncate, trigger, references on table public.proposal_stage_probabilities from authenticated;

-- Funções de trigger: ninguém chama direto.
revoke all on function private.teams_add_leader_as_member() from public, anon, authenticated;
revoke all on function private.marketing_investments_normalize() from public, anon, authenticated;
revoke all on function private.stamp_updated_by() from public, anon, authenticated;

-- Ajudantes chamados por policies e pelos wrappers security invoker.
revoke all on function private.report_led_team_ids(uuid) from public, anon;
grant execute on function private.report_led_team_ids(uuid) to authenticated;
revoke all on function private.report_member_scope(uuid, uuid, uuid) from public, anon;
grant execute on function private.report_member_scope(uuid, uuid, uuid) to authenticated;
revoke all on function private.report_team_scope(uuid, uuid) from public, anon;
grant execute on function private.report_team_scope(uuid, uuid) to authenticated;
revoke all on function private.can_view_sales_goal(uuid, uuid, uuid) from public, anon;
grant execute on function private.can_view_sales_goal(uuid, uuid, uuid) to authenticated;
revoke all on function private.proposal_default_probability(public.proposal_status) from public, anon;
grant execute on function private.proposal_default_probability(public.proposal_status) to authenticated;

revoke all on function private.report_broker_performance(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function private.report_broker_performance(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;
revoke all on function private.report_stage_funnel(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function private.report_stage_funnel(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;
revoke all on function private.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer, uuid) from public, anon;
grant execute on function private.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer, uuid) to authenticated;
revoke all on function private.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer, uuid) from public, anon;
grant execute on function private.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer, uuid) to authenticated;
revoke all on function private.begin_report_export(uuid, text, timestamptz, timestamptz, uuid, uuid, text) from public, anon;
grant execute on function private.begin_report_export(uuid, text, timestamptz, timestamptz, uuid, uuid, text) to authenticated;
revoke all on function private.add_report_export_rows(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid, integer) from public, anon;
grant execute on function private.add_report_export_rows(uuid, uuid, text, timestamptz, timestamptz, uuid, uuid, integer) to authenticated;
revoke all on function private.report_sales_goals(uuid, date, uuid, uuid) from public, anon;
grant execute on function private.report_sales_goals(uuid, date, uuid, uuid) to authenticated;
revoke all on function private.report_sales_forecast(uuid, uuid, uuid, date) from public, anon;
grant execute on function private.report_sales_forecast(uuid, uuid, uuid, date) to authenticated;
revoke all on function private.report_forecast_proposals(uuid, uuid, uuid, integer) from public, anon;
grant execute on function private.report_forecast_proposals(uuid, uuid, uuid, integer) to authenticated;

-- RPCs públicas (security invoker).
revoke all on function public.report_broker_performance(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_broker_performance(uuid, timestamptz, timestamptz) to authenticated;
revoke all on function public.report_broker_performance_by_team(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.report_broker_performance_by_team(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;
revoke all on function public.report_stage_funnel(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.report_stage_funnel(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;
revoke all on function public.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer, uuid) from public, anon;
grant execute on function public.report_lead_sources(uuid, timestamptz, timestamptz, uuid, integer, uuid) to authenticated;
revoke all on function public.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer, uuid) from public, anon;
grant execute on function public.report_lead_lost_reasons(uuid, timestamptz, timestamptz, uuid, integer, uuid) to authenticated;
revoke all on function public.start_report_export(uuid, text, timestamptz, timestamptz, uuid, uuid, text) from public, anon;
grant execute on function public.start_report_export(uuid, text, timestamptz, timestamptz, uuid, uuid, text) to authenticated;
revoke all on function public.record_report_export(uuid, uuid, text, integer, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.record_report_export(uuid, uuid, text, integer, timestamptz, timestamptz, uuid, uuid) to authenticated;
revoke all on function public.save_sales_goal(uuid, date, uuid, uuid, integer, integer, integer, integer, numeric, integer, numeric) from public, anon;
grant execute on function public.save_sales_goal(uuid, date, uuid, uuid, integer, integer, integer, integer, numeric, integer, numeric) to authenticated;
revoke all on function public.copy_sales_goals(uuid, date, date) from public, anon;
grant execute on function public.copy_sales_goals(uuid, date, date) to authenticated;
revoke all on function public.report_sales_goals(uuid, date, uuid, uuid) from public, anon;
grant execute on function public.report_sales_goals(uuid, date, uuid, uuid) to authenticated;
revoke all on function public.get_proposal_stage_probabilities(uuid) from public, anon;
grant execute on function public.get_proposal_stage_probabilities(uuid) to authenticated;
revoke all on function public.set_proposal_stage_probabilities(uuid, smallint, smallint, smallint) from public, anon;
grant execute on function public.set_proposal_stage_probabilities(uuid, smallint, smallint, smallint) to authenticated;
revoke all on function public.set_proposal_expected_close_date(uuid, uuid, date) from public, anon;
grant execute on function public.set_proposal_expected_close_date(uuid, uuid, date) to authenticated;
revoke all on function public.report_sales_forecast(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.report_sales_forecast(uuid, uuid, uuid, date) to authenticated;
revoke all on function public.report_forecast_proposals(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.report_forecast_proposals(uuid, uuid, uuid, integer) to authenticated;
revoke all on function public.save_marketing_investment(uuid, date, public.lead_source, text, numeric, text) from public, anon;
grant execute on function public.save_marketing_investment(uuid, date, public.lead_source, text, numeric, text) to authenticated;
revoke all on function public.import_marketing_investments(uuid, jsonb) from public, anon;
grant execute on function public.import_marketing_investments(uuid, jsonb) to authenticated;
revoke all on function public.list_lead_campaigns(uuid, timestamptz) from public, anon;
grant execute on function public.list_lead_campaigns(uuid, timestamptz) to authenticated;
