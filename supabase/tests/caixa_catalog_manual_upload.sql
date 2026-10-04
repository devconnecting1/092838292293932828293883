-- =============================================================================
-- Teste do envio manual da lista da Caixa (origem, reenvio e carga simultânea)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--   1. a carga enviada em /plataforma/caixa fica registrada com a origem
--      envio_manual, e a falha também;
--   2. chamada antiga (sem p_origem) continua valendo e vira download_automatico;
--   3. origem fora da lista é recusada (22023);
--   4. REENVIAR O MESMO ARQUIVO (mesmas linhas, outra carga) não duplica imóvel
--      e não marca ninguém como "saiu da lista";
--   5. se OUTRA carga gravou imóveis depois que esta começou, o fechamento é
--      recusado (40001) e nada é marcado como "saiu da lista";
--   6. as RPCs de servidor continuam só para anon (nunca authenticated);
--   7. get_caixa_sync_state devolve a data declarada no arquivo e o fim da
--      carga, usados pelo lembrete diário de envio da lista.
--
-- Resultado esperado (ordem das chaves pode variar):
--   primeira_carga_total          : 1001
--   evento_manual_origem          : "envio_manual"
--   reenvio_sairam                : 0
--   reenvio_total                 : 1001
--   reenvio_linhas_no_catalogo    : 1001
--   eventos_manuais_ok            : 2
--   estado_lista_gerada_em        : "2026-09-15"
--   estado_tem_sincronizado_em    : true
--   falha_manual_origem           : "envio_manual"
--   check_sem_origem_origem       : "download_automatico"
--   fechamento_origem_invalida    : "NEGADO:22023"
--   check_origem_invalida         : "NEGADO:22023"
--   fechamento_com_outra_carga    : "NEGADO:40001"
--   outra_carga_nada_marcado      : 0
--   finish_para_anon              : true
--   finish_para_authenticated     : false
--   check_para_anon               : true
--   check_para_authenticated      : false
--   estado_para_anon              : true
--   estado_para_authenticated     : false

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  sync_1 uuid := gen_random_uuid();
  sync_2 uuid := gen_random_uuid();
  sync_3 uuid := gen_random_uuid();
  outra uuid := gen_random_uuid();
  ultimo_evento bigint;
  linhas jsonb;
  j jsonb;
  n integer;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'caixa_server_key';

  -- Nada do que já existe é apagado: as contagens olham só os imóveis
  -- sintéticos (números 2000000000001 a 2000000001001) e os eventos criados
  -- depois deste ponto.
  select coalesce(max(e.id), 0) into ultimo_evento
  from public.caixa_sync_events e;

  -- 1.001 imóveis sintéticos, acima do piso de 1.000 de finish_caixa_sync.
  select jsonb_agg(jsonb_build_object(
    'numero', (2000000000000 + i)::text,
    'uf', case when i % 2 = 0 then 'SP' else 'RJ' end,
    'cidade', 'Cidade de Teste',
    'bairro', 'Centro',
    'endereco', 'RUA DE TESTE, N. ' || i,
    'preco', 100000 + i,
    'valor_avaliacao', 120000 + i,
    'desconto', 10.5,
    'aceita_financiamento', true,
    'descricao', 'Apartamento, 70.00 de area total',
    'modalidade', 'Venda Online',
    'link', 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel='
            || (2000000000000 + i)::text,
    'tipo', 'apartment',
    'area_total', 70,
    'quartos', 2,
    'vagas', 1
  ))
  into linhas
  from generate_series(1, 1001) as i;

  -- ---------------------------------------------------------------------------
  -- 1. Envio manual
  -- ---------------------------------------------------------------------------
  perform public.ingest_caixa_listings(key, sync_1, date '2026-09-15', linhas);
  j := public.finish_caixa_sync(
    key, sync_1, date '2026-09-15', 0, null, null, repeat('a', 64), 'envio_manual');

  r := r || jsonb_build_object(
    'primeira_carga_total', (j ->> 'total')::integer,
    'evento_manual_origem',
    (select e.origem from public.caixa_sync_events e
     where e.resultado = 'ok' order by e.id desc limit 1));

  -- ---------------------------------------------------------------------------
  -- 4. Reenvio do mesmo arquivo (outra carga, mesmas linhas)
  -- ---------------------------------------------------------------------------
  perform public.ingest_caixa_listings(key, sync_2, date '2026-09-15', linhas);
  j := public.finish_caixa_sync(
    key, sync_2, date '2026-09-15', 0, null, null, repeat('a', 64), 'envio_manual');

  r := r || jsonb_build_object(
    'reenvio_sairam', (j ->> 'delisted')::integer,
    'reenvio_total', (j ->> 'total')::integer,
    'reenvio_linhas_no_catalogo',
    (select count(*) from public.caixa_listings l
     where l.numero between '2000000000001' and '2000000001001'),
    'eventos_manuais_ok',
    (select count(*) from public.caixa_sync_events e
     where e.id > ultimo_evento and e.resultado = 'ok' and e.origem = 'envio_manual'));

  -- ---------------------------------------------------------------------------
  -- 7. Estado lido pelo lembrete diário
  -- ---------------------------------------------------------------------------
  j := public.get_caixa_sync_state(key);
  r := r || jsonb_build_object(
    'estado_lista_gerada_em', j ->> 'lista_gerada_em',
    'estado_tem_sincronizado_em', (j ->> 'sincronizado_em') is not null);

  -- ---------------------------------------------------------------------------
  -- 1 e 2. Falha com origem e chamada antiga sem origem
  -- ---------------------------------------------------------------------------
  perform public.record_caixa_check(key, 'falha', null, null, null, 'cabecalho_mudou', 'envio_manual');
  r := r || jsonb_build_object(
    'falha_manual_origem',
    (select e.origem from public.caixa_sync_events e
     where e.resultado = 'falha' order by e.id desc limit 1));

  perform public.record_caixa_check(key, 'falha', null, null, null, 'download_falhou');
  r := r || jsonb_build_object(
    'check_sem_origem_origem',
    (select e.origem from public.caixa_sync_events e
     where e.resultado = 'falha' order by e.id desc limit 1));

  -- ---------------------------------------------------------------------------
  -- 3. Origem inválida
  -- ---------------------------------------------------------------------------
  begin
    perform public.finish_caixa_sync(key, sync_2, null, 0, null, null, null, 'inventada');
    r := r || jsonb_build_object('fechamento_origem_invalida', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('fechamento_origem_invalida', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.record_caixa_check(key, 'falha', null, null, null, 'x', 'inventada');
    r := r || jsonb_build_object('check_origem_invalida', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('check_origem_invalida', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 5. Carga simultânea
  -- ---------------------------------------------------------------------------
  -- Dentro de uma transação o now() não anda, então a outra carga é simulada:
  -- um imóvel regravado por ela um segundo depois do primeiro lote desta.
  perform public.ingest_caixa_listings(key, sync_3, date '2026-09-16', linhas);

  update public.caixa_listings l
  set sincronizacao_id = outra,
      atualizado_em = now() + interval '1 second'
  where l.numero = '2000000000001';

  begin
    perform public.finish_caixa_sync(
      key, sync_3, date '2026-09-16', 0, null, null, repeat('b', 64), 'envio_manual');
    r := r || jsonb_build_object('fechamento_com_outra_carga', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('fechamento_com_outra_carga', 'NEGADO:' || sqlstate);
  end;

  select count(*) into n
  from public.caixa_listings l
  where l.numero between '2000000000001' and '2000000001001'
    and l.saiu_da_lista_em is not null;
  r := r || jsonb_build_object('outra_carga_nada_marcado', n);

  -- ---------------------------------------------------------------------------
  -- 6. Privilégios
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'finish_para_anon', has_function_privilege(
      'anon', 'public.finish_caixa_sync(text, uuid, date, integer, text, text, text, text)', 'execute'),
    'finish_para_authenticated', has_function_privilege(
      'authenticated', 'public.finish_caixa_sync(text, uuid, date, integer, text, text, text, text)', 'execute'),
    'check_para_anon', has_function_privilege(
      'anon', 'public.record_caixa_check(text, text, text, text, text, text, text)', 'execute'),
    'check_para_authenticated', has_function_privilege(
      'authenticated', 'public.record_caixa_check(text, text, text, text, text, text, text)', 'execute'),
    'estado_para_anon', has_function_privilege(
      'anon', 'public.get_caixa_sync_state(text)', 'execute'),
    'estado_para_authenticated', has_function_privilege(
      'authenticated', 'public.get_caixa_sync_state(text)', 'execute'));

  raise exception using errcode = 'P0001', message = jsonb_pretty(r);
end;
$$;
