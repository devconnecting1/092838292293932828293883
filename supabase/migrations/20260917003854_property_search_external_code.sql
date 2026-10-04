-- =============================================================================
-- Busca de imóveis pelo código do sistema anterior (properties.external_code)
-- =============================================================================
--  1. private.property_search_text ganha o código externo (nova assinatura,
--     com 8 argumentos)
--  2. properties_search_idx é recriado com a nova expressão
--  3. search_properties e search_crm passam a usar a nova expressão (mesmo
--     corpo de antes; na busca global o código externo exato sobe para o topo)
--  4. A versão de 7 argumentos sai
--
-- Por que: a importação de planilhas grava o código que o imóvel tinha no
-- sistema anterior (AP-001, 12345…) em properties.external_code, e é por esse
-- código que a equipe ainda procura o imóvel nas primeiras semanas. A lista de
-- imóveis e a busca do cabeçalho não o encontravam.

-- -----------------------------------------------------------------------------
-- 1. Texto de busca com o código externo
-- -----------------------------------------------------------------------------
create or replace function private.property_search_text(
  p_code text,
  p_title text,
  p_street text,
  p_street_number text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_external_code text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select private.search_normalize(
    concat_ws(
      ' ',
      p_code,
      -- IMV-000123 também encontra por "123".
      nullif(ltrim(replace(coalesce(p_code, ''), 'IMV-', ''), '0'), ''),
      -- Código do sistema anterior (importação de planilhas).
      p_external_code,
      p_title,
      p_street,
      p_street_number,
      p_neighborhood,
      p_city,
      p_state
    )
  );
$$;

comment on function private.property_search_text(text, text, text, text, text, text, text, text) is
  'Texto normalizado do imóvel para a busca (código, número do código, código do sistema anterior, título e endereço). Usada no índice properties_search_idx, em public.search_properties e em public.search_crm.';

revoke all on function private.property_search_text(text, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function private.property_search_text(text, text, text, text, text, text, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Índice com a nova expressão
-- -----------------------------------------------------------------------------
drop index if exists public.properties_search_idx;

create index properties_search_idx
  on public.properties
  using gin (
    private.property_search_text(
      code, title, street, street_number, neighborhood, city, state, external_code
    )
    extensions.gin_trgm_ops
  );

-- -----------------------------------------------------------------------------
-- 3.1 search_properties (só a expressão de busca muda)
-- -----------------------------------------------------------------------------
create or replace function public.search_properties(
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
             p.code, p.title, p.street, p.street_number, p.neighborhood, p.city, p.state,
             p.external_code
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
  'Lista de imóveis com filtros, busca por texto (código, código do sistema anterior, título e endereço) e por proprietário, capa, total e situação da autorização. p_authorization: expiring (vence em até 30 dias) ou expired (vencida), só para imóveis em carteira. security invoker: o RLS decide o que aparece.';

-- -----------------------------------------------------------------------------
-- 3.2 search_crm (expressão de busca + código externo exato no topo)
-- -----------------------------------------------------------------------------
create or replace function public.search_crm(
  p_organization_id uuid,
  p_term text,
  p_limit integer default 5
)
returns table (
  entity text,
  id uuid,
  title text,
  code text,
  phone text,
  status text,
  place text
)
language sql
stable
set search_path = ''
as $$
  with args as (
    select
      private.search_like_term(p_term) as term,
      private.search_normalize(btrim(coalesce(p_term, ''))) as normalized,
      regexp_replace(coalesce(p_term, ''), '[^0-9]', '', 'g') as digits,
      least(greatest(coalesce(p_limit, 5), 1), 10) as max_rows
  ),
  valid as (
    select
      a.normalized,
      a.digits,
      a.max_rows,
      '%' || a.term || '%' as like_pattern,
      a.term || '%' as prefix_pattern,
      case when length(a.digits) >= 4 then '%' || a.digits || '%' end as phone_pattern
    from args a
    where char_length(a.normalized) >= 2
  ),
  hits as (
    (
      select
        1 as group_order,
        'client'::text as entity,
        c.id,
        c.name as title,
        null::text as code,
        coalesce(c.whatsapp, c.phone) as phone,
        c.kind::text as status,
        null::text as place,
        case when private.search_normalize(c.name) like v.prefix_pattern escape '\' then 0 else 1 end
          as match_rank,
        c.updated_at
      from public.clients c
      cross join valid v
      where c.organization_id = p_organization_id
        and (
          private.search_normalize(c.name) like v.like_pattern escape '\'
          or private.search_normalize(c.trade_name) like v.like_pattern escape '\'
          or (
            v.phone_pattern is not null
            and (
              regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like v.phone_pattern
              or regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g') like v.phone_pattern
            )
          )
        )
      order by match_rank, c.updated_at desc, c.id
      limit (select max_rows from valid)
    )
    union all
    (
      select
        2 as group_order,
        'lead'::text as entity,
        l.id,
        l.name as title,
        null::text as code,
        l.phone,
        l.stage::text as status,
        null::text as place,
        case when private.search_normalize(l.name) like v.prefix_pattern escape '\' then 0 else 1 end
          as match_rank,
        l.updated_at
      from public.leads l
      cross join valid v
      where l.organization_id = p_organization_id
        and (
          private.search_normalize(l.name) like v.like_pattern escape '\'
          or (v.phone_pattern is not null and l.phone like v.phone_pattern)
        )
      order by match_rank, l.updated_at desc, l.id
      limit (select max_rows from valid)
    )
    union all
    (
      select
        3 as group_order,
        'property'::text as entity,
        p.id,
        p.title,
        p.code,
        null::text as phone,
        p.status::text as status,
        nullif(concat_ws(', ', p.neighborhood, p.city), '') as place,
        case
          when lower(p.code) = v.normalized then 0
          when v.normalized ~ '^[0-9]+$'
            and ltrim(replace(p.code, 'IMV-', ''), '0') = ltrim(v.digits, '0') then 0
          when private.search_normalize(p.external_code) = v.normalized then 0
          when private.search_normalize(p.title) like v.prefix_pattern escape '\' then 0
          else 1
        end as match_rank,
        p.updated_at
      from public.properties p
      cross join valid v
      where p.organization_id = p_organization_id
        and private.property_search_text(
              p.code, p.title, p.street, p.street_number, p.neighborhood, p.city, p.state,
              p.external_code
            ) like v.like_pattern escape '\'
      order by match_rank, p.updated_at desc, p.code desc
      limit (select max_rows from valid)
    )
  )
  select h.entity, h.id, h.title, h.code, h.phone, h.status, h.place
  from hits h
  order by h.group_order, h.match_rank, h.updated_at desc;
$$;

comment on function public.search_crm(uuid, text, integer) is
  'Busca única do cabeçalho do CRM: clientes (nome e nome fantasia sem acento, telefone/WhatsApp por 4+ dígitos), leads (nome sem acento, telefone por 4+ dígitos) e imóveis (código IMV-000123 ou 123, código do sistema anterior, título e endereço). Até p_limit (1-10, padrão 5) por tipo; termo com menos de 2 caracteres não devolve nada. entity: client, lead ou property; status: tipo do cliente (pf/pj), etapa do lead ou situação do imóvel. Security invoker: respeita o RLS de clients, leads e properties.';

-- -----------------------------------------------------------------------------
-- 4. A versão antiga (7 argumentos) não tem mais quem a use
-- -----------------------------------------------------------------------------
drop function private.property_search_text(text, text, text, text, text, text, text);
