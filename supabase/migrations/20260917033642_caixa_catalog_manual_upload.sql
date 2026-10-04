-- =============================================================================
-- Imóveis da Caixa: envio manual da lista oficial
-- =============================================================================
-- O download automático do Lista_imoveis_geral.csv recebe 403: o site da Caixa
-- tem proteção anti-robô, e ela não é contornada. A partir daqui a lista é
-- baixada no navegador por uma pessoa da equipe da plataforma e enviada em
-- /plataforma/caixa. A gravação continua a MESMA (ingest_caixa_listings +
-- finish_caixa_sync, com a chave do servidor, nunca service_role). Esta
-- migração só:
--
--  1. registra a ORIGEM de cada evento em caixa_sync_events
--     (download_automatico | envio_manual). As linhas antigas vieram todas do
--     download automático, que é o default;
--  2. faz finish_caixa_sync recusar o fechamento (40001) quando OUTRA carga
--     gravou imóveis depois que esta começou. Com envio manual, dois envios ao
--     mesmo tempo passam a ser possíveis, e o fechamento de um marcaria como
--     "saiu da lista" o que o outro acabou de gravar. Recusando, nada é
--     marcado e o catálogo anterior continua valendo; basta enviar de novo.

-- -----------------------------------------------------------------------------
-- 1. Origem do evento
-- -----------------------------------------------------------------------------
-- Default constante: em Postgres 11+ a coluna nova não reescreve a tabela.
alter table public.caixa_sync_events
  add column origem text not null default 'download_automatico'
    constraint caixa_sync_events_origem_check
    check (origem in ('download_automatico', 'envio_manual'));

comment on column public.caixa_sync_events.origem is
  'De onde veio o arquivo: download_automatico (rotina que baixava do site da Caixa, hoje bloqueada pela proteção anti-robô) ou envio_manual (arquivo baixado no navegador e enviado pela equipe da plataforma em /plataforma/caixa).';

-- -----------------------------------------------------------------------------
-- 2. Verificação que não mudou nada (ou falhou), agora com a origem
-- -----------------------------------------------------------------------------
-- Parâmetro novo no fim e com default: as chamadas existentes continuam
-- valendo. Drop antes do create para não sobrar a assinatura antiga como
-- sobrecarga (a chamada com 6 argumentos ficaria ambígua).
drop function if exists public.record_caixa_check(text, text, text, text, text, text);

create function public.record_caixa_check(
  p_server_key text,
  p_result text,
  p_source_last_modified text default null,
  p_source_etag text default null,
  p_source_digest text default null,
  p_failure_reason text default null,
  p_origem text default 'download_automatico'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_checks integer;
begin
  if not private.caixa_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_result is null or p_result not in ('not_modified', 'unchanged', 'falha') then
    raise exception 'Resultado inválido.' using errcode = '22023';
  end if;

  if p_origem is null or p_origem not in ('download_automatico', 'envio_manual') then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;

  update public.caixa_catalog_status s
  set last_checked_at = now(),
      last_result = p_result,
      checks_since_change = s.checks_since_change + 1,
      -- Falha não muda o que sabemos da origem nem apaga nada: o catálogo
      -- anterior continua valendo até a próxima carga.
      source_last_modified = case
        when p_result = 'falha' then s.source_last_modified
        else coalesce(left(p_source_last_modified, 120), s.source_last_modified)
      end,
      source_etag = case
        when p_result = 'falha' then s.source_etag
        else coalesce(left(p_source_etag, 200), s.source_etag)
      end,
      source_digest = case
        when p_result = 'falha' then s.source_digest
        else coalesce(p_source_digest, s.source_digest)
      end,
      last_failure_at = case when p_result = 'falha' then now() else s.last_failure_at end,
      last_failure_reason = case
        when p_result = 'falha' then left(coalesce(p_failure_reason, 'desconhecido'), 120)
        else s.last_failure_reason
      end,
      atualizado_em = now()
  where s.singleton
  returning s.checks_since_change into v_checks;

  if p_result = 'falha' then
    insert into public.caixa_sync_events (resultado, verificacoes, motivo, origem)
    values ('falha', v_checks, left(coalesce(p_failure_reason, 'desconhecido'), 120), p_origem);
  end if;

  return jsonb_build_object('checks_since_change', coalesce(v_checks, 0));
end;
$$;

comment on function public.record_caixa_check(text, text, text, text, text, text, text) is
  'Servidor Next (chave publishable + CAIXA_SERVER_KEY): registra uma verificação que NÃO mudou o catálogo — 304 (not_modified), arquivo idêntico ao da última carga (unchanged) ou erro (falha, que vira evento em caixa_sync_events com a origem: download_automatico ou envio_manual). Nunca apaga nem altera imóvel.';

revoke all on function public.record_caixa_check(text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_caixa_check(text, text, text, text, text, text, text)
  to anon;

-- -----------------------------------------------------------------------------
-- 3. Fechamento da carga: origem e proteção contra cargas simultâneas
-- -----------------------------------------------------------------------------
drop function if exists public.finish_caixa_sync(text, uuid, date, integer, text, text, text);

create function public.finish_caixa_sync(
  p_server_key text,
  p_sync_id uuid,
  p_generated_on date default null,
  p_rejected integer default 0,
  p_source_last_modified text default null,
  p_source_etag text default null,
  p_source_digest text default null,
  p_origem text default 'download_automatico'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Piso de segurança: o arquivo nacional tem ~8.100 imóveis. Carga menor que
  -- isso é sinal de arquivo truncado (ou trocado), e marcar milhares de imóveis
  -- como "saiu da lista" por causa dele seria pior que não atualizar.
  v_min_listings constant integer := 1000;
  v_seen integer;
  v_started_at timestamptz;
  v_delisted integer;
  v_total integer;
  v_checks integer;
begin
  if not private.caixa_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_sync_id is null then
    raise exception 'Informe a carga (p_sync_id).' using errcode = '22023';
  end if;

  if p_origem is null or p_origem not in ('download_automatico', 'envio_manual') then
    raise exception 'Origem inválida.' using errcode = '22023';
  end if;

  -- atualizado_em é o now() da transação de cada lote: o menor valor desta
  -- carga é quando o primeiro lote dela foi gravado.
  select count(*), min(l.atualizado_em)
  into v_seen, v_started_at
  from public.caixa_listings l
  where l.sincronizacao_id = p_sync_id;

  if v_seen < v_min_listings then
    raise exception 'Carga incompleta (% imóveis): o catálogo anterior foi preservado.', v_seen
      using errcode = '22023';
  end if;

  -- Outra carga gravou imóveis depois que esta começou (dois envios ao mesmo
  -- tempo). Fechar agora marcaria como "saiu da lista" o que a outra acabou de
  -- gravar: recusa sem marcar nada, e o próximo envio refaz a carga inteira.
  if exists (
    select 1
    from public.caixa_listings l
    where l.sincronizacao_id <> p_sync_id
      and l.atualizado_em > v_started_at
  ) then
    raise exception 'Outra carga do catálogo gravou imóveis durante esta: nada foi marcado como fora da lista.'
      using errcode = '40001';
  end if;

  update public.caixa_listings l
  set saiu_da_lista_em = now()
  where l.sincronizacao_id <> p_sync_id
    and l.saiu_da_lista_em is null;

  get diagnostics v_delisted = row_count;

  select count(*) into v_total
  from public.caixa_listings l
  where l.saiu_da_lista_em is null;

  select s.checks_since_change into v_checks
  from public.caixa_catalog_status s
  where s.singleton;

  update public.caixa_catalog_status s
  set lista_gerada_em = coalesce(p_generated_on, s.lista_gerada_em),
      sincronizado_em = now(),
      last_checked_at = now(),
      last_changed_at = now(),
      last_result = 'ok',
      checks_since_change = 0,
      source_last_modified = coalesce(left(p_source_last_modified, 120), s.source_last_modified),
      source_etag = coalesce(left(p_source_etag, 200), s.source_etag),
      source_digest = coalesce(p_source_digest, s.source_digest),
      total_ativo = v_total,
      ultima_carga_total = v_seen,
      ultima_carga_recusada = greatest(coalesce(p_rejected, 0), 0),
      ultima_carga_saiu = v_delisted,
      atualizado_em = now()
  where s.singleton;

  insert into public.caixa_sync_events (
    resultado, source_last_modified, lista_gerada_em, total, sairam, recusados, verificacoes, origem
  )
  values (
    'ok', left(p_source_last_modified, 120), p_generated_on, v_total, v_delisted,
    greatest(coalesce(p_rejected, 0), 0), coalesce(v_checks, 0), p_origem
  );

  return jsonb_build_object(
    'seen', v_seen,
    'delisted', v_delisted,
    'total', v_total,
    'checks_since_change', coalesce(v_checks, 0)
  );
end;
$$;

comment on function public.finish_caixa_sync(text, uuid, date, integer, text, text, text, text) is
  'Servidor Next (chave publishable + CAIXA_SERVER_KEY): fecha a carga do catálogo da Caixa. Marca saiu_da_lista_em em quem não apareceu na carga, grava public.caixa_catalog_status (inclusive Last-Modified/ETag/SHA-256 da origem) e registra a mudança em caixa_sync_events com a origem (download_automatico ou envio_manual). Recusa (22023) carga com menos de 1.000 imóveis e (40001) carga durante a qual outra gravou imóveis. Nunca apaga linha.';

revoke all on function public.finish_caixa_sync(text, uuid, date, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_caixa_sync(text, uuid, date, integer, text, text, text, text)
  to anon;
