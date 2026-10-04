-- =============================================================================
-- Lista de imóveis: selo "Restrito" (search_properties devolve is_restricted)
-- =============================================================================
-- A ficha do imóvel já mostra o selo "Restrito" (sigilo, migração
-- property_restricted_access), mas a lista de imóveis não sabia quais estavam
-- em sigilo. search_properties passa a devolver is_restricted.
--
-- O tipo de retorno ganha uma coluna (no fim), então a função é recriada com o
-- mesmo corpo, os mesmos parâmetros, o mesmo comentário (atualizado) e os
-- mesmos grants. Continua security invoker: o RLS de properties decide o que
-- aparece, e quem não vê um imóvel restrito continua sem recebê-lo.

drop function if exists public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer, text
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
  authorization_ends_on date,
  is_restricted boolean
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
      p.is_restricted,
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
    auth_state.ends_on,
    page.is_restricted
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
  'Lista de imóveis com filtros, busca por texto (código, código do sistema anterior, título e endereço) e por proprietário, capa, total, situação da autorização e sigilo (is_restricted, para o selo "Restrito"). p_authorization: expiring (vence em até 30 dias) ou expired (vencida), só para imóveis em carteira. security invoker: o RLS decide o que aparece.';

revoke all on function public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer, text
) from public, anon;
grant execute on function public.search_properties(
  uuid, text, public.property_status, public.listing_purpose, public.property_type,
  numeric, numeric, integer, integer, integer, text
) to authenticated;
