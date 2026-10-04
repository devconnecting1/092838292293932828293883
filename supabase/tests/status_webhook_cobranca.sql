-- =============================================================================
-- Teste do sinal automático de "Assinaturas e pagamentos" (webhook da Stripe)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
-- Usa as chaves `billing_server_key` e `platform_server_key` do Vault (sem
-- imprimir). Nada sai pela rede: requisições do pg_net só saem depois do COMMIT
-- e aqui tudo é desfeito.
--
-- O que está sendo provado (migração 20260917103312_status_page_billing_webhook_signal):
--   1. record_billing_webhook_delivery: sem chave/chave errada recusa; resultado
--      inválido recusa; grava só instante, resultado e tipo (tipo só de entrega
--      verificada e no formato da Stripe); falha repetida em rajada não grava de
--      novo até vir uma ok; a tabela não tem coluna para payload, ids ou valores;
--   2. regra (janela de 2 h): sem entrega = sem medição; config_ausente ou
--      assinatura_invalida sem ok depois = instabilidade parcial; ok depois
--      (inclusive no mesmo instante, gravada depois) = operacional; entregas
--      fora da janela não contam; erro_processamento acima de 50% com 3+
--      processadas = lentidão (exatamente 50% ou menos de 3 = operacional);
--   3. rotina de medição: 1ª medição fica sem nível (histerese), 2ª confirma
--      instabilidade parcial e o incidente automático abre na 3ª confirmada
--      (só billing na automação: as amostras das outras partes, que dependem
--      do ambiente, saem a cada minuto — ver a seção 3);
--   4. sem entregas na janela, a rotina não grava medição (nunca queda);
--   5. público: automaticSignal por parte (billing liga com entrega nos
--      últimos 14 dias) e nada interno (resultado, tipo, motivo);
--   6. console: billing automático, sinal configurado e última entrega;
--   7. retenção de 14 dias; privilégios.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   sem_chave                  : "NEGADO:42501"
--   chave_errada               : "NEGADO:42501"
--   resultado_invalido         : "NEGADO:22023"
--   grava_ok                   : {"gravou": true, "resultado": "ok", "tipo": "invoice.paid"}
--   tipo_fora_do_formato       : {"gravou": true, "tipo": null}
--   tipo_sem_verificacao       : {"gravou": true, "tipo": null}
--   rajada_nao_grava           : false
--   depois_de_ok_grava         : true
--   tipo_direto_recusado       : "NEGADO:23514"
--   colunas                    : ["id", "received_at", "outcome", "event_type"]
--   regra_sem_entregas         : 0
--   regra_config_ausente       : {"level": "partial_outage", "detail": "webhook_config_ausente"}
--   regra_ok_depois            : {"level": "operational", "detail": "ok"}
--   regra_assinatura_invalida  : {"level": "partial_outage", "detail": "webhook_assinatura_invalida"}
--   regra_ok_mesmo_instante    : {"level": "operational", "detail": "ok"}
--   regra_fora_da_janela       : 0
--   regra_erros_2_de_3         : {"level": "degraded_performance", "detail": "webhook_erros_processamento"}
--   regra_erro_1_de_2          : {"level": "operational", "detail": "ok"}
--   regra_erros_metade         : {"level": "operational", "detail": "ok"}
--   histerese_1a               : {"medido": "partial_outage", "nivel": null, "detalhe": "webhook_config_ausente"}
--   histerese_2a               : {"medido": "partial_outage", "nivel": "partial_outage"}
--   incidente_antes_da_3a      : 0
--   incidente_automatico       : {"impacto": "major", "estado": "investigating", "origem": "automatic", "tem_billing": true}
--   publico_billing            : {"nivel": "partial_outage", "sinal": true}
--   publico_sinal_booleano     : true
--   publico_sem_dado_interno   : true
--   console_billing            : {"fonte": "automatic", "sinal": true, "ultimo": "config_ausente", "contagem_config": 1, "recentes": 1}
--   sem_entregas_sem_medicao   : {"amostras": 0, "sinal_publico": false}
--   retencao                   : {"antiga": 0, "recente": 1}
--   rpc_so_anon                : true
--   privado_sem_acesso         : true

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  pkey text;
  t timestamptz;
  t_last timestamptz;
  i integer;
  v_gravou boolean;
  v_json jsonb;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'billing_server_key';

  select ds.decrypted_secret into pkey
  from vault.decrypted_secrets ds
  where ds.name = 'platform_server_key';

  -- Começa do zero só dentro desta transação (a rotina real pode ter medido).
  delete from private.status_billing_webhook_deliveries;
  delete from private.status_samples;
  delete from private.status_daily_summaries;
  delete from private.status_component_state;
  delete from private.status_auto_tracker;
  delete from private.status_alerts;
  update private.status_incidents
  set status = case when kind = 'incident' then 'resolved' else 'completed' end,
      resolved_at = greatest(started_at, now()),
      automation_stopped_at = case when source = 'automatic' then coalesce(automation_stopped_at, now()) end,
      automation_stopped_reason = case when source = 'automatic' then coalesce(automation_stopped_reason, 'limite_de_atualizacoes') end,
      automation_stopped_by = case when automation_stopped_reason = 'equipe' then automation_stopped_by end,
      auto_monitoring_since = null
  where resolved_at is null;

  -- ---------------------------------------------------------------------------
  -- 1. Gravação pela rota
  -- ---------------------------------------------------------------------------
  begin
    perform public.record_billing_webhook_delivery(null, 'ok');
    r := r || jsonb_build_object('sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.record_billing_webhook_delivery('chave-errada', 'ok');
    r := r || jsonb_build_object('chave_errada', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('chave_errada', 'NEGADO:42501');
  end;

  begin
    perform public.record_billing_webhook_delivery(key, 'qualquer');
    r := r || jsonb_build_object('resultado_invalido', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('resultado_invalido', 'NEGADO:22023');
  end;

  v_gravou := public.record_billing_webhook_delivery(key, 'ok', 'invoice.paid');
  r := r || jsonb_build_object('grava_ok', (
    select jsonb_build_object('gravou', v_gravou, 'resultado', d.outcome, 'tipo', d.event_type)
    from private.status_billing_webhook_deliveries d
    order by d.id desc
    limit 1
  ));

  v_gravou := public.record_billing_webhook_delivery(key, 'erro_processamento', 'Invoice Paid <b>');
  r := r || jsonb_build_object('tipo_fora_do_formato', (
    select jsonb_build_object('gravou', v_gravou, 'tipo', d.event_type)
    from private.status_billing_webhook_deliveries d
    order by d.id desc
    limit 1
  ));

  v_gravou := public.record_billing_webhook_delivery(key, 'assinatura_invalida', 'invoice.paid');
  r := r || jsonb_build_object('tipo_sem_verificacao', (
    select jsonb_build_object('gravou', v_gravou, 'tipo', d.event_type)
    from private.status_billing_webhook_deliveries d
    order by d.id desc
    limit 1
  ));

  r := r || jsonb_build_object('rajada_nao_grava',
    public.record_billing_webhook_delivery(key, 'assinatura_invalida'));

  perform public.record_billing_webhook_delivery(key, 'ok', 'customer.subscription.updated');
  r := r || jsonb_build_object('depois_de_ok_grava',
    public.record_billing_webhook_delivery(key, 'assinatura_invalida'));

  begin
    insert into private.status_billing_webhook_deliveries (outcome, event_type)
    values ('config_ausente', 'invoice.paid');
    r := r || jsonb_build_object('tipo_direto_recusado', 'PASSOU');
  exception when sqlstate '23514' then
    r := r || jsonb_build_object('tipo_direto_recusado', 'NEGADO:23514');
  end;

  r := r || jsonb_build_object('colunas', (
    select jsonb_agg(a.attname order by a.attnum)
    from pg_attribute a
    where a.attrelid = 'private.status_billing_webhook_deliveries'::regclass
      and a.attnum > 0
      and not a.attisdropped
  ));

  -- ---------------------------------------------------------------------------
  -- 2. Regra da medição (relógio simulado: meio-dia de depois de amanhã)
  -- ---------------------------------------------------------------------------
  delete from private.status_billing_webhook_deliveries;
  t := ((((now() at time zone 'America/Sao_Paulo')::date + 2)::timestamp) at time zone 'America/Sao_Paulo')
    + interval '12 hours';

  r := r || jsonb_build_object('regra_sem_entregas',
    (select count(*) from private.status_billing_webhook_signal(t)));

  insert into private.status_billing_webhook_deliveries (received_at, outcome)
  values (t - interval '5 minutes', 'config_ausente');
  r := r || jsonb_build_object('regra_config_ausente',
    (select to_jsonb(s) from private.status_billing_webhook_signal(t) s));

  insert into private.status_billing_webhook_deliveries (received_at, outcome, event_type)
  values (t - interval '4 minutes', 'ok', 'invoice.paid');
  r := r || jsonb_build_object('regra_ok_depois',
    (select to_jsonb(s) from private.status_billing_webhook_signal(t) s));

  insert into private.status_billing_webhook_deliveries (received_at, outcome)
  values (t - interval '3 minutes', 'assinatura_invalida');
  r := r || jsonb_build_object('regra_assinatura_invalida',
    (select to_jsonb(s) from private.status_billing_webhook_signal(t) s));

  insert into private.status_billing_webhook_deliveries (received_at, outcome)
  values (t - interval '3 minutes', 'ok');
  r := r || jsonb_build_object('regra_ok_mesmo_instante',
    (select to_jsonb(s) from private.status_billing_webhook_signal(t) s));

  r := r || jsonb_build_object('regra_fora_da_janela',
    (select count(*) from private.status_billing_webhook_signal(t + interval '2 hours')));

  delete from private.status_billing_webhook_deliveries;
  insert into private.status_billing_webhook_deliveries (received_at, outcome)
  values
    (t - interval '10 minutes', 'erro_processamento'),
    (t - interval '9 minutes', 'ok'),
    (t - interval '8 minutes', 'erro_processamento');
  r := r || jsonb_build_object('regra_erros_2_de_3',
    (select to_jsonb(s) from private.status_billing_webhook_signal(t) s));

  delete from private.status_billing_webhook_deliveries;
  insert into private.status_billing_webhook_deliveries (received_at, outcome)
  values
    (t - interval '10 minutes', 'erro_processamento'),
    (t - interval '9 minutes', 'ok');
  r := r || jsonb_build_object('regra_erro_1_de_2',
    (select to_jsonb(s) from private.status_billing_webhook_signal(t) s));

  insert into private.status_billing_webhook_deliveries (received_at, outcome)
  values
    (t - interval '8 minutes', 'erro_processamento'),
    (t - interval '7 minutes', 'ok');
  r := r || jsonb_build_object('regra_erros_metade',
    (select to_jsonb(s) from private.status_billing_webhook_signal(t) s));

  -- ---------------------------------------------------------------------------
  -- 3. Rotina de medição: histerese e incidente automático
  -- ---------------------------------------------------------------------------
  -- Relógio perto de agora, para as outras partes medirem normalmente.
  --
  -- Só billing entra na automação: a rotina real também mede as outras partes
  -- (sonda, job rodizio-de-leads, filas de avisos, portais, Caixa), e o
  -- resultado delas depende do ambiente. No banco local do CI o job
  -- rodizio-de-leads não tem execução recente, lead_routing mede fora do ar e,
  -- no mesmo minuto, entra no MESMO incidente automático: impacto crítico e
  -- billing aparece "fora do ar" no público (o incidente impõe o nível a todas
  -- as suas partes), o que é o comportamento documentado, mas não é o que este
  -- teste prova. Por isso, depois de cada medição, as amostras das outras
  -- partes daquele minuto saem (status_auto_update_trackers só lê
  -- measured_at = p_now): mesmo resultado na nuvem e num banco vazio.
  delete from private.status_billing_webhook_deliveries;
  insert into private.status_billing_webhook_deliveries (received_at, outcome)
  values (now(), 'config_ausente');

  t := now() + interval '1 minute';
  perform private.status_collect_measurements(t);
  delete from private.status_samples x where x.measured_at = t and x.component_key <> 'billing';
  perform private.status_auto_incidents_step(t);

  r := r || jsonb_build_object('histerese_1a', (
    select jsonb_build_object('medido', s.last_measured_level, 'nivel', s.level, 'detalhe', s.last_detail)
    from private.status_component_state s
    where s.component_key = 'billing'
  ));

  t := now() + interval '2 minutes';
  perform private.status_collect_measurements(t);
  delete from private.status_samples x where x.measured_at = t and x.component_key <> 'billing';
  perform private.status_auto_incidents_step(t);

  r := r || jsonb_build_object('histerese_2a', (
    select jsonb_build_object('medido', s.last_measured_level, 'nivel', s.level)
    from private.status_component_state s
    where s.component_key = 'billing'
  ));

  -- 2ª medição confirmada (a 1ª confirmada foi no minuto 2): ainda não abre.
  t := now() + interval '3 minutes';
  perform private.status_collect_measurements(t);
  delete from private.status_samples x where x.measured_at = t and x.component_key <> 'billing';
  perform private.status_auto_incidents_step(t);

  r := r || jsonb_build_object('incidente_antes_da_3a', (
    select count(*)
    from private.status_incidents x
    where x.source = 'automatic' and x.resolved_at is null and 'billing' = any (x.component_keys)
  ));

  -- 3ª medição confirmada seguida de instabilidade parcial: abre.
  t := now() + interval '4 minutes';
  t_last := t;
  perform private.status_collect_measurements(t);
  delete from private.status_samples x where x.measured_at = t and x.component_key <> 'billing';
  perform private.status_auto_incidents_step(t);

  r := r || jsonb_build_object('incidente_automatico', (
    select jsonb_build_object(
      'impacto', x.impact,
      'estado', x.status,
      'origem', x.source,
      'tem_billing', 'billing' = any (x.component_keys)
    )
    from private.status_incidents x
    where x.source = 'automatic' and x.resolved_at is null and 'billing' = any (x.component_keys)
    order by x.created_at desc
    limit 1
  ));

  -- ---------------------------------------------------------------------------
  -- 5 e 6. Público e console (com a entrega ainda registrada)
  -- ---------------------------------------------------------------------------
  v_json := public.get_public_status();

  r := r || jsonb_build_object('publico_billing', (
    select jsonb_build_object('nivel', c ->> 'level', 'sinal', (c ->> 'automaticSignal')::boolean)
    from jsonb_array_elements(v_json -> 'components') c
    where c ->> 'key' = 'billing'
  ));

  r := r || jsonb_build_object('publico_sinal_booleano', (
    select count(*) = 8 and bool_and(jsonb_typeof(c -> 'automaticSignal') = 'boolean')
    from jsonb_array_elements(v_json -> 'components') c
  ));

  r := r || jsonb_build_object('publico_sem_dado_interno', (
    v_json::text not like '%config_ausente%'
    and v_json::text not like '%webhook%'
    and v_json::text not like '%event_type%'
    and v_json::text not like '%signal_configured%'
  ));

  v_json := public.platform_status_overview(pkey, 1);

  r := r || jsonb_build_object('console_billing', jsonb_build_object(
    'fonte', (select c ->> 'source' from jsonb_array_elements(v_json -> 'components') c where c ->> 'key' = 'billing'),
    'sinal', (select (c ->> 'signal_configured')::boolean from jsonb_array_elements(v_json -> 'components') c where c ->> 'key' = 'billing'),
    'ultimo', v_json #>> '{billing_webhook,last_outcome}',
    'contagem_config', (v_json #>> '{billing_webhook,counts_2h,config_ausente}')::integer,
    'recentes', jsonb_array_length(v_json #> '{billing_webhook,recent}')
  ));

  -- ---------------------------------------------------------------------------
  -- 4. Sem entregas na janela: nenhuma medição (nunca queda)
  -- ---------------------------------------------------------------------------
  delete from private.status_billing_webhook_deliveries;
  t := now() + interval '5 minutes';
  perform private.status_collect_measurements(t);

  r := r || jsonb_build_object('sem_entregas_sem_medicao', jsonb_build_object(
    'amostras', (
      select count(*) from private.status_samples s
      where s.component_key = 'billing' and s.measured_at > t_last
    ),
    'sinal_publico', (
      select (c ->> 'automaticSignal')::boolean
      from jsonb_array_elements(public.get_public_status() -> 'components') c
      where c ->> 'key' = 'billing'
    )
  ));

  -- ---------------------------------------------------------------------------
  -- 7. Retenção e privilégios
  -- ---------------------------------------------------------------------------
  insert into private.status_billing_webhook_deliveries (received_at, outcome)
  values (now() - interval '15 days', 'config_ausente'), (now() - interval '13 days', 'ok');

  perform private.purge_status_measurements();

  r := r || jsonb_build_object('retencao', jsonb_build_object(
    'antiga', (
      select count(*) from private.status_billing_webhook_deliveries d
      where d.received_at < now() - interval '14 days'
    ),
    'recente', (
      select count(*) from private.status_billing_webhook_deliveries d
      where d.received_at >= now() - interval '14 days'
    )
  ));

  r := r || jsonb_build_object('rpc_so_anon', (
    has_function_privilege('anon', 'public.record_billing_webhook_delivery(text, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.record_billing_webhook_delivery(text, text, text)', 'execute')
    and not exists (
      select 1
      from pg_proc p, aclexplode(p.proacl) acl
      where p.oid = 'public.record_billing_webhook_delivery(text, text, text)'::regprocedure
        and acl.grantee = 0
    )
  ));

  r := r || jsonb_build_object('privado_sem_acesso', (
    select bool_and(
      not has_table_privilege(role_name, 'private.status_billing_webhook_deliveries', 'select')
      and not has_table_privilege(role_name, 'private.status_billing_webhook_deliveries', 'insert')
    )
    from unnest(array['anon', 'authenticated']) as role_name
  ) and (
    select bool_and(not has_function_privilege(role_name, f, 'execute'))
    from unnest(array['anon', 'authenticated']) as role_name
    cross join unnest(array[
      'private.status_billing_webhook_signal(timestamptz)',
      'private.status_component_signal_configured(text, timestamptz)'
    ]) as f
  ));

  raise exception 'TESTE STATUS WEBHOOK COBRANCA (rollback): %', r;
end;
$$;
