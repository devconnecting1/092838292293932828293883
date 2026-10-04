-- =============================================================================
-- Teste do SLA honesto, das origens Instagram/WhatsApp, dos modelos de mensagem
-- de WhatsApp e da nova tentativa de leads externos pelo pg_cron
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
-- Usa a chave `lead_server_key` do Vault (sem imprimir).
--
-- O que está sendo garantido (migrações lead_sources_instagram_whatsapp e
-- honest_first_contact_whatsapp_templates_lead_ingest_ping):
--   1. mover o lead de "Novo" para "Em contato" NÃO grava contato nem 1º contato;
--      o relatório por corretor não conta esse lead como atendido;
--   2. "Conseguiu falar? Não" grava só a tentativa (canal ligação);
--   3. "Conseguiu falar? Sim" (WhatsApp) grava o contato e o 1º contato, e o
--      lead em "Novo" vai para "Em contato"; o relatório passa a contar;
--   4. o app não informa a data do contato, não altera nem apaga o registro,
--      e quem é de outra imobiliária não registra contato;
--   5. landing page com origem instagram grava a origem e continua ligada à
--      página; origem desconhecida volta a ser landing_page;
--   6. modelos de WhatsApp: corretor lê e não cria; gerente cria; título
--      repetido e 31º modelo são recusados;
--   7. rotina do pg_cron agendada e sem chamada quando não há entrega vencida.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   etapa_nao_grava_contato          : true
--   tentativa_nao_grava_contato      : true
--   tentativa_registrada             : "call:false"
--   sim_grava_primeiro_contato       : true
--   sim_move_para_em_contato         : "contacted"
--   relatorio_recebidos_atendidos    : "2/1"
--   app_nao_informa_data             : "NEGADO:42501"
--   app_nao_altera_registro          : "NEGADO:42501"
--   app_nao_apaga_registro           : "NEGADO:42501"
--   outra_imobiliaria_nao_registra   : "NEGADO:42501"
--   corretor_ve_contatos             : 3
--   landing_origem_instagram         : "instagram:true"
--   landing_origem_invalida          : "landing_page"
--   modelo_corretor_le               : 1
--   modelo_corretor_nao_cria         : "NEGADO:42501"
--   modelo_titulo_repetido           : "NEGADO:23505"
--   modelo_limite_30                 : "NEGADO:23514"
--   cron_nova_tentativa_agendada     : "*/5 * * * *"
--   ping_sem_entrega_vencida         : false

do $$
declare
  r jsonb := '{}'::jsonb;
  lead_key text;
  u_owner uuid := gen_random_uuid();
  u_manager uuid := gen_random_uuid();
  u_b1 uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  org uuid;
  org_other uuid;
  l_etapa uuid;
  l_sim uuid;
  v_text text;
  v_int integer;
  v_bool boolean;
  v_event uuid := gen_random_uuid();
  v_event2 uuid := gen_random_uuid();
  i integer;
begin
  select ds.decrypted_secret into lead_key
  from vault.decrypted_secrets ds
  where ds.name = 'lead_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-sla-dono@exemplo.invalid', now(), now(), now()),
    (u_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-sla-gerente@exemplo.invalid', now(), now(), now()),
    (u_b1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-sla-b1@exemplo.invalid', now(), now(), now()),
    (u_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-sla-outra@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  org_other := public.create_organization('Imobiliaria Teste Outra', 'teste-sla-outra');

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste SLA', 'teste-sla-honesto');

  update public.billing_accounts
  set limits = limits || '{"users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_manager, 'manager', true), (org, u_b1, 'broker', true);

  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Etapa', '11977780001', 'instagram', 'new', u_b1)
  returning id into l_etapa;

  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Sim', '11977780002', 'whatsapp', 'new', u_b1)
  returning id into l_sim;

  -- ---------------------------------------------------------------------------
  -- 1. Mover etapa não é contato (o corretor, pela API)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.leads set stage = 'contacted' where id = l_etapa;

  select l.stage = 'contacted' and l.last_contact_at is null and l.first_contact_at is null
    into v_bool
  from public.leads l where l.id = l_etapa;
  r := r || jsonb_build_object('etapa_nao_grava_contato', coalesce(v_bool, false));

  -- ---------------------------------------------------------------------------
  -- 2. "Conseguiu falar? Não": só a tentativa
  -- ---------------------------------------------------------------------------
  insert into public.lead_contact_events (organization_id, lead_id, channel, reached)
  values (org, l_etapa, 'call', false);

  select l.last_contact_at is null and l.first_contact_at is null
    into v_bool
  from public.leads l where l.id = l_etapa;
  r := r || jsonb_build_object('tentativa_nao_grava_contato', coalesce(v_bool, false));

  select e.channel || ':' || e.reached into v_text
  from public.lead_contact_events e
  where e.lead_id = l_etapa and e.created_by = u_b1;
  r := r || jsonb_build_object('tentativa_registrada', v_text);

  -- ---------------------------------------------------------------------------
  -- 3. "Conseguiu falar? Sim" pelo WhatsApp
  -- ---------------------------------------------------------------------------
  insert into public.lead_contact_events (organization_id, lead_id, channel, reached)
  values (org, l_sim, 'whatsapp', true);

  select l.last_contact_at is not null
     and l.first_contact_at = l.last_contact_at
    into v_bool
  from public.leads l where l.id = l_sim;
  r := r || jsonb_build_object('sim_grava_primeiro_contato', coalesce(v_bool, false));

  select l.stage::text into v_text from public.leads l where l.id = l_sim;
  r := r || jsonb_build_object('sim_move_para_em_contato', v_text);

  -- Segundo contato (ligação atendida) no mesmo lead: só conta uma vez no relatório.
  insert into public.lead_contact_events (organization_id, lead_id, channel, reached)
  values (org, l_sim, 'call', true);

  -- ---------------------------------------------------------------------------
  -- 4. Limites do registro
  -- ---------------------------------------------------------------------------
  begin
    insert into public.lead_contact_events (organization_id, lead_id, channel, reached, created_at)
    values (org, l_etapa, 'call', true, now() - interval '3 days');
    r := r || jsonb_build_object('app_nao_informa_data', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('app_nao_informa_data', 'NEGADO:' || sqlstate);
  end;

  begin
    update public.lead_contact_events set reached = true where lead_id = l_etapa;
    r := r || jsonb_build_object('app_nao_altera_registro', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('app_nao_altera_registro', 'NEGADO:' || sqlstate);
  end;

  begin
    delete from public.lead_contact_events where lead_id = l_etapa;
    r := r || jsonb_build_object('app_nao_apaga_registro', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('app_nao_apaga_registro', 'NEGADO:' || sqlstate);
  end;

  select count(*)::integer into v_int
  from public.lead_contact_events e
  where e.organization_id = org;
  r := r || jsonb_build_object('corretor_ve_contatos', v_int);

  reset role;

  -- Relatório por corretor (dono): 2 recebidos, 1 atendido.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute $q$
    select p.leads_received || '/' || p.leads_answered
    from public.report_broker_performance($1, now() - interval '1 day', now() + interval '1 day') p
    where p.user_id = $2
  $q$ into v_text using org, u_b1;
  -- O lead movido sem contato não entra em "atendidos" (só o do "Sim").
  r := r || jsonb_build_object('relatorio_recebidos_atendidos', v_text);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    insert into public.lead_contact_events (organization_id, lead_id, channel, reached)
    values (org, l_etapa, 'email', true);
    r := r || jsonb_build_object('outra_imobiliaria_nao_registra', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('outra_imobiliaria_nao_registra', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 5. Landing page com origem do link
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  insert into public.landing_pages (
    organization_id, template, name, slug, status, published_at, content
  )
  values (
    org, 'campaign_valuation', 'Bio Instagram', 'bio-instagram', 'published', now(),
    jsonb_build_object('headline', 'Avalie seu imovel', 'cta_label', 'Quero avaliar')
  );

  perform set_config('request.jwt.claims', '', true);

  perform public.submit_landing_lead('teste-sla-honesto', 'bio-instagram',
    jsonb_build_object(
      'name', 'Visitante Bio', 'phone', '11977780003', 'consent', 'true',
      'event_id', v_event::text, 'origin', 'Instagram'
    ),
    lead_key, repeat('i', 32), null);

  select l.source || ':' || (l.landing_page_id is not null)::text into v_text
  from public.leads l
  where l.organization_id = org and l.event_id = v_event;
  r := r || jsonb_build_object('landing_origem_instagram', v_text);

  perform public.submit_landing_lead('teste-sla-honesto', 'bio-instagram',
    jsonb_build_object(
      'name', 'Visitante Outro', 'phone', '11977780004', 'consent', 'true',
      'event_id', v_event2::text, 'origin', 'tiktok'
    ),
    lead_key, repeat('j', 32), null);

  select l.source::text into v_text
  from public.leads l
  where l.organization_id = org and l.event_id = v_event2;
  r := r || jsonb_build_object('landing_origem_invalida', v_text);

  -- ---------------------------------------------------------------------------
  -- 6. Modelos de mensagem de WhatsApp
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.whatsapp_message_templates (organization_id, title, body)
  values (org, 'Confirmar visita', '  Olá, {nome}! Confirmo a visita ao {imovel}. {link}  ');

  begin
    insert into public.whatsapp_message_templates (organization_id, title, body)
    values (org, 'CONFIRMAR VISITA', 'Outro texto');
    r := r || jsonb_build_object('modelo_titulo_repetido', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('modelo_titulo_repetido', 'NEGADO:' || sqlstate);
  end;

  begin
    for i in 1..30 loop
      insert into public.whatsapp_message_templates (organization_id, title, body)
      values (org, 'Modelo ' || i, 'Texto do modelo ' || i);
    end loop;
    r := r || jsonb_build_object('modelo_limite_30', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('modelo_limite_30', 'NEGADO:' || sqlstate);
  end;

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*)::integer into v_int
  from public.whatsapp_message_templates t
  where t.organization_id = org
    and t.body = 'Olá, {nome}! Confirmo a visita ao {imovel}. {link}';
  r := r || jsonb_build_object('modelo_corretor_le', v_int);

  begin
    insert into public.whatsapp_message_templates (organization_id, title, body)
    values (org, 'Do corretor', 'Texto do corretor');
    r := r || jsonb_build_object('modelo_corretor_nao_cria', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('modelo_corretor_nao_cria', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 7. Nova tentativa de leads externos pelo pg_cron
  -- ---------------------------------------------------------------------------
  select j.schedule into v_text
  from cron.job j
  where j.jobname = 'nova-tentativa-leads-externos';
  r := r || jsonb_build_object('cron_nova_tentativa_agendada', v_text);

  -- Sem entrega vencida neste banco de teste, nada é chamado (mesmo com segredos).
  if not exists (
    select 1 from public.lead_integration_deliveries del
    where del.status in ('pending', 'failed')
  ) then
    r := r || jsonb_build_object('ping_sem_entrega_vencida', private.ping_lead_ingest_webhook());
  else
    r := r || jsonb_build_object('ping_sem_entrega_vencida', 'HA_ENTREGAS_NA_FILA');
  end if;

  raise exception 'RESULTADO: %', jsonb_pretty(r);
end;
$$;
