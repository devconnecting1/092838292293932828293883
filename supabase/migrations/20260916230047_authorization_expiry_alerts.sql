-- =============================================================================
-- Autorização de venda/locação vencendo: estado por imóvel, filtro na lista,
-- cartão do Painel e avisos por e-mail em D-30, D-15, D-7 e D-1
-- =============================================================================
--  1. private.authorization_tracked_status / private.listing_authorization_state
--  2. public.search_properties: filtro p_authorization e colunas do estado
--  3. public.dashboard_authorization_alerts: cartão do Painel
--  4. private.authorization_alert_notifications: controle "um aviso por marco"
--  5. public.claim_authorization_alerts / public.settle_authorization_alerts
--
-- "Hoje" é sempre a data de São Paulo. A janela de "vencendo" é de 30 dias e os
-- marcos dos avisos são 30, 15, 7 e 1 (espelhados em
-- packages/core/src/properties/authorization-alerts.ts).

-- -----------------------------------------------------------------------------
-- 1. Estado da autorização de um imóvel
-- -----------------------------------------------------------------------------
create or replace function private.authorization_tracked_status(p_status public.property_status)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_status in ('draft', 'active', 'reserved');
$$;

comment on function private.authorization_tracked_status(public.property_status) is
  'Status em que a autorização importa (imóvel em carteira): rascunho, ativo e reservado. Vendido, alugado e inativo ficam fora do filtro, do Painel e dos avisos.';

revoke all on function private.authorization_tracked_status(public.property_status) from public, anon;
grant execute on function private.authorization_tracked_status(public.property_status) to authenticated;

create or replace function private.listing_authorization_state(
  p_organization_id uuid,
  p_property_id uuid,
  p_today date
)
returns table (state text, ends_on date, exclusive boolean)
language sql
stable
set search_path = ''
as $$
  -- Agregado sem GROUP BY: sempre exatamente uma linha, mesmo sem autorização.
  select
    case
      when count(*) = 0 then 'none'
      when bool_or(a.starts_on <= p_today and (a.ends_on is null or a.ends_on >= p_today)) then
        case
          -- Sem prazo final, ou renovação já registrada além da janela.
          when bool_or(a.ends_on is null) or max(a.ends_on) > p_today + 30 then 'active'
          else 'expiring'
        end
      when bool_or(a.starts_on > p_today) then 'upcoming'
      else 'expired'
    end,
    case when bool_or(a.ends_on is null) then null else max(a.ends_on) end,
    coalesce(bool_or(a.exclusive) filter (where a.ends_on is null or a.ends_on >= p_today), false)
  from public.listing_authorizations a
  where a.organization_id = p_organization_id
    and a.property_id = p_property_id;
$$;

comment on function private.listing_authorization_state(uuid, uuid, date) is
  'Situação da autorização do imóvel na data: none (nenhuma), active (vigente), expiring (vigente e a cobertura acaba em até 30 dias), expired (todas vencidas) ou upcoming (só autorização futura). ends_on é o último dia coberto (null = sem prazo). security invoker: o RLS de listing_authorizations vale para quem chama.';

revoke all on function private.listing_authorization_state(uuid, uuid, date) from public, anon;
grant execute on function private.listing_authorization_state(uuid, uuid, date) to authenticated;

-- Candidatos dos avisos: autorizações com fim próximo, em todas as imobiliárias.
create index if not exists listing_authorizations_ends_on_idx
  on public.listing_authorizations (ends_on)
  where ends_on is not null;

-- -----------------------------------------------------------------------------
-- 2. Lista de imóveis: filtro por autorização (vencendo em 30 dias ou vencida)
-- -----------------------------------------------------------------------------
-- O tipo de retorno ganha colunas, então a função é recriada (mesmos grants).
drop function if exists public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer
);

create function public.search_properties(
  p_organization_id uuid,
  p_term text default null,
  p_status public.property_status default null,
  p_purpose public.listing_purpose default null,
  p_type public.property_type default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_min_bedrooms integer default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_authorization text default null
)
returns table (
  id uuid,
  code text,
  title text,
  neighborhood text,
  city text,
  state text,
  purpose public.listing_purpose,
  type public.property_type,
  status public.property_status,
  sale_price numeric,
  rent_price numeric,
  imob_score smallint,
  captured_by uuid,
  broker_id uuid,
  published_to_portals boolean,
  cover_path text,
  matched_owner text,
  total_count bigint,
  authorization_state text,
  authorization_ends_on date
)
language sql
stable
set search_path = ''
as $$
  with args as (
    select
      case
        when nullif(btrim(coalesce(p_term, '')), '') is null then null
        else '%' || replace(
               replace(
                 replace(private.search_normalize(btrim(p_term)), '\', '\\'),
                 '%', '\%'
               ),
               '_', '\_'
             ) || '%'
      end as like_pattern,
      -- Só os dois filtros da tela; qualquer outro valor é ignorado.
      case when p_authorization in ('expiring', 'expired') then p_authorization end as auth_filter,
      (now() at time zone 'America/Sao_Paulo')::date as today
  ),
  page as (
    select
      p.id,
      p.organization_id,
      p.code,
      p.title,
      p.neighborhood,
      p.city,
      p.state,
      p.purpose,
      p.type,
      p.status,
      p.sale_price,
      p.rent_price,
      p.imob_score,
      p.captured_by,
      p.broker_id,
      p.published_to_portals,
      p.updated_at,
      a.like_pattern,
      a.today,
      count(*) over () as total_count
    from public.properties p
    cross join args a
    where p.organization_id = p_organization_id
      and (p_status is null or p.status = p_status)
      and (p_type is null or p.type = p_type)
      -- "Venda" inclui venda e locação; idem "Locação".
      and (
        p_purpose is null
        or (p_purpose = 'sale' and p.purpose in ('sale', 'sale_rent'))
        or (p_purpose = 'rent' and p.purpose in ('rent', 'sale_rent'))
        or (p_purpose = 'sale_rent' and p.purpose = 'sale_rent')
      )
      and (p_min_bedrooms is null or coalesce(p.bedrooms, 0) >= p_min_bedrooms)
      and (
        (p_min_price is null and p_max_price is null)
        or case p_purpose
             when 'sale' then
               (p_min_price is null or p.sale_price >= p_min_price)
               and (p_max_price is null or p.sale_price <= p_max_price)
             when 'rent' then
               (p_min_price is null or p.rent_price >= p_min_price)
               and (p_max_price is null or p.rent_price <= p_max_price)
             else
               (
                 (p_min_price is null or p.sale_price >= p_min_price)
                 and (p_max_price is null or p.sale_price <= p_max_price)
               )
               or (
                 (p_min_price is null or p.rent_price >= p_min_price)
                 and (p_max_price is null or p.rent_price <= p_max_price)
               )
           end
      )
      -- Autorização: só imóveis em carteira (rascunho, ativo, reservado).
      and (
        a.auth_filter is null
        or (
          private.authorization_tracked_status(p.status)
          and (
            select s.state
            from private.listing_authorization_state(p.organization_id, p.id, a.today) s
          ) = a.auth_filter
        )
      )
      and (
        a.like_pattern is null
        or private.property_search_text(
             p.code, p.title, p.street, p.street_number, p.neighborhood, p.city, p.state
           ) like a.like_pattern escape '\'
        -- Proprietário: só casa se o RLS de clients deixar o usuário ver o nome.
        or exists (
          select 1
          from public.property_owners po
          join public.clients c
            on c.organization_id = po.organization_id
           and c.id = po.client_id
          where po.organization_id = p.organization_id
            and po.property_id = p.id
            and private.search_normalize(c.name) like a.like_pattern escape '\'
        )
      )
    order by p.updated_at desc, p.code desc
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    page.id,
    page.code,
    page.title,
    page.neighborhood,
    page.city,
    page.state,
    page.purpose,
    page.type,
    page.status,
    page.sale_price,
    page.rent_price,
    page.imob_score,
    page.captured_by,
    page.broker_id,
    page.published_to_portals,
    cover.storage_path,
    owner_hit.name,
    page.total_count,
    auth_state.state,
    auth_state.ends_on
  from page
  left join lateral (
    select m.storage_path
    from public.property_media m
    where m.organization_id = page.organization_id
      and m.property_id = page.id
      and m.kind = 'image'
    order by m.is_cover desc, m.position, m.created_at
    limit 1
  ) cover on true
  left join lateral (
    select c.name
    from public.property_owners po
    join public.clients c
      on c.organization_id = po.organization_id
     and c.id = po.client_id
    where page.like_pattern is not null
      and po.organization_id = page.organization_id
      and po.property_id = page.id
      and private.search_normalize(c.name) like page.like_pattern escape '\'
    order by c.name
    limit 1
  ) owner_hit on true
  left join lateral private.listing_authorization_state(
    page.organization_id, page.id, page.today
  ) auth_state on true
  order by page.updated_at desc, page.code desc;
$$;

comment on function public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer, text
) is
  'Lista de imóveis com filtros, busca por texto e por proprietário, capa, total e situação da autorização. p_authorization: expiring (vence em até 30 dias) ou expired (vencida), só para imóveis em carteira. security invoker: o RLS decide o que aparece.';

revoke all on function public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer, text
) from public, anon;
grant execute on function public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer, text
) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Painel: imóveis com autorização vencendo (e quantos já venceram)
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_authorization_alerts(
  p_organization_id uuid,
  p_limit integer default 5
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'America/Sao_Paulo')::date as d
  ),
  carteira as (
    select
      p.id,
      p.code,
      p.title,
      p.neighborhood,
      p.city,
      p.status,
      s.state,
      s.ends_on,
      s.exclusive,
      (s.ends_on - t.d) as days_left
    from public.properties p
    cross join today t
    cross join lateral private.listing_authorization_state(p.organization_id, p.id, t.d) s
    where p.organization_id = p_organization_id
      and private.authorization_tracked_status(p.status)
  )
  select jsonb_build_object(
    'expiring_total', (select count(*) from carteira where state = 'expiring'),
    'expired_total', (select count(*) from carteira where state = 'expired'),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'property_id', x.id,
            'code', x.code,
            'title', x.title,
            'neighborhood', x.neighborhood,
            'city', x.city,
            'status', x.status,
            'ends_on', x.ends_on,
            'days_left', x.days_left,
            'exclusive', x.exclusive
          )
          order by x.ends_on, x.code
        )
        from (
          select *
          from carteira
          where state = 'expiring'
          order by ends_on, code
          limit least(greatest(coalesce(p_limit, 5), 1), 20)
        ) x
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.dashboard_authorization_alerts(uuid, integer) is
  'Cartão do Painel: total de imóveis em carteira com autorização vencendo (até 30 dias) e vencida, e os que vencem primeiro. security invoker: o RLS decide o que entra na conta.';

revoke all on function public.dashboard_authorization_alerts(uuid, integer) from public, anon;
grant execute on function public.dashboard_authorization_alerts(uuid, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Controle dos avisos por e-mail (schema private: fora da API)
-- -----------------------------------------------------------------------------
-- Marco do dia: o menor de 30, 15, 7 e 1 que ainda cobre os dias que faltam.
-- Assim um dia sem cron não perde o marco, e nenhum marco se repete.
create or replace function private.authorization_alert_milestone(p_days_left integer)
returns smallint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_days_left is null or p_days_left < 0 then null
    when p_days_left <= 1 then 1
    when p_days_left <= 7 then 7
    when p_days_left <= 15 then 15
    when p_days_left <= 30 then 30
  end::smallint;
$$;

comment on function private.authorization_alert_milestone(integer) is
  'Marco do aviso de autorização para os dias que faltam: 30, 15, 7 ou 1 (null fora da janela ou já vencida).';

revoke all on function private.authorization_alert_milestone(integer) from public, anon, authenticated;

create table if not exists private.authorization_alert_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  -- Último dia coberto quando o aviso nasceu: renovar (nova data) abre novos marcos.
  ends_on date not null,
  milestone smallint not null
    constraint authorization_alert_notifications_milestone_check
      check (milestone in (30, 15, 7, 1)),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts smallint not null default 0,
  constraint authorization_alert_notifications_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  constraint authorization_alert_notifications_once unique (property_id, ends_on, milestone, user_id)
);

create index if not exists authorization_alert_notifications_pending_idx
  on private.authorization_alert_notifications (created_at)
  where sent_at is null;
create index if not exists authorization_alert_notifications_organization_property_idx
  on private.authorization_alert_notifications (organization_id, property_id);
create index if not exists authorization_alert_notifications_user_id_idx
  on private.authorization_alert_notifications (user_id);

comment on table private.authorization_alert_notifications is
  'Avisos de autorização vencendo por e-mail: uma linha por imóvel, data final, marco (30, 15, 7, 1) e destinatário. A chave única garante um aviso por marco. Drenada por public.claim_authorization_alerts; linhas de autorizações vencidas há mais de 30 dias são apagadas na própria drenagem.';

alter table private.authorization_alert_notifications enable row level security;
revoke all on table private.authorization_alert_notifications from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. RPCs do cron (chave do servidor; só anon executa)
-- -----------------------------------------------------------------------------
create or replace function public.claim_authorization_alerts(
  p_server_key text,
  p_limit integer default 200
)
returns table (
  id uuid,
  organization_id uuid,
  organization_slug text,
  organization_name text,
  brand_color text,
  property_id uuid,
  property_code text,
  property_title text,
  property_neighborhood text,
  property_city text,
  property_state text,
  ends_on date,
  days_left integer,
  milestone smallint,
  exclusive boolean,
  recipient_user_id uuid,
  recipient_email text,
  recipient_name text,
  recipient_is_manager boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform private.check_notification_server_key(p_server_key);

  -- Limpeza: marcos de autorizações que já passaram e pendências velhas (um
  -- marco ainda válido volta a ser enfileirado logo abaixo).
  delete from private.authorization_alert_notifications n
  where n.ends_on < v_today - 30
     or (n.sent_at is null and n.created_at < now() - interval '3 days');

  -- Enfileira o marco do dia de cada imóvel em carteira com autorização vencendo,
  -- para o captador, o corretor e os donos e gerentes ativos. Idempotente.
  insert into private.authorization_alert_notifications (
    organization_id, property_id, ends_on, milestone, user_id
  )
  select distinct c.organization_id, c.property_id, c.ends_on, c.milestone, m.user_id
  from (
    select
      p.organization_id,
      p.id as property_id,
      p.captured_by,
      p.broker_id,
      s.ends_on,
      private.authorization_alert_milestone(s.ends_on - v_today) as milestone
    from (
      select distinct a.organization_id, a.property_id
      from public.listing_authorizations a
      where a.ends_on between v_today and v_today + 30
    ) candidato
    join public.properties p
      on p.organization_id = candidato.organization_id
     and p.id = candidato.property_id
    cross join lateral private.listing_authorization_state(p.organization_id, p.id, v_today) s
    where private.authorization_tracked_status(p.status)
      and s.state = 'expiring'
      and private.billing_state(p.organization_id) <> 'read_only'
  ) c
  join public.memberships m
    on m.organization_id = c.organization_id
   and m.active
   and (
     m.role in ('owner', 'manager')
     or m.user_id = c.captured_by
     or m.user_id = c.broker_id
   )
  where c.milestone is not null
  on conflict on constraint authorization_alert_notifications_once do nothing;

  return query
  with escolhidos as (
    select n.id
    from private.authorization_alert_notifications n
    join public.properties p
      on p.organization_id = n.organization_id
     and p.id = n.property_id
    join auth.users u on u.id = n.user_id
    cross join lateral private.listing_authorization_state(n.organization_id, n.property_id, v_today) s
    where n.sent_at is null
      and (n.claimed_at is null or n.claimed_at < now() - interval '15 minutes')
      and n.attempts < 5
      -- O marco ainda vale hoje: nada de avisar autorização renovada ou imóvel vendido.
      and private.authorization_tracked_status(p.status)
      and s.state = 'expiring'
      and s.ends_on = n.ends_on
      and private.authorization_alert_milestone(s.ends_on - v_today) = n.milestone
      and u.email is not null
      and u.email_confirmed_at is not null
      and exists (
        select 1
        from public.memberships m
        where m.organization_id = n.organization_id
          and m.user_id = n.user_id
          and m.active
      )
    order by n.organization_id, n.user_id, n.ends_on, n.created_at
    limit v_limit
    for update of n skip locked
  ),
  reivindicados as (
    update private.authorization_alert_notifications n
    set claimed_at = now(),
        attempts = n.attempts + 1
    from escolhidos e
    where n.id = e.id
    returning n.id, n.organization_id, n.property_id, n.ends_on, n.milestone, n.user_id
  )
  select
    r.id,
    r.organization_id,
    o.slug::text,
    o.name,
    o.brand ->> 'primary_color',
    r.property_id,
    p.code,
    p.title,
    p.neighborhood,
    p.city,
    p.state,
    r.ends_on,
    (r.ends_on - v_today)::integer,
    r.milestone,
    s.exclusive,
    r.user_id,
    u.email::text,
    nullif(btrim(pr.full_name), ''),
    exists (
      select 1
      from public.memberships m
      where m.organization_id = r.organization_id
        and m.user_id = r.user_id
        and m.active
        and m.role in ('owner', 'manager')
    )
  from reivindicados r
  join public.organizations o on o.id = r.organization_id
  join public.properties p
    on p.organization_id = r.organization_id
   and p.id = r.property_id
  join auth.users u on u.id = r.user_id
  left join public.profiles pr on pr.id = r.user_id
  cross join lateral private.listing_authorization_state(r.organization_id, r.property_id, v_today) s
  order by r.organization_id, r.user_id, r.ends_on;
end;
$$;

comment on function public.claim_authorization_alerts(text, integer) is
  'Cron diário: enfileira o marco do dia (30, 15, 7 ou 1 dia) dos imóveis em carteira com autorização vencendo e reserva os avisos pendentes (um por imóvel, marco e destinatário). Todo id devolvido precisa voltar em settle_authorization_alerts. Exige a chave do servidor.';

revoke all on function public.claim_authorization_alerts(text, integer) from public, anon, authenticated;
grant execute on function public.claim_authorization_alerts(text, integer) to anon;

create or replace function public.settle_authorization_alerts(
  p_server_key text,
  p_sent uuid[] default '{}'::uuid[],
  p_failed uuid[] default '{}'::uuid[],
  p_released uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent integer := 0;
  v_failed integer := 0;
  v_released integer := 0;
begin
  perform private.check_notification_server_key(p_server_key);

  update private.authorization_alert_notifications n
  set sent_at = now(), claimed_at = coalesce(n.claimed_at, now())
  where n.id = any (coalesce(p_sent, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_sent = row_count;

  -- Falhou no envio: volta para a fila (até 5 tentativas).
  update private.authorization_alert_notifications n
  set claimed_at = null
  where n.id = any (coalesce(p_failed, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_failed = row_count;

  -- Nem foi tentado (limite de envios da execução): devolve sem gastar tentativa.
  update private.authorization_alert_notifications n
  set claimed_at = null,
      attempts = greatest(n.attempts - 1, 0)
  where n.id = any (coalesce(p_released, '{}'::uuid[]))
    and n.sent_at is null
    and n.claimed_at is not null;
  get diagnostics v_released = row_count;

  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'released', v_released);
end;
$$;

comment on function public.settle_authorization_alerts(text, uuid[], uuid[], uuid[]) is
  'Cron diário: confirma os avisos de autorização enviados, devolve os que falharam (conta tentativa) e os que nem foram tentados (não conta). Exige a chave do servidor.';

revoke all on function public.settle_authorization_alerts(text, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.settle_authorization_alerts(text, uuid[], uuid[], uuid[]) to anon;
