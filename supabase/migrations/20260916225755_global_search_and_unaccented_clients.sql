-- =============================================================================
-- Busca de clientes sem acento e busca única do cabeçalho do CRM
-- =============================================================================
--  1. private.search_like_term: termo normalizado (sem acento) e escapado para LIKE
--  2. public.search_clients: lista de clientes inteira no Postgres. "Joao" acha
--     "João" (nome, nome fantasia e e-mail), telefone e WhatsApp por dígitos em
--     qualquer formato e documento (CPF/CNPJ)
--  3. public.search_crm: busca única do cabeçalho (clientes, leads e imóveis) por
--     nome, telefone (só dígitos) e código do imóvel, agrupada e limitada por tipo
--  4. Índice de trigrama no nome do lead (o de clientes já existe:
--     clients_name_search_idx, migração 20260916035807)
--
-- As duas RPCs são `security invoker` (o padrão): quem manda no resultado é o
-- RLS de clients, leads e properties. O corretor só acha os clientes dele (ou
-- compartilhados) e os leads dele ou sem responsável; outra imobiliária, nada.

-- -----------------------------------------------------------------------------
-- 1. Termo de busca para LIKE
-- -----------------------------------------------------------------------------
create or replace function private.search_like_term(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    replace(
      replace(
        replace(private.search_normalize(btrim(coalesce(value, ''))), '\', '\\'),
        '%', '\%'
      ),
      '_', '\_'
    ),
    ''
  );
$$;

comment on function private.search_like_term(text) is
  'Termo de busca em minúsculas, sem acentos e com \, % e _ escapados (use com ESCAPE ''\''). Vazio ou só espaços vira null.';

revoke all on function private.search_like_term(text) from public, anon;
grant execute on function private.search_like_term(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. search_clients
-- -----------------------------------------------------------------------------
-- Uma linha por cliente da página pedida e o total (`total_count`, igual em
-- todas as linhas). Página além do total devolve zero linhas.
create or replace function public.search_clients(
  p_organization_id uuid,
  p_term text default null,
  p_kind public.client_kind default null,
  p_assigned_to uuid default null,
  p_unassigned boolean default false,
  p_source text default null,
  p_tag text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  kind public.client_kind,
  name text,
  trade_name text,
  document text,
  email text,
  phone text,
  whatsapp text,
  assigned_to uuid,
  source text,
  tags text[],
  created_at timestamptz,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with args as (
    select
      private.search_like_term(p_term) as term,
      regexp_replace(coalesce(p_term, ''), '[^0-9]', '', 'g') as digits,
      regexp_replace(upper(coalesce(p_term, '')), '[^0-9A-Z]', '', 'g') as alphanumeric
  ),
  patterns as (
    select
      case when a.term is null then null else '%' || a.term || '%' end as like_pattern,
      case when length(a.digits) >= 3 then '%' || a.digits || '%' end as digits_pattern,
      case
        when length(a.alphanumeric) >= 3 and a.alphanumeric ~ '[0-9]'
          then '%' || a.alphanumeric || '%'
      end as document_pattern
    from args a
  )
  select
    c.id,
    c.kind,
    c.name,
    c.trade_name,
    c.document,
    c.email,
    c.phone,
    c.whatsapp,
    c.assigned_to,
    c.source,
    c.tags,
    c.created_at,
    count(*) over () as total_count
  from public.clients c
  cross join patterns p
  where c.organization_id = p_organization_id
    and (p_kind is null or c.kind = p_kind)
    and (not coalesce(p_unassigned, false) or c.assigned_to is null)
    and (p_assigned_to is null or c.assigned_to = p_assigned_to)
    and (p_source is null or c.source = p_source)
    and (p_tag is null or c.tags @> array[p_tag])
    and (
      p.like_pattern is null
      or private.search_normalize(c.name) like p.like_pattern escape '\'
      or private.search_normalize(c.trade_name) like p.like_pattern escape '\'
      or private.search_normalize(c.email) like p.like_pattern escape '\'
      or (
        p.digits_pattern is not null
        and (
          regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like p.digits_pattern
          or regexp_replace(coalesce(c.whatsapp, ''), '[^0-9]', '', 'g') like p.digits_pattern
        )
      )
      or (p.document_pattern is not null and c.document like p.document_pattern)
    )
  order by c.created_at desc, c.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.search_clients(
  uuid, text, public.client_kind, uuid, boolean, text, text, integer, integer
) is
  'Lista de clientes do CRM: filtros (tipo, responsável ou sem responsável, origem, etiqueta), paginação (p_limit 1-100, padrão 20) e busca sem acento por nome, nome fantasia e e-mail, por telefone/WhatsApp (3+ dígitos, em qualquer formato) e por documento. total_count repetido em todas as linhas. Security invoker: respeita o RLS de clients.';

revoke all on function public.search_clients(
  uuid, text, public.client_kind, uuid, boolean, text, text, integer, integer
) from public, anon;
grant execute on function public.search_clients(
  uuid, text, public.client_kind, uuid, boolean, text, text, integer, integer
) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. search_crm (busca única do cabeçalho)
-- -----------------------------------------------------------------------------
-- Até p_limit (1-10, padrão 5) resultados por tipo, na ordem clientes, leads e
-- imóveis. Termo com menos de 2 caracteres não devolve nada. Quem começa com o
-- termo (ou o código exato) vem antes; depois, o mais recente.
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
          when private.search_normalize(p.title) like v.prefix_pattern escape '\' then 0
          else 1
        end as match_rank,
        p.updated_at
      from public.properties p
      cross join valid v
      where p.organization_id = p_organization_id
        and private.property_search_text(
              p.code, p.title, p.street, p.street_number, p.neighborhood, p.city, p.state
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
  'Busca única do cabeçalho do CRM: clientes (nome e nome fantasia sem acento, telefone/WhatsApp por 4+ dígitos), leads (nome sem acento, telefone por 4+ dígitos) e imóveis (código IMV-000123 ou 123, título e endereço). Até p_limit (1-10, padrão 5) por tipo; termo com menos de 2 caracteres não devolve nada. entity: client, lead ou property; status: tipo do cliente (pf/pj), etapa do lead ou situação do imóvel. Security invoker: respeita o RLS de clients, leads e properties.';

revoke all on function public.search_crm(uuid, text, integer) from public, anon;
grant execute on function public.search_crm(uuid, text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Índice de busca por nome do lead
-- -----------------------------------------------------------------------------
create index if not exists leads_name_search_idx
  on public.leads
  using gin (private.search_normalize(name) extensions.gin_trgm_ops);
