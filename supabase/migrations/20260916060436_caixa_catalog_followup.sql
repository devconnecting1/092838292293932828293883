-- =============================================================================
-- 2601 - Imóveis da Caixa: ajustes na carga
-- =============================================================================
--  1. `p_generated_on` passa a ter default null nas duas RPCs de escrita. A
--     data de geração vem da linha de título do arquivo e pode faltar; sem o
--     default, o tipo gerado em packages/database/src/types.ts obrigava a
--     mandar uma data que nem sempre existe.
--  2. A carga passa a respeitar a ORDEM do array: se o mesmo número vier
--     repetido no lote, vence a primeira ocorrência, como no leitor do CSV.
--     Antes, o `distinct on` sem desempate escolhia uma linha qualquer.
--  3. Elemento do array que não seja objeto JSON é recusado e contado, em vez
--     de derrubar a chamada inteira.

create or replace function public.ingest_caixa_listings(
  p_server_key text,
  p_sync_id uuid,
  p_generated_on date default null,
  p_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.caixa_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_sync_id is null then
    raise exception 'Informe a carga (p_sync_id).' using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Informe os imóveis em um array.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Envie no máximo 2.000 imóveis por chamada.' using errcode = '22023';
  end if;

  with raw as (
    select t.ord, t.elem
    from jsonb_array_elements(p_rows) with ordinality as t(elem, ord)
  ),
  objects as (
    select r.ord, r.elem
    from raw r
    where jsonb_typeof(r.elem) = 'object'
  ),
  input as (
    select o.ord, x.*
    from objects o
    cross join lateral jsonb_to_record(o.elem) as x(
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
      tipo text,
      area_total numeric,
      area_privativa numeric,
      area_terreno numeric,
      quartos numeric,
      vagas numeric
    )
  ),
  valid as (
    select distinct on (i.numero)
      i.numero,
      upper(btrim(i.uf)) as uf,
      left(btrim(i.cidade), 120) as cidade,
      nullif(left(btrim(coalesce(i.bairro, '')), 120), '') as bairro,
      left(btrim(i.endereco), 300) as endereco,
      round(i.preco, 2) as preco,
      case when i.valor_avaliacao >= 0 then round(i.valor_avaliacao, 2) end as valor_avaliacao,
      case when i.desconto between 0 and 100 then round(i.desconto, 2) end as desconto,
      i.aceita_financiamento,
      nullif(left(btrim(coalesce(i.descricao, '')), 1000), '') as descricao,
      nullif(left(btrim(coalesce(i.modalidade, '')), 80), '') as modalidade,
      i.link,
      case
        when i.tipo = any (enum_range(null::public.property_type)::text[])
          then i.tipo::public.property_type
        else 'other'::public.property_type
      end as tipo,
      case when i.area_total > 0 then round(i.area_total, 2) end as area_total,
      case when i.area_privativa > 0 then round(i.area_privativa, 2) end as area_privativa,
      case when i.area_terreno > 0 then round(i.area_terreno, 2) end as area_terreno,
      case when i.quartos between 1 and 999 then i.quartos::smallint end as quartos,
      case when i.vagas between 1 and 999 then i.vagas::smallint end as vagas
    from input i
    where i.numero ~ '^[0-9]{1,13}$'
      and upper(btrim(coalesce(i.uf, ''))) ~ '^[A-Z]{2}$'
      and btrim(coalesce(i.cidade, '')) <> ''
      and btrim(coalesce(i.endereco, '')) <> ''
      and i.preco >= 0
      and i.preco <= 999999999999.99
      and coalesce(i.valor_avaliacao, 0) <= 999999999999.99
      and coalesce(i.area_total, 0) <= 999999999999.99
      and coalesce(i.area_privativa, 0) <= 999999999999.99
      and coalesce(i.area_terreno, 0) <= 999999999999.99
      and i.link like 'https://venda-imoveis.caixa.gov.br/%'
      and i.link !~ '[[:space:][:cntrl:]]'
      and char_length(i.link) <= 300
    -- Número repetido no mesmo lote: vence a primeira ocorrência do array
    -- (mesma regra do leitor do CSV) e o on conflict nunca toca a mesma chave
    -- duas vezes na mesma instrução.
    order by i.numero, i.ord
  ),
  upserted as (
    insert into public.caixa_listings as l (
      numero, uf, cidade, bairro, endereco, preco, valor_avaliacao, desconto,
      aceita_financiamento, descricao, modalidade, link, tipo,
      area_total, area_privativa, area_terreno, quartos, vagas,
      lista_gerada_em, sincronizacao_id
    )
    select
      v.numero, v.uf, v.cidade, v.bairro, v.endereco, v.preco, v.valor_avaliacao, v.desconto,
      v.aceita_financiamento, v.descricao, v.modalidade, v.link, v.tipo,
      v.area_total, v.area_privativa, v.area_terreno, v.quartos, v.vagas,
      p_generated_on, p_sync_id
    from valid v
    on conflict (numero) do update set
      uf = excluded.uf,
      cidade = excluded.cidade,
      bairro = excluded.bairro,
      endereco = excluded.endereco,
      preco = excluded.preco,
      valor_avaliacao = excluded.valor_avaliacao,
      desconto = excluded.desconto,
      aceita_financiamento = excluded.aceita_financiamento,
      descricao = excluded.descricao,
      modalidade = excluded.modalidade,
      link = excluded.link,
      tipo = excluded.tipo,
      area_total = excluded.area_total,
      area_privativa = excluded.area_privativa,
      area_terreno = excluded.area_terreno,
      quartos = excluded.quartos,
      vagas = excluded.vagas,
      lista_gerada_em = coalesce(excluded.lista_gerada_em, l.lista_gerada_em),
      sincronizacao_id = excluded.sincronizacao_id,
      atualizado_em = now(),
      -- Imóvel que tinha sumido e voltou ao arquivo volta a ficar ativo.
      saiu_da_lista_em = null
    -- xmax = 0 só na linha recém-inserida; nas atualizadas vem o xid da transação.
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'received', (select count(*) from raw),
    'accepted', (select count(*) from valid),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'rejected', (select count(*) from raw) - (select count(*) from valid)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.ingest_caixa_listings(text, uuid, date, jsonb) is
  'Servidor Next (chave publishable + CAIXA_SERVER_KEY): grava um lote do Lista_imoveis_geral.csv em public.caixa_listings. Upsert por numero (número repetido no lote: vence a primeira ocorrência), linha inválida descartada e contada. Devolve {received, accepted, inserted, updated, rejected}.';

revoke all on function public.ingest_caixa_listings(text, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_caixa_listings(text, uuid, date, jsonb) to anon, authenticated;

create or replace function public.finish_caixa_sync(
  p_server_key text,
  p_sync_id uuid,
  p_generated_on date default null,
  p_rejected integer default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Piso de segurança: o arquivo nacional tem ~8.100 imóveis. Carga menor que
  -- isso é sinal de arquivo truncado, e marcar milhares de imóveis como "saiu
  -- da lista" por causa de um download pela metade seria pior que não atualizar.
  v_min_listings constant integer := 1000;
  v_seen integer;
  v_delisted integer;
  v_total integer;
begin
  if not private.caixa_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_sync_id is null then
    raise exception 'Informe a carga (p_sync_id).' using errcode = '22023';
  end if;

  select count(*) into v_seen
  from public.caixa_listings l
  where l.sincronizacao_id = p_sync_id;

  if v_seen < v_min_listings then
    raise exception 'Carga incompleta (% imóveis): o catálogo anterior foi preservado.', v_seen
      using errcode = '22023';
  end if;

  update public.caixa_listings l
  set saiu_da_lista_em = now()
  where l.sincronizacao_id <> p_sync_id
    and l.saiu_da_lista_em is null;

  get diagnostics v_delisted = row_count;

  select count(*) into v_total
  from public.caixa_listings l
  where l.saiu_da_lista_em is null;

  update public.caixa_catalog_status s
  set lista_gerada_em = coalesce(p_generated_on, s.lista_gerada_em),
      sincronizado_em = now(),
      total_ativo = v_total,
      ultima_carga_total = v_seen,
      ultima_carga_recusada = greatest(coalesce(p_rejected, 0), 0),
      ultima_carga_saiu = v_delisted,
      atualizado_em = now()
  where s.singleton;

  return jsonb_build_object(
    'seen', v_seen,
    'delisted', v_delisted,
    'total', v_total
  );
end;
$$;

revoke all on function public.finish_caixa_sync(text, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.finish_caixa_sync(text, uuid, date, integer) to anon, authenticated;
