-- =============================================================================
-- Portal público: leitura anônima do catálogo da Caixa
-- =============================================================================
-- O catálogo (public.caixa_listings) continua sem política para anon. O portal
-- público lê por três funções security definer que devolvem SÓ os campos do
-- arquivo oficial da Caixa (dado público) e SÓ imóveis ativos (que não saíram
-- da lista). Nada de favoritos, vínculos com clientes ou dados de imobiliária.
-- =============================================================================

create or replace function public.public_search_caixa_listings(
  p_term text default null,
  p_uf text default null,
  p_cidade text default null,
  p_bairro text default null,
  p_tipo public.property_type default null,
  p_modalidade text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_financiamento boolean default null,
  p_min_desconto numeric default null,
  p_sort text default 'desconto',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  numero text,
  uf text,
  cidade text,
  bairro text,
  endereco text,
  preco numeric,
  valor_avaliacao numeric,
  desconto numeric,
  aceita_financiamento boolean,
  descricao text,
  modalidade text,
  link text,
  tipo public.property_type,
  area_total numeric,
  area_privativa numeric,
  area_terreno numeric,
  quartos smallint,
  vagas smallint,
  lista_gerada_em date,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with args as (
    select
      case
        when nullif(btrim(coalesce(p_term, '')), '') is null then null
        else '%' || replace(replace(replace(private.search_normalize(left(btrim(p_term), 100)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as like_pattern,
      case
        when nullif(btrim(coalesce(p_bairro, '')), '') is null then null
        else '%' || replace(replace(replace(private.search_normalize(left(btrim(p_bairro), 120)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      end as bairro_pattern,
      case
        when coalesce(p_sort, 'desconto') in ('novidades', 'preco_asc', 'preco_desc', 'desconto')
          then coalesce(p_sort, 'desconto')
        else 'desconto'
      end as sort
  )
  select
    l.numero, l.uf, l.cidade, l.bairro, l.endereco, l.preco, l.valor_avaliacao,
    l.desconto, l.aceita_financiamento, l.descricao, l.modalidade, l.link, l.tipo,
    l.area_total, l.area_privativa, l.area_terreno, l.quartos, l.vagas,
    l.lista_gerada_em,
    count(*) over () as total_count
  from public.caixa_listings l
  cross join args a
  where l.saiu_da_lista_em is null
    and (p_uf is null or l.uf = upper(btrim(p_uf)))
    and (p_cidade is null or private.search_normalize(l.cidade) = private.search_normalize(btrim(p_cidade)))
    and (a.bairro_pattern is null or private.search_normalize(coalesce(l.bairro, '')) like a.bairro_pattern escape '\')
    and (p_tipo is null or l.tipo = p_tipo)
    and (p_modalidade is null or l.modalidade = p_modalidade)
    and (p_min_price is null or l.preco >= p_min_price)
    and (p_max_price is null or l.preco <= p_max_price)
    and (p_financiamento is null or l.aceita_financiamento is not distinct from p_financiamento)
    and (p_min_desconto is null or l.desconto >= p_min_desconto)
    and (
      a.like_pattern is null
      or private.caixa_search_text(l.numero, l.endereco, l.bairro, l.cidade, l.uf) like a.like_pattern escape '\'
    )
  order by
    case when a.sort = 'preco_asc' then l.preco end asc nulls last,
    case when a.sort = 'preco_desc' then l.preco end desc nulls last,
    case when a.sort = 'desconto' then l.desconto end desc nulls last,
    case when a.sort = 'novidades' then l.primeira_vez_em end desc nulls last,
    l.numero
  limit least(greatest(coalesce(p_limit, 24), 1), 48)
  offset least(greatest(coalesce(p_offset, 0), 0), 20000);
$$;

comment on function public.public_search_caixa_listings(
  text, text, text, text, public.property_type, text, numeric, numeric, boolean, numeric, text, integer, integer
) is 'Portal público: busca no catálogo da Caixa, só imóveis ativos e só campos do arquivo oficial. Security definer porque anon não tem política em caixa_listings.';

revoke all on function public.public_search_caixa_listings(
  text, text, text, text, public.property_type, text, numeric, numeric, boolean, numeric, text, integer, integer
) from public;
grant execute on function public.public_search_caixa_listings(
  text, text, text, text, public.property_type, text, numeric, numeric, boolean, numeric, text, integer, integer
) to anon, authenticated;


create or replace function public.public_get_caixa_listing(p_numero text)
returns table (
  numero text,
  uf text,
  cidade text,
  bairro text,
  endereco text,
  preco numeric,
  valor_avaliacao numeric,
  desconto numeric,
  aceita_financiamento boolean,
  descricao text,
  modalidade text,
  link text,
  tipo public.property_type,
  area_total numeric,
  area_privativa numeric,
  area_terreno numeric,
  quartos smallint,
  vagas smallint,
  lista_gerada_em date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.numero, l.uf, l.cidade, l.bairro, l.endereco, l.preco, l.valor_avaliacao,
    l.desconto, l.aceita_financiamento, l.descricao, l.modalidade, l.link, l.tipo,
    l.area_total, l.area_privativa, l.area_terreno, l.quartos, l.vagas,
    l.lista_gerada_em
  from public.caixa_listings l
  where l.numero = btrim(p_numero)
    and p_numero ~ '^\s*[0-9]{1,13}\s*$'
    and l.saiu_da_lista_em is null;
$$;

comment on function public.public_get_caixa_listing(text) is
  'Portal público: um imóvel ativo do catálogo da Caixa pelo número.';

revoke all on function public.public_get_caixa_listing(text) from public;
grant execute on function public.public_get_caixa_listing(text) to anon, authenticated;


create or replace function public.public_caixa_catalog_facets(p_uf text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.caixa_listings l where l.saiu_da_lista_em is null),
    'atualizado_em', (select max(l.lista_gerada_em) from public.caixa_listings l where l.saiu_da_lista_em is null),
    'ufs', coalesce((
      select jsonb_agg(jsonb_build_object('uf', t.uf, 'count', t.total) order by t.uf)
      from (
        select l.uf, count(*) as total
        from public.caixa_listings l
        where l.saiu_da_lista_em is null
        group by l.uf
      ) t
    ), '[]'::jsonb),
    'cidades', coalesce((
      select jsonb_agg(jsonb_build_object('cidade', t.cidade, 'count', t.total) order by t.cidade)
      from (
        select l.cidade, count(*) as total
        from public.caixa_listings l
        where l.saiu_da_lista_em is null
          and p_uf is not null
          and l.uf = upper(btrim(p_uf))
        group by l.cidade
      ) t
    ), '[]'::jsonb),
    'modalidades', coalesce((
      select jsonb_agg(jsonb_build_object('modalidade', t.modalidade, 'count', t.total) order by t.modalidade)
      from (
        select l.modalidade, count(*) as total
        from public.caixa_listings l
        where l.saiu_da_lista_em is null
          and l.modalidade is not null
        group by l.modalidade
      ) t
    ), '[]'::jsonb)
  );
$$;

comment on function public.public_caixa_catalog_facets(text) is
  'Portal público: total de imóveis ativos, data da lista e opções de filtro (UFs, cidades da UF, modalidades).';

revoke all on function public.public_caixa_catalog_facets(text) from public;
grant execute on function public.public_caixa_catalog_facets(text) to anon, authenticated;
