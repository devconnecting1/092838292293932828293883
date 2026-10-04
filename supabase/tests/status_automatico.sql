-- =============================================================================
-- Teste dos incidentes automáticos da página de status
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
-- Usa a chave `platform_server_key` do Vault (sem imprimir). O relógio é
-- simulado: começa ao meio-dia (São Paulo) de depois de amanhã e anda de minuto
-- em minuto, gravando amostras com private.status_record_sample (histerese de
-- 2 medições) e chamando private.status_auto_incidents_step. Nada sai pela
-- rede: requisições do pg_net só saem depois do COMMIT e aqui tudo é desfeito.
--
-- O que está sendo provado (migração 20260917090832_status_page_automatic_incidents):
--   1. sem medição nada abre; instabilidade parcial abre só na 3ª medição
--      seguida (depois da histerese), com título/texto de modelo, origem
--      automática, sem autor, registro do console como "sistema" e aviso
--      "aberto" na fila (impacto grande);
--   2. partes que caem no mesmo minuto entram no mesmo incidente (título
--      genérico, impacto crítico);
--   3. piora → atualização "piorou" com impacto crítico (sem novo aviso);
--   4. 5 medições operacionais → monitorando; voltou a cair → investigando;
--      mais 15 min estável → resolvido (aviso "resolvido" na fila);
--   5. caiu até 30 min depois de resolvido → reabre o mesmo (e cancela o aviso
--      "resolvido" que ainda não saiu);
--   6. não abre com manutenção em andamento nem com incidente da equipe;
--   7. lentidão abre só na 10ª medição, com impacto pequeno e sem aviso;
--   8. limite de 6 por parte no dia: reabre o último do dia; todos assumidos →
--      não abre nada;
--   9. "Assumir" (e publicar atualização) tira o incidente da automação;
--      assumir sem chave ou incidente da equipe é recusado;
--  10. 30 atualizações → automação pausada;
--  11. fornecedor com incidente → texto "possível relação..." sem o nome;
--  12. get_public_status traz source (automatic/team) e nada interno;
--  13. leitura do status.json dos fornecedores (tags removidas, JSON inválido e
--      sem resposta);
--  14. fila do aviso: trava de 10 e-mails em 24 h, settle sent/released/failed;
--  15. registro recusa ator pela metade; privilégios das RPCs e tabelas novas.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   sem_medicao_nao_abre       : 0
--   antes_da_3a_medicao        : 0
--   abre_apos_3                : {"autor_nulo": true, "estado": "investigating", "impacto": "major", "mensagem": "Detectamos automaticamente uma instabilidade nesta parte do sistema. Estamos verificando.", "origem": "automatic", "titulo": "Instabilidade em Avisos por e-mail e no celular", "atualizacao_sem_autor": true}
--   registro_sistema           : {"acao": "incidente.abrir_automatico", "ator_nulo": true, "lista": "sistema"}
--   alerta_aberto              : {"tipo": "opened", "impacto": "major"}
--   agrupa                     : {"partes": ["crm", "login"], "titulo": "Instabilidade em várias partes do sistema", "impacto": "critical", "mensagem": "Detectamos automaticamente uma instabilidade nestas partes do sistema. Estamos verificando.", "incidentes": 1}
--   piora                      : {"impacto": "critical", "mensagem": "A instabilidade piorou. Estamos verificando.", "alertas": 1}
--   fila_sem_chave             : "NEGADO:42501"
--   fila_reserva               : 2
--   monitora_antes             : "investigating"
--   monitora                   : {"estado": "monitoring", "mensagem": "O funcionamento voltou ao normal. Seguimos acompanhando."}
--   volta_investigando         : {"estado": "investigating", "mensagem": "A instabilidade voltou. Estamos verificando."}
--   resolve_antes              : "monitoring"
--   resolve                    : {"estado": "resolved", "mensagem": "Resolvido. O funcionamento está normal.", "alerta": "resolved"}
--   reabre                     : {"mesmo": true, "estado": "investigating", "impacto": "major", "automaticos": 2, "mensagem": "A instabilidade voltou. Estamos verificando.", "alertas": 1}
--   nao_abre_manutencao        : 0
--   nao_abre_equipe            : 0
--   lentidao_antes_da_10a      : 0
--   lentidao_10                : {"impacto": "minor", "titulo": "Instabilidade em Portais e integrações", "alertas": 0}
--   limite_diario_reabre       : {"total": 6, "reaberto": true, "estado": "investigating"}
--   limite_diario_sem_novo     : {"total": 6, "abertos": 0}
--   assumir_sem_chave          : "NEGADO:42501"
--   assumir_equipe             : "NEGADO:22023"
--   assumir                    : {"motivo": "equipe", "por": true, "registro": 1}
--   assumido_nao_muda          : {"estado": "investigating", "atualizacoes": 1, "automaticos_crm": 1}
--   equipe_atualiza_assume     : "equipe"
--   limite_atualizacoes        : {"motivo": "limite_de_atualizacoes", "estado": "investigating", "atualizacoes": 30}
--   fornecedor_texto           : {"relacao": true, "sem_nome": true, "impacto": "critical"}
--   publico_origem             : {"automatico": true, "equipe": true}
--   publico_sem_dado_interno   : true
--   fornecedor_leitura         : {"supabase": {"indicador": "major", "descricao": "Major Outage", "resultado": "ok"}, "vercel": {"indicador": null, "resultado": "resposta_invalida"}, "sem_resposta": "sem_resposta"}
--   fila_trava_cheia           : 0
--   fila_ate_a_trava           : {"reservados": 2, "usados": 10}
--   fila_trava_depois          : 0
--   fila_settle                : {"enviado": true, "liberado": true, "repetido": false, "usados": 6}
--   fila_resultado_invalido    : "NEGADO:22023"
--   registro_ator_pela_metade  : "NEGADO:23514"
--   rotina_chama_automacao     : true
--   rpcs_console_so_anon       : true
--   privado_sem_acesso         : true

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_admin uuid := gen_random_uuid();
  v_email constant text := 'teste-status-auto@exemplo.invalid';
  t timestamptz;
  v_day_start timestamptz;
  i integer;
  v_inc uuid;
  v_group uuid;
  v_slow uuid;
  v_team uuid;
  v_billing uuid;
  v_vendor_inc uuid;
  v_json jsonb;
  v_alert_a bigint;
  v_alert_b bigint;
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
  delete from private.status_auto_tracker;
  delete from private.status_alerts;
  update private.status_vendor_state
  set indicator = null, description = null, checked_at = null, request_id = null;
  update private.status_incidents
  set status = case when kind = 'incident' then 'resolved' else 'completed' end,
      resolved_at = greatest(started_at, now()),
      automation_stopped_at = case when source = 'automatic' then coalesce(automation_stopped_at, now()) end,
      automation_stopped_reason = case when source = 'automatic' then coalesce(automation_stopped_reason, 'limite_de_atualizacoes') end,
      automation_stopped_by = case when automation_stopped_reason = 'equipe' then automation_stopped_by end,
      auto_monitoring_since = null
  where resolved_at is null;

  -- Meio-dia de São Paulo, daqui a dois dias: longe de tudo que já existe.
  v_day_start := (((now() at time zone 'America/Sao_Paulo')::date + 2)::timestamp) at time zone 'America/Sao_Paulo';
  t := v_day_start + interval '12 hours';

  -- ---------------------------------------------------------------------------
  -- 1. Sem medição, nada; instabilidade parcial abre na 3ª medição seguida
  -- ---------------------------------------------------------------------------
  for i in 1..12 loop
    t := t + interval '1 minute';
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('sem_medicao_nao_abre',
    (select count(*) from private.status_incidents where source = 'automatic' and created_at >= v_day_start));

  for i in 1..3 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('notifications', 'partial_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('antes_da_3a_medicao',
    (select count(*) from private.status_incidents where source = 'automatic' and created_at >= v_day_start));

  t := t + interval '1 minute';
  perform private.status_record_sample('notifications', 'partial_outage', 'teste', t);
  perform private.status_auto_incidents_step(t);

  select id into v_inc
  from private.status_incidents
  where source = 'automatic' and created_at >= v_day_start and 'notifications' = any (component_keys);

  r := r || jsonb_build_object('abre_apos_3', (
    select jsonb_build_object(
      'titulo', i2.title,
      'impacto', i2.impact,
      'estado', i2.status,
      'origem', i2.source,
      'autor_nulo', i2.created_by is null,
      'mensagem', (select u.message from private.status_incident_updates u where u.incident_id = i2.id order by u.id desc limit 1),
      'atualizacao_sem_autor', (select u.created_by is null from private.status_incident_updates u where u.incident_id = i2.id order by u.id desc limit 1)
    )
    from private.status_incidents i2
    where i2.id = v_inc
  ));

  r := r || jsonb_build_object('registro_sistema', (
    select jsonb_build_object(
      'acao', e.action,
      'ator_nulo', e.actor_user_id is null and e.actor_email is null,
      'lista', (
        select l.actor_email
        from public.platform_list_audit_events(key, 200) l
        where l.target_id = v_inc::text
        order by l.id desc
        limit 1
      )
    )
    from private.platform_audit_events e
    where e.target_id = v_inc::text
    order by e.id desc
    limit 1
  ));

  r := r || jsonb_build_object('alerta_aberto', (
    select jsonb_build_object('tipo', a.kind, 'impacto', a.impact)
    from private.status_alerts a
    where a.incident_id = v_inc
  ));

  -- ---------------------------------------------------------------------------
  -- 2. Duas partes no mesmo minuto: um incidente só
  -- ---------------------------------------------------------------------------
  for i in 1..4 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('notifications', 'partial_outage', 'teste', t);
    perform private.status_record_sample('crm', 'major_outage', 'teste', t);
    perform private.status_record_sample('login', 'major_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  select id into v_group
  from private.status_incidents
  where source = 'automatic' and created_at >= v_day_start and 'crm' = any (component_keys);

  r := r || jsonb_build_object('agrupa', (
    select jsonb_build_object(
      'partes', to_jsonb(i2.component_keys),
      'titulo', i2.title,
      'impacto', i2.impact,
      'mensagem', (select u.message from private.status_incident_updates u where u.incident_id = i2.id order by u.id desc limit 1),
      'incidentes', (
        select count(*) from private.status_incidents x
        where x.source = 'automatic' and x.created_at >= v_day_start
          and x.component_keys && array['crm', 'login']
      )
    )
    from private.status_incidents i2
    where i2.id = v_group
  ));

  -- ---------------------------------------------------------------------------
  -- 3. Piora: instabilidade parcial → fora do ar
  -- ---------------------------------------------------------------------------
  for i in 1..2 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('notifications', 'major_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('piora', (
    select jsonb_build_object(
      'impacto', i2.impact,
      'mensagem', (select u.message from private.status_incident_updates u where u.incident_id = i2.id order by u.id desc limit 1),
      'alertas', (select count(*) from private.status_alerts a where a.incident_id = i2.id)
    )
    from private.status_incidents i2
    where i2.id = v_inc
  ));

  -- Fila: sem chave recusa; com chave reserva os dois avisos "aberto".
  begin
    perform public.platform_status_claim_alerts(null, 1);
    r := r || jsonb_build_object('fila_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('fila_sem_chave', 'NEGADO:42501');
  end;

  v_json := public.platform_status_claim_alerts(key, 1, 5);
  r := r || jsonb_build_object('fila_reserva', jsonb_array_length(v_json -> 'alerts'));

  perform public.platform_status_settle_alert(key, (a.value ->> 'id')::bigint, 'sent', 1)
  from jsonb_array_elements(v_json -> 'alerts') a;

  -- ---------------------------------------------------------------------------
  -- 4. Recupera → monitorando; volta a cair → investigando; estável → resolvido
  -- ---------------------------------------------------------------------------
  for i in 1..5 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('notifications', 'operational', 'ok', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('monitora_antes', (select status from private.status_incidents where id = v_inc));

  t := t + interval '1 minute';
  perform private.status_record_sample('notifications', 'operational', 'ok', t);
  perform private.status_auto_incidents_step(t);

  r := r || jsonb_build_object('monitora', (
    select jsonb_build_object(
      'estado', i2.status,
      'mensagem', (select u.message from private.status_incident_updates u where u.incident_id = i2.id order by u.id desc limit 1)
    )
    from private.status_incidents i2
    where i2.id = v_inc
  ));

  for i in 1..2 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('notifications', 'partial_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('volta_investigando', (
    select jsonb_build_object(
      'estado', i2.status,
      'mensagem', (select u.message from private.status_incident_updates u where u.incident_id = i2.id order by u.id desc limit 1)
    )
    from private.status_incidents i2
    where i2.id = v_inc
  ));

  for i in 1..20 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('notifications', 'operational', 'ok', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('resolve_antes', (select status from private.status_incidents where id = v_inc));

  t := t + interval '1 minute';
  perform private.status_record_sample('notifications', 'operational', 'ok', t);
  perform private.status_auto_incidents_step(t);

  r := r || jsonb_build_object('resolve', (
    select jsonb_build_object(
      'estado', i2.status,
      'mensagem', (select u.message from private.status_incident_updates u where u.incident_id = i2.id order by u.id desc limit 1),
      'alerta', (select a.kind from private.status_alerts a where a.incident_id = i2.id order by a.id desc limit 1)
    )
    from private.status_incidents i2
    where i2.id = v_inc
  ));

  -- ---------------------------------------------------------------------------
  -- 5. Cai de novo até 30 min depois: reabre o mesmo
  -- ---------------------------------------------------------------------------
  t := t + interval '6 minutes';

  for i in 1..4 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('notifications', 'partial_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('reabre', (
    select jsonb_build_object(
      'mesmo', exists (
        select 1 from private.status_incidents x
        where x.id = v_inc and x.status = 'investigating' and x.resolved_at is null
      ),
      'estado', i2.status,
      'impacto', i2.impact,
      'automaticos', (
        select count(*) from private.status_incidents x
        where x.source = 'automatic' and x.created_at >= v_day_start
      ),
      'mensagem', (select u.message from private.status_incident_updates u where u.incident_id = i2.id order by u.id desc limit 1),
      'alertas', (select count(*) from private.status_alerts a where a.incident_id = i2.id)
    )
    from private.status_incidents i2
    where i2.id = v_inc
  ));

  -- ---------------------------------------------------------------------------
  -- 6. Manutenção em andamento e incidente da equipe: não abre
  -- ---------------------------------------------------------------------------
  insert into private.status_incidents (
    kind, title, impact, status, component_keys, started_at, scheduled_for, scheduled_until, created_by
  )
  values (
    'maintenance', 'Manutenção de teste', 'none', 'scheduled', array['lead_routing'],
    t - interval '1 hour', t - interval '1 hour', t + interval '5 hours', u_admin
  );

  for i in 1..6 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('lead_routing', 'major_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('nao_abre_manutencao', (
    select count(*) from private.status_incidents
    where source = 'automatic' and created_at >= v_day_start and 'lead_routing' = any (component_keys)
  ));

  v_team := public.platform_status_create_incident(
    key, u_admin, v_email, 'incident', 'Catálogo da Caixa atrasado', 'minor', array['caixa_catalog'],
    'Estamos verificando o catálogo.'
  );

  for i in 1..6 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('caixa_catalog', 'partial_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('nao_abre_equipe', (
    select count(*) from private.status_incidents
    where source = 'automatic' and created_at >= v_day_start and 'caixa_catalog' = any (component_keys)
  ));

  -- ---------------------------------------------------------------------------
  -- 7. Lentidão: abre só na 10ª medição seguida, impacto pequeno, sem aviso
  -- ---------------------------------------------------------------------------
  for i in 1..10 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('integrations', 'degraded_performance', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('lentidao_antes_da_10a', (
    select count(*) from private.status_incidents
    where source = 'automatic' and created_at >= v_day_start and 'integrations' = any (component_keys)
  ));

  t := t + interval '1 minute';
  perform private.status_record_sample('integrations', 'degraded_performance', 'teste', t);
  perform private.status_auto_incidents_step(t);

  select id into v_slow
  from private.status_incidents
  where source = 'automatic' and created_at >= v_day_start and 'integrations' = any (component_keys);

  r := r || jsonb_build_object('lentidao_10', (
    select jsonb_build_object(
      'impacto', i2.impact,
      'titulo', i2.title,
      'alertas', (select count(*) from private.status_alerts a where a.incident_id = i2.id)
    )
    from private.status_incidents i2
    where i2.id = v_slow
  ));

  -- ---------------------------------------------------------------------------
  -- 8. Limite de 6 por parte no dia
  -- ---------------------------------------------------------------------------
  insert into private.status_incidents (
    kind, title, impact, status, component_keys, started_at, resolved_at, created_by, created_at, source
  )
  select 'incident', 'Instabilidade em Assinaturas e pagamentos', 'major', 'resolved', array['billing'],
         v_day_start + g * interval '1 hour', v_day_start + g * interval '1 hour' + interval '20 minutes',
         null, v_day_start + g * interval '1 hour', 'automatic'
  from generate_series(1, 6) g;

  select id into v_billing
  from private.status_incidents
  where source = 'automatic' and 'billing' = any (component_keys) and created_at >= v_day_start
  order by resolved_at desc
  limit 1;

  for i in 1..4 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('billing', 'partial_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('limite_diario_reabre', jsonb_build_object(
    'total', (
      select count(*) from private.status_incidents
      where source = 'automatic' and created_at >= v_day_start and 'billing' = any (component_keys)
    ),
    'reaberto', exists (select 1 from private.status_incidents where id = v_billing and resolved_at is null),
    'estado', (select status from private.status_incidents where id = v_billing)
  ));

  insert into private.status_incidents (
    kind, title, impact, status, component_keys, started_at, resolved_at, created_by, created_at, source,
    automation_stopped_at, automation_stopped_reason, automation_stopped_by
  )
  select 'incident', 'Instabilidade em Landing pages e captação', 'major', 'resolved', array['leads_capture'],
         v_day_start + g * interval '1 hour', v_day_start + g * interval '1 hour' + interval '20 minutes',
         null, v_day_start + g * interval '1 hour', 'automatic',
         v_day_start + g * interval '1 hour' + interval '5 minutes', 'equipe', u_admin
  from generate_series(1, 6) g;

  for i in 1..4 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('leads_capture', 'partial_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('limite_diario_sem_novo', jsonb_build_object(
    'total', (
      select count(*) from private.status_incidents
      where source = 'automatic' and created_at >= v_day_start and 'leads_capture' = any (component_keys)
    ),
    'abertos', (
      select count(*) from private.status_incidents
      where source = 'automatic' and resolved_at is null and 'leads_capture' = any (component_keys)
    )
  ));

  -- ---------------------------------------------------------------------------
  -- 9. Assumir e publicar atualização tiram o incidente da automação
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_status_take_over(null, u_admin, v_email, v_group);
    r := r || jsonb_build_object('assumir_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('assumir_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_status_take_over(key, u_admin, v_email, v_team);
    r := r || jsonb_build_object('assumir_equipe', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('assumir_equipe', 'NEGADO:22023');
  end;

  perform public.platform_status_take_over(key, u_admin, v_email, v_group);
  -- Repetir não grava de novo.
  perform public.platform_status_take_over(key, u_admin, v_email, v_group);

  r := r || jsonb_build_object('assumir', (
    select jsonb_build_object(
      'motivo', i2.automation_stopped_reason,
      'por', i2.automation_stopped_by = u_admin,
      'registro', (
        select count(*) from private.platform_audit_events e
        where e.action = 'incidente.assumir' and e.target_id = v_group::text and e.actor_user_id = u_admin
      )
    )
    from private.status_incidents i2
    where i2.id = v_group
  ));

  for i in 1..25 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('crm', 'operational', 'ok', t);
    perform private.status_record_sample('login', 'operational', 'ok', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  for i in 1..4 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('crm', 'major_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('assumido_nao_muda', (
    select jsonb_build_object(
      'estado', i2.status,
      'atualizacoes', (select count(*) from private.status_incident_updates u where u.incident_id = i2.id),
      'automaticos_crm', (
        select count(*) from private.status_incidents x
        where x.source = 'automatic' and x.created_at >= v_day_start and 'crm' = any (x.component_keys)
      )
    )
    from private.status_incidents i2
    where i2.id = v_group
  ));

  perform public.platform_status_add_update(
    key, u_admin, v_email, v_inc, 'identified', 'Encontramos a causa e estamos corrigindo.'
  );

  r := r || jsonb_build_object('equipe_atualiza_assume',
    (select automation_stopped_reason from private.status_incidents where id = v_inc));

  -- ---------------------------------------------------------------------------
  -- 10. 30 atualizações: a automação pausa
  -- ---------------------------------------------------------------------------
  insert into private.status_incident_updates (incident_id, status, message, created_by, created_at)
  select v_slow, 'investigating', 'Atualização de teste ' || g, null, t
  from generate_series(1, 29) g;

  for i in 1..6 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('integrations', 'operational', 'ok', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  r := r || jsonb_build_object('limite_atualizacoes', (
    select jsonb_build_object(
      'motivo', i2.automation_stopped_reason,
      'estado', i2.status,
      'atualizacoes', (select count(*) from private.status_incident_updates u where u.incident_id = i2.id)
    )
    from private.status_incidents i2
    where i2.id = v_slow
  ));

  -- ---------------------------------------------------------------------------
  -- 11. Fornecedor com incidente: texto com "possível relação", sem nome
  -- ---------------------------------------------------------------------------
  update private.status_incidents
  set status = 'completed', resolved_at = t
  where kind = 'maintenance' and title = 'Manutenção de teste' and resolved_at is null;

  update private.status_vendor_state
  set indicator = 'major', description = 'Major Outage', checked_at = t
  where vendor_key = 'supabase';

  for i in 1..4 loop
    t := t + interval '1 minute';
    perform private.status_record_sample('lead_routing', 'major_outage', 'teste', t);
    perform private.status_auto_incidents_step(t);
  end loop;

  select id into v_vendor_inc
  from private.status_incidents
  where source = 'automatic' and created_at >= v_day_start and 'lead_routing' = any (component_keys);

  r := r || jsonb_build_object('fornecedor_texto', (
    select jsonb_build_object(
      'relacao', u.message like '%possível relação com instabilidade em um fornecedor de infraestrutura.',
      'sem_nome', u.message !~* '(supabase|vercel)',
      'impacto', (select impact from private.status_incidents where id = v_vendor_inc)
    )
    from private.status_incident_updates u
    where u.incident_id = v_vendor_inc
    order by u.id desc
    limit 1
  ));

  -- ---------------------------------------------------------------------------
  -- 12. RPC pública: origem e nada interno
  -- ---------------------------------------------------------------------------
  v_json := public.get_public_status();

  r := r || jsonb_build_object('publico_origem', jsonb_build_object(
    'automatico', exists (
      select 1 from jsonb_array_elements(v_json -> 'activeIncidents') e
      where e.value ->> 'id' = v_group::text and e.value ->> 'source' = 'automatic'
    ),
    'equipe', exists (
      select 1 from jsonb_array_elements(v_json -> 'activeIncidents') e
      where e.value ->> 'id' = v_team::text and e.value ->> 'source' = 'team'
    )
  ));

  r := r || jsonb_build_object('publico_sem_dado_interno',
    v_json::text !~ '[^[:space:]@"]+@[^[:space:]@"]+'
    and position(u_admin::text in v_json::text) = 0
    and v_json::text !~* '(automation|stopped|monitoring_since|created_?by|supabase|vercel|fornecedor_|alert)'
  );

  -- ---------------------------------------------------------------------------
  -- 13. Leitura do status.json dos fornecedores
  -- ---------------------------------------------------------------------------
  update private.status_vendor_state set indicator = null, description = null, checked_at = null;

  insert into net._http_response (id, status_code, content_type, content, timed_out, created)
  values
    (-910001, 200, 'application/json',
     '{"page":{"name":"Teste"},"status":{"indicator":"major","description":"Major <b>Outage</b>"}}',
     false, now()),
    (-910002, 200, 'text/html', '<html>não é json</html>', false, now());

  update private.status_vendor_state set request_id = -910001, sent_at = t where vendor_key = 'supabase';
  update private.status_vendor_state set request_id = -910002, sent_at = t where vendor_key = 'vercel';
  perform private.status_read_vendor_responses(t);

  r := r || jsonb_build_object('fornecedor_leitura', jsonb_build_object(
    'supabase', (
      select jsonb_build_object('indicador', indicator, 'descricao', description, 'resultado', last_result)
      from private.status_vendor_state where vendor_key = 'supabase'
    ),
    'vercel', (
      select jsonb_build_object('indicador', indicator, 'resultado', last_result)
      from private.status_vendor_state where vendor_key = 'vercel'
    )
  ));

  update private.status_vendor_state
  set request_id = -910099, sent_at = t - interval '5 minutes'
  where vendor_key = 'vercel';
  perform private.status_read_vendor_responses(t);

  r := jsonb_set(r, '{fornecedor_leitura,sem_resposta}',
    to_jsonb((select last_result from private.status_vendor_state where vendor_key = 'vercel')));

  -- ---------------------------------------------------------------------------
  -- 14. Fila do aviso: trava de 10 e-mails em 24 h
  -- ---------------------------------------------------------------------------
  -- Pendentes agora: "aberto" do billing reaberto e do rodízio (fornecedor).
  -- Já usados: 2 (um e-mail em cada aviso da etapa 3).
  v_json := public.platform_status_claim_alerts(key, 9, 5);
  r := r || jsonb_build_object('fila_trava_cheia', jsonb_array_length(v_json -> 'alerts'));

  v_json := public.platform_status_claim_alerts(key, 4, 5);
  r := r || jsonb_build_object('fila_ate_a_trava', jsonb_build_object(
    'reservados', jsonb_array_length(v_json -> 'alerts'),
    'usados', (v_json ->> 'emails_used_24h')::integer
  ));

  v_alert_a := (v_json #>> '{alerts,0,id}')::bigint;
  v_alert_b := (v_json #>> '{alerts,1,id}')::bigint;

  v_json := public.platform_status_claim_alerts(key, 1, 5);
  r := r || jsonb_build_object('fila_trava_depois', jsonb_array_length(v_json -> 'alerts'));

  r := r || jsonb_build_object('fila_settle', jsonb_build_object(
    'enviado', public.platform_status_settle_alert(key, v_alert_a, 'sent', 4),
    'liberado', public.platform_status_settle_alert(key, v_alert_b, 'released'),
    'repetido', public.platform_status_settle_alert(key, v_alert_a, 'sent', 4)
  ));

  -- Comando separado: a contagem precisa enxergar os settles acima.
  r := jsonb_set(r, '{fila_settle,usados}', to_jsonb(private.status_alert_emails_used(now())));

  begin
    perform public.platform_status_settle_alert(key, v_alert_b, 'qualquer');
    r := r || jsonb_build_object('fila_resultado_invalido', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('fila_resultado_invalido', 'NEGADO:22023');
  end;

  -- ---------------------------------------------------------------------------
  -- 15. Registro, rotina e privilégios
  -- ---------------------------------------------------------------------------
  begin
    insert into private.platform_audit_events (actor_user_id, actor_email, action)
    values (u_admin, null, 'teste.ator_pela_metade');
    r := r || jsonb_build_object('registro_ator_pela_metade', 'PASSOU');
  exception when sqlstate '23514' then
    r := r || jsonb_build_object('registro_ator_pela_metade', 'NEGADO:23514');
  end;

  r := r || jsonb_build_object('rotina_chama_automacao', (
    select p.prosrc like '%private.status_auto_incidents_step%'
      and p.prosrc like '%private.status_send_vendor_probes%'
      and p.prosrc like '%private.ping_status_alerts_webhook%'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'run_status_measurements'
  ));

  r := r || jsonb_build_object('rpcs_console_so_anon', (
    select bool_and(
      has_function_privilege('anon', f, 'execute')
      and not has_function_privilege('authenticated', f, 'execute')
    )
    from unnest(array[
      'public.platform_status_take_over(text, uuid, text, uuid)',
      'public.platform_status_claim_alerts(text, integer, integer)',
      'public.platform_status_settle_alert(text, bigint, text, integer)'
    ]) as f
  ));

  r := r || jsonb_build_object('privado_sem_acesso', (
    select bool_and(not has_table_privilege(role_name, tbl, 'select'))
    from unnest(array['anon', 'authenticated']) as role_name
    cross join unnest(array[
      'private.status_auto_tracker', 'private.status_alerts', 'private.status_vendor_state',
      'private.status_automation_state'
    ]) as tbl
  ) and (
    select bool_and(not has_function_privilege(role_name, f, 'execute'))
    from unnest(array['anon', 'authenticated']) as role_name
    cross join unnest(array[
      'private.status_auto_incidents_step(timestamptz)',
      'private.record_system_audit_event(text, text, text, jsonb, jsonb)',
      'private.status_enqueue_alert(uuid, text, text, timestamptz)',
      'private.ping_status_alerts_webhook(timestamptz)',
      'private.status_send_vendor_probes(timestamptz)'
    ]) as f
  ));

  raise exception 'TESTE STATUS AUTOMATICO (rollback): %', r;
end;
$$;
