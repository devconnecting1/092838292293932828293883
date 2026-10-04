-- =============================================================================
-- Imóveis da Caixa: estado da carga para o lembrete diário
-- =============================================================================
-- Com o envio manual da lista, a rotina diária /api/cron/caixa-catalog passa a
-- lembrar a equipe da plataforma quando a última carga tem mais de 24 horas.
-- Ela roda sem sessão (só com a chave do servidor), e caixa_catalog_status só é
-- legível por `authenticated`. get_caixa_sync_state passa a devolver também a
-- data declarada pela Caixa no arquivo e quando a carga terminou.
--
-- Mesma assinatura e mesmo retorno (jsonb): `create or replace` mantém os
-- privilégios (EXECUTE só para anon).

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
    'total_ativo', s.total_ativo,
    'lista_gerada_em', s.lista_gerada_em,
    'sincronizado_em', s.sincronizado_em
  )
  into v_state
  from public.caixa_catalog_status s
  where s.singleton;

  return coalesce(v_state, '{}'::jsonb);
end;
$$;

comment on function public.get_caixa_sync_state(text) is
  'Servidor Next (chave publishable + CAIXA_SERVER_KEY): assinatura da última carga (Last-Modified, ETag, SHA-256), data declarada pela Caixa no arquivo (lista_gerada_em), fim da última carga (sincronizado_em) e total ativo. Usada para não regravar o mesmo arquivo e pelo lembrete diário de envio da lista.';
