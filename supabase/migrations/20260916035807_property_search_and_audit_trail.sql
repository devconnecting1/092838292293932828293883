-- =============================================================================
-- 1800 - Busca de imóveis (endereço e proprietário) e histórico de alterações
-- =============================================================================
--  1. pg_trgm + normalização imutável (private.search_normalize)
--  2. Índices de busca: properties (código, título, endereço) e clients (nome)
--  3. RPC search_properties: a lista de imóveis inteira no Postgres, com busca
--     por código, título, endereço e nome do proprietário
--  4. Índice para o histórico de alterações de documentos por cliente
--
-- A RPC é `security invoker` (o padrão): quem manda no resultado é o RLS de
-- `properties` e de `clients`, então um corretor só encontra pelo nome do
-- proprietário se ele já puder ver aquele cliente.

-- -----------------------------------------------------------------------------
-- 1. Normalização (minúsculas, sem acentos)
-- -----------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

-- `extensions.unaccent(text)` é STABLE (depende do dicionário), então não pode
-- entrar em índice. A forma de 2 argumentos fixa o dicionário no plano e é o
-- jeito recomendado de embrulhar a chamada numa função IMMUTABLE.
create or replace function private.search_normalize(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(value, '')));
$$;

comment on function private.search_normalize(text) is
  'Texto em minúsculas e sem acentos para busca (IMMUTABLE: serve em índice). Null vira string vazia.';

revoke all on function private.search_normalize(text) from public, anon;
grant execute on function private.search_normalize(text) to authenticated;

-- Texto de busca do imóvel: código (inteiro e só o número), título e endereço.
-- Sem o nome do proprietário: `properties` é lido por qualquer membro e o nome
-- do cliente é protegido por RLS (private.can_access_client_row).
create or replace function private.property_search_text(
  p_code text,
  p_title text,
  p_street text,
  p_street_number text,
  p_neighborhood text,
  p_city text,
  p_state text
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
      p_title,
      p_street,
      p_street_number,
      p_neighborhood,
      p_city,
      p_state
    )
  );
$$;

comment on function private.property_search_text(text, text, text, text, text, text, text) is
  'Texto normalizado do imóvel para a busca da lista (código, número do código, título e endereço). Usada no índice properties_search_idx e em public.search_properties.';

revoke all on function private.property_search_text(text, text, text, text, text, text, text)
  from public, anon;
grant execute on function private.property_search_text(text, text, text, text, text, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Índices de busca (trigrama: casa com "contém", não só com "começa com")
-- -----------------------------------------------------------------------------
create index properties_search_idx
  on public.properties
  using gin (
    private.property_search_text(code, title, street, street_number, neighborhood, city, state)
    extensions.gin_trgm_ops
  );

create index clients_name_search_idx
  on public.clients
  using gin (private.search_normalize(name) extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 3. search_properties
-- -----------------------------------------------------------------------------
-- Uma linha por imóvel da página pedida, já com a capa, o proprietário que casou
-- com a busca e o total de resultados (`total_count`, igual em todas as linhas).
-- Página além do total devolve zero linhas (o app trata como "página não existe").
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
  p_offset integer default 0
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
  total_count bigint
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
      end as like_pattern
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
    page.total_count
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
  order by page.updated_at desc, page.code desc;
$$;

comment on function public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer
) is
  'Lista de imóveis do CRM: filtros, paginação (p_limit 1-100, padrão 20) e busca por código (IMV-000123 ou 123), título, endereço (rua, número, bairro, cidade, UF) e nome do proprietário. Devolve a capa, o proprietário que casou com a busca (matched_owner) e total_count repetido em todas as linhas. Security invoker: respeita o RLS de properties e de clients (o nome do proprietário só casa para quem pode ver o cliente).';

revoke all on function public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer
) from public, anon;
grant execute on function public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer
) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Histórico de alterações: documentos por cliente
-- -----------------------------------------------------------------------------
-- A ficha do cliente junta os eventos de `clients` (por entity_id, já coberto
-- por audit_events_entity_idx) com os de `client_documents`, que só guardam o
-- cliente em metadata.client_id.
create index audit_events_client_documents_idx
  on public.audit_events (organization_id, (metadata ->> 'client_id'), created_at desc)
  where entity = 'client_documents';
