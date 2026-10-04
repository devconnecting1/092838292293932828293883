-- =============================================================================
-- Teste da página de status pública: RPC pública, medições e Console
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
-- Usa a chave `platform_server_key` do Vault (sem imprimir). Não lê nem muda o
-- segredo status_probe_url. As respostas falsas da sonda usam ids negativos em
-- net._http_response (desfeitas no fim).
--
-- O que está sendo provado (migração status_page_public):
--   1. sem PLATFORM_SERVER_KEY (ou com a errada) as cinco RPCs do Console
--      recusam com 42501;
--   2. sonda: 200 {"ok":true} = operacional; {"auth":false} derruba só o login;
--      503 {"database":false} = fora do ar (banco_fora); 404 não vira medição;
--      tempo esgotado = fora do ar; sem request pendente nada é medido; sem o
--      segredo status_probe_url a sonda não sai;
--   3. histerese: o nível automático só muda com 2 medições seguidas iguais; o
--      resumo do dia soma só nível confirmado; manutenção em andamento não
--      entra na disponibilidade e aparece como "Em manutenção" (incidente
--      pior vence);
--   4. Console: criar incidente e manutenção, publicar atualização, resolver
--      e editar gravam o registro na mesma transação; conta errada desfaz;
--      HTML, parte desconhecida, janela > 72 h, estado inválido e registro
--      encerrado são recusados;
--   5. get_public_status: formato exato do PublicStatusSnapshot (chaves, 8
--      partes na ordem, 90 dias), nível do incidente, resolvido na lista de
--      passados, id do incidente no dia, e NENHUM dado interno (quem criou,
--      e-mail, detalhe da medição, candidato, rotina);
--   6. retenção: amostra com mais de 8 dias e resumo com mais de 400 dias
--      saem; recentes ficam; rotina agendada a cada minuto;
--   7. privilégios: get_public_status só para anon (o servidor chama sem
--      sessão; migração advisor_rpc_least_privilege) e status_ping para anon e
--      authenticated; RPCs do Console só anon; tabelas e rotinas privadas
--      sem acesso de sessão.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   lista_sem_chave            : "NEGADO:42501"
--   lista_chave_errada         : "NEGADO:42501"
--   medicoes_sem_chave         : "NEGADO:42501"
--   criar_sem_chave            : "NEGADO:42501"
--   atualizar_sem_chave        : "NEGADO:42501"
--   editar_sem_chave           : "NEGADO:42501"
--   sonda_ok                   : {"crm": "operational", "login": "operational", "leads_capture": "operational", "resultado": "ok"}
--   sonda_auth_fora            : {"crm": "operational", "login": "major_outage", "detalhe_login": "auth_fora"}
--   sonda_banco_fora           : {"crm": "major_outage", "detalhe": "banco_fora", "resultado": "http_erro"}
--   sonda_404_sem_medicao      : {"amostras_novas": 0, "resultado": "http_configuracao"}
--   sonda_tempo_esgotado       : {"crm": "major_outage", "resultado": "tempo_esgotado"}
--   sonda_sem_pendente         : 0
--   sonda_sem_url              : true
--   histerese                  : [null, "operational", "operational", "operational", "operational", "partial_outage"]
--   resumo_do_dia              : {"bons": 4, "total": 5, "pior": "partial_outage"}
--   publico_nivel_medido       : "partial_outage"
--   publico_uptime_90d         : 80.00
--   manutencao_nivel_publico   : "under_maintenance"
--   manutencao_fora_do_resumo  : 5
--   manutencao_incidente_vence : "major_outage"
--   incidente_criar_registrado : 1
--   manutencao_registrada      : 1
--   incidente_ativo_publico    : true
--   incidente_nivel_crm        : "major_outage"
--   incidente_geral            : "major_outage"
--   incidente_quebra_de_linha  : true
--   atualizacao_registrada     : 1
--   resolver_registrado        : 1
--   resolvido_nos_passados     : true
--   resolvido_fora_dos_ativos  : true
--   incidente_no_dia           : true
--   atualizar_encerrado        : "NEGADO:22023"
--   editar_encerrado_impacto   : "NEGADO:22023"
--   editar_encerrado_titulo    : 1
--   conta_errada               : "NEGADO:42501"
--   conta_errada_nada          : 0
--   titulo_html                : "NEGADO:23514"
--   mensagem_html              : "NEGADO:23514"
--   parte_desconhecida         : "NEGADO:23514"
--   janela_longa               : "NEGADO:22023"
--   estado_invalido            : "NEGADO:22023"
--   incidente_criado_resolvido : "NEGADO:22023"
--   atualizacoes_so_acrescimo  : "NEGADO:42501"
--   publico_chaves             : true
--   publico_partes_na_ordem    : true
--   publico_90_dias            : true
--   publico_incidente_chaves   : true
--   publico_sem_dado_interno   : true
--   publico_anon_le            : true
--   retencao_apagou_antigos    : true
--   retencao_manteve_recentes  : true
--   rotina_agendada            : true
--   rpcs_publicas              : true
--   rpcs_console_so_anon       : true
--   privado_sem_acesso         : true

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_admin uuid := gen_random_uuid();
  v_email constant text := 'teste-status-equipe@exemplo.invalid';
  v_json jsonb;
  v_component jsonb;
  v_incident uuid;
  v_maintenance uuid;
  v_other uuid;
  v_count integer;
  v_before integer;
  v_levels jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_old_sample bigint;
  v_new_sample bigint;
  v_sent boolean;
  v_probe_url_id uuid;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'platform_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values (u_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          v_email, now(), now(), now());

  -- Começa do zero só dentro desta transação (a rotina real pode ter medido).
  delete from private.status_samples;
  delete from private.status_daily_summaries;
  delete from private.status_component_state;

  -- ---------------------------------------------------------------------------
  -- 1. Sem chave e com chave errada
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_status_list_incidents(null);
    r := r || jsonb_build_object('lista_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('lista_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_status_list_incidents('chave-errada');
    r := r || jsonb_build_object('lista_chave_errada', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('lista_chave_errada', 'NEGADO:42501');
  end;

  begin
    perform public.platform_status_overview(null);
    r := r || jsonb_build_object('medicoes_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('medicoes_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_status_create_incident(
      null, u_admin, v_email, 'incident', 'Sem chave', 'minor', array['crm'], 'Mensagem sem chave');
    r := r || jsonb_build_object('criar_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('criar_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_status_add_update(
      null, u_admin, v_email, gen_random_uuid(), 'resolved', 'Mensagem sem chave');
    r := r || jsonb_build_object('atualizar_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('atualizar_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_status_edit_incident(
      null, u_admin, v_email, gen_random_uuid(), 'Sem chave', 'minor', array['crm']);
    r := r || jsonb_build_object('editar_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('editar_sem_chave', 'NEGADO:42501');
  end;

  -- ---------------------------------------------------------------------------
  -- 2. Sonda HTTP (respostas falsas em net._http_response)
  -- ---------------------------------------------------------------------------
  -- 200 {"ok": true, "auth": true}, duas vezes (histerese confirma).
  insert into net._http_response (id, status_code, content_type, content, timed_out, created)
  values
    (-900001, 200, 'application/json', '{"ok":true,"database":true,"auth":true}', false, v_now - interval '4 minutes'),
    (-900002, 200, 'application/json', '{"ok":true,"database":true,"auth":true}', false, v_now - interval '3 minutes');

  update private.status_probe_state
  set request_id = -900001, sent_at = v_now - interval '4 minutes' - interval '200 milliseconds';
  perform private.status_collect_measurements(v_now - interval '4 minutes' + interval '50 seconds');

  update private.status_probe_state
  set request_id = -900002, sent_at = v_now - interval '3 minutes' - interval '200 milliseconds';
  perform private.status_collect_measurements(v_now - interval '3 minutes' + interval '50 seconds');

  r := r || jsonb_build_object('sonda_ok', jsonb_build_object(
    'crm', (select level from private.status_component_state where component_key = 'crm'),
    'login', (select level from private.status_component_state where component_key = 'login'),
    'leads_capture', (select level from private.status_component_state where component_key = 'leads_capture'),
    'resultado', (select last_result from private.status_probe_state)
  ));

  -- 200 com o Auth fora, duas vezes: só o login cai.
  insert into net._http_response (id, status_code, content_type, content, timed_out, created)
  values
    (-900003, 200, 'application/json', '{"ok":true,"database":true,"auth":false}', false, v_now - interval '2 minutes'),
    (-900004, 200, 'application/json', '{"ok":true,"database":true,"auth":false}', false, v_now - interval '1 minute');

  update private.status_probe_state
  set request_id = -900003, sent_at = v_now - interval '2 minutes' - interval '200 milliseconds';
  perform private.status_collect_measurements(v_now - interval '2 minutes' + interval '50 seconds');

  update private.status_probe_state
  set request_id = -900004, sent_at = v_now - interval '1 minute' - interval '200 milliseconds';
  perform private.status_collect_measurements(v_now - interval '1 minute' + interval '50 seconds');

  r := r || jsonb_build_object('sonda_auth_fora', jsonb_build_object(
    'crm', (select level from private.status_component_state where component_key = 'crm'),
    'login', (select level from private.status_component_state where component_key = 'login'),
    'detalhe_login', (select last_detail from private.status_component_state where component_key = 'login')
  ));

  -- 503 com o banco fora, duas vezes.
  insert into net._http_response (id, status_code, content_type, content, timed_out, created)
  values
    (-900005, 503, 'application/json', '{"ok":false,"database":false,"auth":true}', false, v_now),
    (-900006, 503, 'application/json', '{"ok":false,"database":false,"auth":true}', false, v_now);

  update private.status_probe_state set request_id = -900005, sent_at = v_now;
  perform private.status_collect_measurements(v_now);
  update private.status_probe_state set request_id = -900006, sent_at = v_now;
  perform private.status_collect_measurements(v_now);

  r := r || jsonb_build_object('sonda_banco_fora', jsonb_build_object(
    'crm', (select level from private.status_component_state where component_key = 'crm'),
    'detalhe', (select last_detail from private.status_component_state where component_key = 'crm'),
    'resultado', (select last_result from private.status_probe_state)
  ));

  -- 404 (endereço errado): configuração, não medição.
  select count(*) into v_before from private.status_samples where component_key in ('crm', 'login', 'leads_capture');
  insert into net._http_response (id, status_code, content_type, content, timed_out, created)
  values (-900007, 404, 'text/html', '<html>não encontrado</html>', false, v_now);
  update private.status_probe_state set request_id = -900007, sent_at = v_now;
  perform private.status_collect_measurements(v_now);

  r := r || jsonb_build_object('sonda_404_sem_medicao', jsonb_build_object(
    'amostras_novas', (select count(*) from private.status_samples where component_key in ('crm', 'login', 'leads_capture')) - v_before,
    'resultado', (select last_result from private.status_probe_state)
  ));

  -- Tempo esgotado.
  insert into net._http_response (id, status_code, content_type, content, timed_out, error_msg, created)
  values (-900008, null, null, null, true, 'Timeout of 5000 ms reached', v_now);
  update private.status_probe_state set request_id = -900008, sent_at = v_now;
  perform private.status_collect_measurements(v_now);

  r := r || jsonb_build_object('sonda_tempo_esgotado', jsonb_build_object(
    'crm', (select last_measured_level from private.status_component_state where component_key = 'crm'),
    'resultado', (select last_result from private.status_probe_state)
  ));

  -- Sem request pendente: nenhuma medição da sonda.
  select count(*) into v_before from private.status_samples where component_key in ('crm', 'login', 'leads_capture');
  perform private.status_collect_measurements(v_now);
  r := r || jsonb_build_object('sonda_sem_pendente',
    (select count(*) from private.status_samples where component_key in ('crm', 'login', 'leads_capture')) - v_before);

  -- Sem o segredo status_probe_url a sonda não sai. A função não recebe
  -- parâmetro, então simula a ausência renomeando o segredo real (função do
  -- Vault, que só troca o nome, não o valor) dentro desta transação (desfeito
  -- no rollback do `raise exception` final) e devolve o nome original em
  -- seguida, sem apagar nem trocar o segredo de verdade.
  select id into v_probe_url_id from vault.secrets where name = 'status_probe_url';
  if v_probe_url_id is not null then
    perform vault.update_secret(v_probe_url_id, null, 'status_probe_url__teste_status_publico');
  end if;

  v_sent := private.status_send_probe();
  r := r || jsonb_build_object('sonda_sem_url',
    v_sent = false
    and (select request_id is null and last_result = 'sem_url' from private.status_probe_state));

  if v_probe_url_id is not null then
    perform vault.update_secret(v_probe_url_id, null, 'status_probe_url');
  end if;

  -- ---------------------------------------------------------------------------
  -- 3. Histerese, resumo do dia e manutenção
  -- ---------------------------------------------------------------------------
  delete from private.status_samples where component_key = 'integrations';
  delete from private.status_daily_summaries where component_key = 'integrations';
  delete from private.status_component_state where component_key = 'integrations';

  v_levels := v_levels || coalesce(to_jsonb(private.status_record_sample('integrations', 'operational', 'ok', v_now - interval '5 minutes')), 'null'::jsonb);
  v_levels := v_levels || coalesce(to_jsonb(private.status_record_sample('integrations', 'operational', 'ok', v_now - interval '4 minutes')), 'null'::jsonb);
  v_levels := v_levels || coalesce(to_jsonb(private.status_record_sample('integrations', 'partial_outage', 'muitas_falhas', v_now - interval '3 minutes')), 'null'::jsonb);
  v_levels := v_levels || coalesce(to_jsonb(private.status_record_sample('integrations', 'operational', 'ok', v_now - interval '2 minutes')), 'null'::jsonb);
  v_levels := v_levels || coalesce(to_jsonb(private.status_record_sample('integrations', 'partial_outage', 'muitas_falhas', v_now - interval '1 minute')), 'null'::jsonb);
  v_levels := v_levels || coalesce(to_jsonb(private.status_record_sample('integrations', 'partial_outage', 'muitas_falhas', v_now)), 'null'::jsonb);

  r := r || jsonb_build_object(
    'histerese', v_levels,
    'resumo_do_dia', (
      select jsonb_build_object(
        'bons', sum(s.good_samples),
        'total', sum(s.total_samples),
        'pior', (
          select s2.worst_level from private.status_daily_summaries s2
          where s2.component_key = 'integrations'
          order by private.status_level_rank(s2.worst_level) desc limit 1
        )
      )
      from private.status_daily_summaries s
      where s.component_key = 'integrations'
    )
  );

  v_json := public.get_public_status();
  select value into v_component from jsonb_array_elements(v_json -> 'components') where value ->> 'key' = 'integrations';

  r := r || jsonb_build_object(
    'publico_nivel_medido', v_component ->> 'level',
    'publico_uptime_90d', (v_component -> 'uptime90dPct')::numeric
  );

  -- Manutenção em andamento na parte: público vê "Em manutenção" e a medição
  -- feita agora não entra no resumo.
  v_maintenance := public.platform_status_create_incident(
    key, u_admin, v_email, 'maintenance', 'Teste status manutenção', 'none', array['integrations'],
    'Atualização do servidor de integrações.', null, v_now - interval '1 minute', v_now + interval '1 hour');

  perform private.status_record_sample('integrations', 'major_outage', 'muitas_falhas', v_now);

  v_json := public.get_public_status();
  select value into v_component from jsonb_array_elements(v_json -> 'components') where value ->> 'key' = 'integrations';

  r := r || jsonb_build_object(
    'manutencao_nivel_publico', v_component ->> 'level',
    'manutencao_fora_do_resumo', (select sum(total_samples) from private.status_daily_summaries where component_key = 'integrations'),
    'manutencao_registrada', (
      select count(*) from private.platform_audit_events e
      where e.action = 'manutencao.agendar' and e.target_type = 'manutencao'
        and e.target_id = v_maintenance::text and e.actor_user_id = u_admin
    )
  );

  v_other := public.platform_status_create_incident(
    key, u_admin, v_email, 'incident', 'Teste status integrações caíram', 'critical', array['integrations'],
    'Nenhum portal está entregando.', 'identified');

  v_json := public.get_public_status();
  select value into v_component from jsonb_array_elements(v_json -> 'components') where value ->> 'key' = 'integrations';
  r := r || jsonb_build_object('manutencao_incidente_vence', v_component ->> 'level');

  perform public.platform_status_add_update(key, u_admin, v_email, v_other, 'resolved', 'Portais voltaram.');
  perform public.platform_status_add_update(key, u_admin, v_email, v_maintenance, 'completed', 'Manutenção concluída.');

  -- ---------------------------------------------------------------------------
  -- 4 e 5. Incidente pelo Console e o que o público vê
  -- ---------------------------------------------------------------------------
  -- Sem medição do CRM: o nível vem só do incidente.
  delete from private.status_component_state where component_key = 'crm';

  v_incident := public.platform_status_create_incident(
    key, u_admin, v_email, 'incident', 'Teste status CRM lento', 'critical', array['login', 'crm', 'crm'],
    E'Estamos investigando.\nMais detalhes em breve.');

  v_json := public.get_public_status();
  select value into v_component from jsonb_array_elements(v_json -> 'components') where value ->> 'key' = 'crm';

  r := r || jsonb_build_object(
    'incidente_criar_registrado', (
      select count(*) from private.platform_audit_events e
      where e.action = 'incidente.criar' and e.target_type = 'incidente'
        and e.target_id = v_incident::text and e.actor_user_id = u_admin
    ),
    'incidente_ativo_publico', exists (
      select 1 from jsonb_array_elements(v_json -> 'activeIncidents') a
      where a.value ->> 'id' = v_incident::text
        and a.value -> 'componentKeys' = '["crm", "login"]'::jsonb
        and a.value ->> 'status' = 'investigating'
    ),
    'incidente_nivel_crm', v_component ->> 'level',
    'incidente_geral', v_json ->> 'overall',
    'incidente_quebra_de_linha', exists (
      select 1 from jsonb_array_elements(v_json -> 'activeIncidents') a,
        jsonb_array_elements(a.value -> 'updates') u
      where a.value ->> 'id' = v_incident::text
        and u.value ->> 'message' = E'Estamos investigando.\nMais detalhes em breve.'
    )
  );

  perform public.platform_status_add_update(key, u_admin, v_email, v_incident, 'identified', 'Causa encontrada no banco.');
  perform public.platform_status_add_update(key, u_admin, v_email, v_incident, 'resolved', 'Tudo normal de novo.');

  v_json := public.get_public_status();
  select value into v_component from jsonb_array_elements(v_json -> 'components') where value ->> 'key' = 'crm';

  r := r || jsonb_build_object(
    'atualizacao_registrada', (
      select count(*) from private.platform_audit_events e
      where e.action = 'incidente.atualizar' and e.target_id = v_incident::text
    ),
    'resolver_registrado', (
      select count(*) from private.platform_audit_events e
      where e.action = 'incidente.resolver' and e.target_id = v_incident::text
    ),
    'resolvido_nos_passados', exists (
      select 1 from jsonb_array_elements(v_json -> 'pastIncidents') a
      where a.value ->> 'id' = v_incident::text
        and a.value ->> 'status' = 'resolved'
        and a.value ->> 'resolvedAt' is not null
        and jsonb_array_length(a.value -> 'updates') = 3
        and a.value -> 'updates' -> 0 ->> 'status' = 'resolved'
    ),
    'resolvido_fora_dos_ativos', not exists (
      select 1 from jsonb_array_elements(v_json -> 'activeIncidents') a
      where a.value ->> 'id' = v_incident::text
    ),
    'incidente_no_dia', (
      select (v_component -> 'days' -> 89 -> 'incidentIds') ? v_incident::text
    )
  );

  begin
    perform public.platform_status_add_update(key, u_admin, v_email, v_incident, 'monitoring', 'Depois de resolvido.');
    r := r || jsonb_build_object('atualizar_encerrado', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('atualizar_encerrado', 'NEGADO:22023');
  end;

  begin
    perform public.platform_status_edit_incident(
      key, u_admin, v_email, v_incident, 'Teste status CRM lento', 'minor', array['crm', 'login']);
    r := r || jsonb_build_object('editar_encerrado_impacto', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('editar_encerrado_impacto', 'NEGADO:22023');
  end;

  perform public.platform_status_edit_incident(
    key, u_admin, v_email, v_incident, 'Teste status CRM fora do ar', 'critical', array['login', 'crm']);

  r := r || jsonb_build_object('editar_encerrado_titulo', (
    select count(*) from private.platform_audit_events e
    where e.action = 'incidente.editar' and e.target_id = v_incident::text
      and e.before_data ->> 'titulo' = 'Teste status CRM lento'
      and e.after_data ->> 'titulo' = 'Teste status CRM fora do ar'
  ));

  select count(*) into v_count from private.status_incidents;

  begin
    perform public.platform_status_create_incident(
      key, u_admin, 'outra-pessoa@exemplo.invalid', 'incident', 'Teste status conta errada', 'minor',
      array['crm'], 'Não deveria gravar.');
    r := r || jsonb_build_object('conta_errada', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('conta_errada', 'NEGADO:42501');
  end;

  r := r || jsonb_build_object('conta_errada_nada', (select count(*) from private.status_incidents) - v_count);

  begin
    perform public.platform_status_create_incident(
      key, u_admin, v_email, 'incident', '<b>Teste</b>', 'minor', array['crm'], 'Mensagem normal.');
    r := r || jsonb_build_object('titulo_html', 'PASSOU');
  exception when sqlstate '23514' then
    r := r || jsonb_build_object('titulo_html', 'NEGADO:23514');
  end;

  begin
    perform public.platform_status_create_incident(
      key, u_admin, v_email, 'incident', 'Teste status html', 'minor', array['crm'], 'Veja <script>x</script>');
    r := r || jsonb_build_object('mensagem_html', 'PASSOU');
  exception when sqlstate '23514' then
    r := r || jsonb_build_object('mensagem_html', 'NEGADO:23514');
  end;

  begin
    perform public.platform_status_create_incident(
      key, u_admin, v_email, 'incident', 'Teste status parte', 'minor', array['banco_interno'], 'Mensagem normal.');
    r := r || jsonb_build_object('parte_desconhecida', 'PASSOU');
  exception when sqlstate '23514' then
    r := r || jsonb_build_object('parte_desconhecida', 'NEGADO:23514');
  end;

  begin
    perform public.platform_status_create_incident(
      key, u_admin, v_email, 'maintenance', 'Teste status janela', 'minor', array['crm'], 'Mensagem normal.',
      null, v_now + interval '1 day', v_now + interval '5 days');
    r := r || jsonb_build_object('janela_longa', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('janela_longa', 'NEGADO:22023');
  end;

  v_other := public.platform_status_create_incident(
    key, u_admin, v_email, 'incident', 'Teste status aberto', 'minor', array['billing'], 'Cobrança lenta.');

  begin
    perform public.platform_status_add_update(key, u_admin, v_email, v_other, 'in_progress', 'Estado de manutenção.');
    r := r || jsonb_build_object('estado_invalido', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('estado_invalido', 'NEGADO:22023');
  end;

  begin
    perform public.platform_status_create_incident(
      key, u_admin, v_email, 'incident', 'Teste status já resolvido', 'minor', array['crm'], 'Mensagem normal.',
      'resolved');
    r := r || jsonb_build_object('incidente_criado_resolvido', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('incidente_criado_resolvido', 'NEGADO:22023');
  end;

  begin
    update private.status_incident_updates set message = 'Mudado.' where incident_id = v_incident;
    r := r || jsonb_build_object('atualizacoes_so_acrescimo', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('atualizacoes_so_acrescimo', 'NEGADO:42501');
  end;

  -- Formato e ausência de dado interno.
  v_json := public.get_public_status();

  r := r || jsonb_build_object(
    'publico_chaves', (
      select array_agg(k order by k collate "C") from jsonb_object_keys(v_json) k
    ) = array['activeIncidents', 'components', 'generatedAt', 'lastCheckedAt', 'overall', 'pastIncidents', 'upcomingMaintenances'],
    'publico_partes_na_ordem', (
      select array_agg(c.value ->> 'key' order by c.ordinality)
      from jsonb_array_elements(v_json -> 'components') with ordinality c
    ) = private.status_component_keys()
      and not exists (
        select 1 from jsonb_array_elements(v_json -> 'components') c
        where (select array_agg(k order by k collate "C") from jsonb_object_keys(c.value) k)
          <> array['automaticSignal', 'days', 'description', 'key', 'level', 'name', 'uptime90dPct']
      ),
    'publico_90_dias', not exists (
      select 1 from jsonb_array_elements(v_json -> 'components') c
      where jsonb_array_length(c.value -> 'days') <> 90
        or c.value -> 'days' -> 89 ->> 'date' <> to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')
        or (select array_agg(k order by k collate "C") from jsonb_object_keys(c.value -> 'days' -> 0) k)
          <> array['date', 'incidentIds', 'uptimePct', 'worstLevel']
    ),
    'publico_incidente_chaves', not exists (
      select 1 from jsonb_array_elements(v_json -> 'pastIncidents') a
      where (select array_agg(k order by k collate "C") from jsonb_object_keys(a.value) k)
        <> array['componentKeys', 'id', 'impact', 'kind', 'resolvedAt', 'scheduledFor', 'scheduledUntil', 'source', 'startedAt', 'status', 'title', 'updates']
    ) and jsonb_array_length(v_json -> 'pastIncidents') >= 3,
    'publico_sem_dado_interno',
      v_json::text !~ '[^[:space:]@"]+@[^[:space:]@"]+'
      and position(u_admin::text in v_json::text) = 0
      and v_json::text !~* '(created_?by|actor|detail|candidate|measured_?level|request_id|rodizio|muitas_falhas|banco_fora|auth_fora|samples)'
  );

  begin
    set local role anon;
    v_json := public.get_public_status();
    reset role;
    r := r || jsonb_build_object('publico_anon_le', jsonb_typeof(v_json -> 'components') = 'array');
  exception when others then
    reset role;
    r := r || jsonb_build_object('publico_anon_le', 'FALHOU:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 6. Retenção e rotina
  -- ---------------------------------------------------------------------------
  insert into private.status_samples (component_key, measured_at, measured_level, level, detail)
  values ('billing', now() - interval '9 days', 'operational', 'operational', 'ok')
  returning id into v_old_sample;

  insert into private.status_samples (component_key, measured_at, measured_level, level, detail)
  values ('billing', now() - interval '7 days', 'operational', 'operational', 'ok')
  returning id into v_new_sample;

  insert into private.status_daily_summaries (component_key, day, good_samples, total_samples, worst_level)
  values
    ('billing', (now() at time zone 'America/Sao_Paulo')::date - 401, 1, 1, 'operational'),
    ('billing', (now() at time zone 'America/Sao_Paulo')::date - 399, 1, 1, 'operational');

  perform private.purge_status_measurements();

  r := r || jsonb_build_object(
    'retencao_apagou_antigos',
      not exists (select 1 from private.status_samples where id = v_old_sample)
      and not exists (
        select 1 from private.status_daily_summaries
        where component_key = 'billing' and day = (now() at time zone 'America/Sao_Paulo')::date - 401
      ),
    'retencao_manteve_recentes',
      exists (select 1 from private.status_samples where id = v_new_sample)
      and exists (
        select 1 from private.status_daily_summaries
        where component_key = 'billing' and day = (now() at time zone 'America/Sao_Paulo')::date - 399
      ),
    'rotina_agendada', exists (
      select 1 from cron.job j
      where j.jobname = 'status-publico-medicoes' and j.schedule = '* * * * *' and j.active
        and j.command ilike '%private.run_status_measurements()%'
    )
  );

  -- ---------------------------------------------------------------------------
  -- 7. Privilégios
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'rpcs_publicas',
      has_function_privilege('anon', 'public.get_public_status()', 'execute')
      and not has_function_privilege('authenticated', 'public.get_public_status()', 'execute')
      and has_function_privilege('anon', 'public.status_ping()', 'execute')
      and has_function_privilege('authenticated', 'public.status_ping()', 'execute'),
    'rpcs_console_so_anon',
      has_function_privilege('anon', 'public.platform_status_list_incidents(text, integer)', 'execute')
      and has_function_privilege('anon', 'public.platform_status_overview(text, integer)', 'execute')
      and has_function_privilege('anon',
        'public.platform_status_create_incident(text, uuid, text, text, text, text, text[], text, text, timestamptz, timestamptz)', 'execute')
      and has_function_privilege('anon', 'public.platform_status_add_update(text, uuid, text, uuid, text, text)', 'execute')
      and has_function_privilege('anon',
        'public.platform_status_edit_incident(text, uuid, text, uuid, text, text, text[], timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'public.platform_status_list_incidents(text, integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.platform_status_overview(text, integer)', 'execute')
      and not has_function_privilege('authenticated',
        'public.platform_status_create_incident(text, uuid, text, text, text, text, text[], text, text, timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'public.platform_status_add_update(text, uuid, text, uuid, text, text)', 'execute')
      and not has_function_privilege('authenticated',
        'public.platform_status_edit_incident(text, uuid, text, uuid, text, text, text[], timestamptz, timestamptz)', 'execute'),
    'privado_sem_acesso',
      not has_table_privilege('anon', 'private.status_incidents', 'select')
      and not has_table_privilege('authenticated', 'private.status_incidents', 'select')
      and not has_table_privilege('authenticated', 'private.status_incident_updates', 'insert')
      and not has_table_privilege('anon', 'private.status_samples', 'select')
      and not has_table_privilege('authenticated', 'private.status_daily_summaries', 'select')
      and not has_table_privilege('authenticated', 'private.status_component_state', 'select')
      and not has_table_privilege('anon', 'private.status_probe_state', 'select')
      and not has_function_privilege('anon', 'private.run_status_measurements()', 'execute')
      and not has_function_privilege('authenticated', 'private.run_status_measurements()', 'execute')
      and not has_function_privilege('authenticated', 'private.status_record_sample(text, text, text, timestamptz)', 'execute')
      and not has_function_privilege('anon', 'private.purge_status_measurements()', 'execute')
  );

  raise exception 'TESTE STATUS PUBLICO (rollback): %', r;
end;
$$;
