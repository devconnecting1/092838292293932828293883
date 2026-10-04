-- =============================================================================
-- 2602 - Imóveis da Caixa: verificação condicional a cada 30 minutos
-- =============================================================================
-- A carga deixa de ser "baixar 2,83 MB uma vez por dia" e passa a ser "perguntar
-- se mudou, a cada 30 minutos". O servidor da Caixa manda `Last-Modified`
-- (observado: `Wed, 16 Sep 2026 01:00:25 GMT`), então a requisição vai com
-- `If-Modified-Since` (e `If-None-Match`, se um ETag aparecer):
--
--   304 Not Modified -> não baixa, não analisa, não escreve. Só conta a verificação.
--   200 OK           -> baixa, valida e grava; registra o novo `Last-Modified`.
--
-- São 48 verificações por dia, quase todas de algumas centenas de bytes — menos
-- carga sobre a Caixa que um único download diário completo, e muito abaixo do
-- gatilho do bot manager (3 requisições em 60 s).
--
-- O estado também serve para APRENDER a cadência real em vez de supor: a
-- investigação observou um único ciclo de geração, então "diário" era estimativa.
-- `caixa_sync_events` guarda uma linha por mudança (e por falha), com quantas
-- verificações houve desde a mudança anterior.

-- -----------------------------------------------------------------------------
-- 1. Estado da verificação
-- -----------------------------------------------------------------------------
alter table public.caixa_catalog_status
  -- Toda verificação, inclusive as que não mudaram nada e as que falharam.
  add column last_checked_at timestamptz,
  -- Só quando o catálogo realmente mudou. É o "atualizado em" honesto da tela.
  add column last_changed_at timestamptz,
  add column last_result text
    constraint caixa_catalog_status_last_result_check
    check (last_result in ('ok', 'not_modified', 'unchanged', 'falha')),
  -- Cabeçalhos da última carga bem-sucedida, para a requisição condicional.
  add column source_last_modified text
    constraint caixa_catalog_status_last_modified_len check (char_length(source_last_modified) <= 120),
  add column source_etag text
    constraint caixa_catalog_status_etag_len check (char_length(source_etag) <= 200),
  -- SHA-256 do corpo: plano B quando a resposta vier sem Last-Modified.
  add column source_digest text
    constraint caixa_catalog_status_digest_format check (source_digest ~ '^[0-9a-f]{64}$'),
  add column checks_since_change integer not null default 0
    constraint caixa_catalog_status_checks_range check (checks_since_change >= 0),
  add column last_failure_at timestamptz,
  add column last_failure_reason text
    constraint caixa_catalog_status_failure_len check (char_length(last_failure_reason) <= 120);

comment on column public.caixa_catalog_status.last_changed_at is
  'Quando o catálogo mudou de verdade. É o que a tela mostra como "atualizado em" — last_checked_at só diz que perguntamos.';

comment on column public.caixa_catalog_status.source_last_modified is
  'Last-Modified da última carga bem-sucedida, mandado de volta como If-Modified-Since na verificação seguinte.';

-- -----------------------------------------------------------------------------
-- 2. Histórico: uma linha por mudança (e por falha), nunca por 304
-- -----------------------------------------------------------------------------
create table public.caixa_sync_events (
  id bigint generated always as identity primary key,
  ocorrido_em timestamptz not null default now(),
  resultado text not null
    constraint caixa_sync_events_resultado_check check (resultado in ('ok', 'falha')),
  source_last_modified text
    constraint caixa_sync_events_last_modified_len check (char_length(source_last_modified) <= 120),
  lista_gerada_em date,
  total integer,
  sairam integer,
  recusados integer,
  -- Verificações sem mudança desde a mudança anterior: com duas semanas disso,
  -- a periodicidade real do arquivo deixa de ser palpite.
  verificacoes integer,
  motivo text constraint caixa_sync_events_motivo_len check (char_length(motivo) <= 120)
);

comment on table public.caixa_sync_events is
  'Histórico da sincronização do catálogo da Caixa: uma linha quando o arquivo mudou e uma quando a verificação falhou. As respostas 304 (nada mudou) só incrementam caixa_catalog_status.checks_since_change.';

create index caixa_sync_events_ocorrido_idx on public.caixa_sync_events (ocorrido_em desc);

alter table public.caixa_sync_events enable row level security;

create policy "caixa_sync_events: membros leem"
  on public.caixa_sync_events for select to authenticated
  using (true);

revoke all on public.caixa_sync_events from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.caixa_sync_events from authenticated;
grant select on public.caixa_sync_events to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Estado lido pelo servidor (para montar a requisição condicional)
-- -----------------------------------------------------------------------------
create or replace function public.get_caixa_sync_state(p_server_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
begin
  if not private.caixa_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'source_last_modified', s.source_last_modified,
    'source_etag', s.source_etag,
    'source_digest', s.source_digest,
    'last_checked_at', s.last_checked_at,
    'last_changed_at', s.last_changed_at,
    'checks_since_change', s.checks_since_change,
    'total_ativo', s.total_ativo
  )
  into v_state
  from public.caixa_catalog_status s
  where s.singleton;

  return coalesce(v_state, '{}'::jsonb);
end;
$$;

comment on function public.get_caixa_sync_state(text) is
  'Servidor Next (chave publishable + CAIXA_SERVER_KEY): Last-Modified/ETag da última carga, para a próxima verificação ir condicional (If-Modified-Since / If-None-Match).';

revoke all on function public.get_caixa_sync_state(text) from public, anon, authenticated;
grant execute on function public.get_caixa_sync_state(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Verificação que não mudou nada (304, corpo idêntico ou falha)
-- -----------------------------------------------------------------------------
create or replace function public.record_caixa_check(
  p_server_key text,
  p_result text,
  p_source_last_modified text default null,
  p_source_etag text default null,
  p_source_digest text default null,
  p_failure_reason text default null
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

  update public.caixa_catalog_status s
  set last_checked_at = now(),
      last_result = p_result,
      checks_since_change = s.checks_since_change + 1,
      -- Falha não muda o que sabemos da origem nem apaga nada: o catálogo
      -- anterior continua valendo e a próxima verificação vem em 30 minutos.
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
    insert into public.caixa_sync_events (resultado, verificacoes, motivo)
    values ('falha', v_checks, left(coalesce(p_failure_reason, 'desconhecido'), 120));
  end if;

  return jsonb_build_object('checks_since_change', coalesce(v_checks, 0));
end;
$$;

comment on function public.record_caixa_check(text, text, text, text, text, text) is
  'Servidor Next (chave publishable + CAIXA_SERVER_KEY): registra uma verificação que NÃO mudou o catálogo — 304 (not_modified), corpo idêntico ao anterior (unchanged) ou erro (falha). Nunca apaga nem altera imóvel.';

revoke all on function public.record_caixa_check(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_caixa_check(text, text, text, text, text, text)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Fechamento da carga, agora guardando os cabeçalhos da origem
-- -----------------------------------------------------------------------------
drop function if exists public.finish_caixa_sync(text, uuid, date, integer);

create or replace function public.finish_caixa_sync(
  p_server_key text,
  p_sync_id uuid,
  p_generated_on date default null,
  p_rejected integer default 0,
  p_source_last_modified text default null,
  p_source_etag text default null,
  p_source_digest text default null
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
  v_checks integer;
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
    resultado, source_last_modified, lista_gerada_em, total, sairam, recusados, verificacoes
  )
  values (
    'ok', left(p_source_last_modified, 120), p_generated_on, v_total, v_delisted,
    greatest(coalesce(p_rejected, 0), 0), coalesce(v_checks, 0)
  );

  return jsonb_build_object(
    'seen', v_seen,
    'delisted', v_delisted,
    'total', v_total,
    'checks_since_change', coalesce(v_checks, 0)
  );
end;
$$;

comment on function public.finish_caixa_sync(text, uuid, date, integer, text, text, text) is
  'Servidor Next (chave publishable + CAIXA_SERVER_KEY): fecha a carga do catálogo da Caixa. Marca saiu_da_lista_em em quem não apareceu na sincronização, grava public.caixa_catalog_status (inclusive Last-Modified/ETag da origem para a próxima requisição condicional) e registra a mudança em caixa_sync_events. Recusa (22023) carga com menos de 1.000 imóveis. Nunca apaga linha.';

revoke all on function public.finish_caixa_sync(text, uuid, date, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_caixa_sync(text, uuid, date, integer, text, text, text)
  to anon, authenticated;
