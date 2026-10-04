-- =============================================================================
-- Teste do 1º contato verdadeiro, do aviso de lead novo e do rodízio sem dono
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
-- Usa as chaves `lead_server_key` e `lead_ingest_server_key` do Vault (sem
-- imprimir nenhuma delas).
--
-- O que está sendo garantido (migração leads_first_contact_and_alerts):
--   1. `first_contact_at` é gravado no 1º contato e NÃO muda no 2º; o app não
--      consegue escrever a coluna;
--   2. o relatório por corretor mede o 1º contato: atendido em 3 min e
--      recontatado 2 dias depois continua "3 min" e "no prazo";
--   3. lead de portal (Grupo OLX) entra na fila de avisos UMA vez: a reentrega
--      e o rodízio enfileirando de novo não duplicam;
--   4. lead de landing page numa imobiliária de 1 usuário, sem configuração de
--      rodízio, entra na fila UMA vez (reenvio do mesmo evento não duplica);
--   5. rodízio com um único corretor elegível: o prazo estoura, o lead continua
--      com ele, o estouro é gravado e a gestão é avisada uma vez só; com outro
--      corretor elegível, a redistribuição continua como antes; a roleta manual
--      também não deixa o lead sem responsável.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   primeiro_contato_nao_muda        : true
--   ultimo_contato_atualiza          : true
--   app_nao_escreve_primeiro_contato : "NEGADO:42501"
--   relatorio_usa_o_primeiro         : "1/1/3.0"
--   portal_status                    : "accepted"
--   portal_aviso_na_fila             : 1
--   portal_aviso_para_o_dono         : true
--   portal_reentrega_nao_duplica     : 1
--   portal_rodizio_nao_duplica       : 1
--   portal_com_roleta_avisa_corretor : "b1:1"
--   landing_sem_config_de_rodizio    : true
--   landing_aviso_na_fila            : 1
--   landing_aviso_para_o_unico_user  : true
--   landing_reenvio_nao_duplica      : 1
--   um_corretor_mantem_responsavel   : true
--   um_corretor_registra_estouro     : true
--   um_corretor_nao_conta_redistrib  : 0
--   um_corretor_nao_avisa_perda      : 0
--   um_corretor_avisa_gestao         : 1
--   um_corretor_aviso_uma_vez        : 1
--   com_outro_corretor_redistribui   : true
--   roleta_manual_mantem_responsavel : true

do $$
declare
  r jsonb := '{}'::jsonb;
  lead_key text;
  ingest_key text;
  token text;
  u_owner uuid := gen_random_uuid();
  u_b1 uuid := gen_random_uuid();
  u_b2 uuid := gen_random_uuid();
  u_solo uuid := gen_random_uuid();
  org uuid;
  org_solo uuid;
  page uuid;
  l1 uuid;
  l_portal uuid;
  l_portal2 uuid;
  l_landing uuid;
  l_um uuid;
  l_dois uuid;
  l_manual uuid;
  v_json jsonb;
  v_text text;
  v_int integer;
  v_bool boolean;
  v_uuid uuid;
  v_first timestamptz;
  v_event uuid := gen_random_uuid();
begin
  select ds.decrypted_secret into lead_key
  from vault.decrypted_secrets ds
  where ds.name = 'lead_server_key';

  select ds.decrypted_secret into ingest_key
  from vault.decrypted_secrets ds
  where ds.name = 'lead_ingest_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-aviso-dono@exemplo.invalid', now(), now(), now()),
    (u_b1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-aviso-b1@exemplo.invalid', now(), now(), now()),
    (u_b2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-aviso-b2@exemplo.invalid', now(), now(), now()),
    (u_solo, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-aviso-solo@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Aviso', 'teste-aviso-lead');

  update public.billing_accounts
  set limits = limits || '{"users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_b1, 'broker', true), (org, u_b2, 'broker', true);

  -- Prazo de 1 hora e rodízio desligado por enquanto.
  insert into public.lead_routing_settings (organization_id, roulette_enabled, sla_minutes)
  values (org, false, 60);

  -- ---------------------------------------------------------------------------
  -- 1. Primeiro contato gravado uma vez
  -- ---------------------------------------------------------------------------
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Primeiro Contato', '11977770001', 'manual', 'new', u_b1)
  returning id into l1;

  -- Entregue há 5 dias (assigned_at só é recalculado quando o responsável muda).
  update public.leads set assigned_at = now() - interval '5 days' where id = l1;

  -- 1º contato 3 min depois da entrega ("Registrar contato").
  update public.leads
  set last_contact_at = now() - interval '5 days' + interval '3 minutes',
      stage = 'contacted'
  where id = l1;

  select l.first_contact_at into v_first from public.leads l where l.id = l1;

  -- 2º contato dois dias depois: só o último contato muda.
  update public.leads
  set last_contact_at = now() - interval '3 days' + interval '3 minutes'
  where id = l1;

  select l.first_contact_at = v_first
     and v_first = now() - interval '5 days' + interval '3 minutes'
    into v_bool
  from public.leads l where l.id = l1;
  r := r || jsonb_build_object('primeiro_contato_nao_muda', coalesce(v_bool, false));

  select l.last_contact_at = now() - interval '3 days' + interval '3 minutes'
    into v_bool
  from public.leads l where l.id = l1;
  r := r || jsonb_build_object('ultimo_contato_atualiza', coalesce(v_bool, false));

  -- ---------------------------------------------------------------------------
  -- 2. Relatório por corretor: mediana e "no prazo" pelo 1º contato
  -- ---------------------------------------------------------------------------
  set local role authenticated;

  begin
    update public.leads set first_contact_at = now() where id = l1;
    r := r || jsonb_build_object('app_nao_escreve_primeiro_contato', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('app_nao_escreve_primeiro_contato', 'NEGADO:' || sqlstate);
  end;

  execute $q$
    select p.leads_answered || '/' || p.leads_in_sla || '/'
      || coalesce(p.first_response_median_minutes::text, '-')
    from public.report_broker_performance($1, now() - interval '30 days', now() + interval '1 day') p
    where p.user_id = $2
  $q$ into v_text using org, u_b1;
  r := r || jsonb_build_object('relatorio_usa_o_primeiro', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 3. Lead de portal (Grupo OLX): aviso na fila uma única vez
  -- ---------------------------------------------------------------------------
  token := public.enable_lead_webhook(org, 'canal_pro', false, 'Imobiliaria Teste Aviso');

  -- O webhook chega sem sessão.
  perform set_config('request.jwt.claims', '', true);

  v_json := public.ingest_webhook_lead(ingest_key, token, jsonb_build_object(
    'event_id', 'aviso-portal-1',
    'name', 'Pedro Portal',
    'phone', '11977770002',
    'origin', 'zapimoveis'
  ));
  r := r || jsonb_build_object('portal_status', v_json ->> 'status');
  l_portal := (v_json ->> 'lead_id')::uuid;

  select count(*)::integer into v_int
  from private.lead_notifications n
  where n.lead_id = l_portal and n.kind = 'assigned';
  r := r || jsonb_build_object('portal_aviso_na_fila', v_int);

  -- Sem responsável (rodízio desligado): o aviso vai para o dono.
  r := r || jsonb_build_object('portal_aviso_para_o_dono', exists (
    select 1 from private.lead_notifications n
    where n.lead_id = l_portal and n.kind = 'assigned' and n.user_id = u_owner
  ));

  -- O Grupo OLX repete a entrega: nada de aviso novo.
  perform public.ingest_webhook_lead(ingest_key, token, jsonb_build_object(
    'event_id', 'aviso-portal-1',
    'name', 'Pedro Portal',
    'phone', '11977770002'
  ));
  select count(*)::integer into v_int
  from private.lead_notifications n
  where n.lead_id = l_portal;
  r := r || jsonb_build_object('portal_reentrega_nao_duplica', v_int);

  -- O rodízio (ou outro caminho) tentando avisar de novo o mesmo lead.
  perform private.enqueue_new_lead_notice(l_portal);
  perform private.enqueue_lead_notification(l_portal, u_owner, 'assigned', 0::smallint, null);
  select count(*)::integer into v_int
  from private.lead_notifications n
  where n.lead_id = l_portal;
  r := r || jsonb_build_object('portal_rodizio_nao_duplica', v_int);

  -- Com o rodízio ligado e um corretor de plantão: o aviso vai para ele, uma vez.
  update public.lead_routing_settings set roulette_enabled = true where organization_id = org;
  insert into public.lead_routing_members (organization_id, user_id) values (org, u_b1);

  v_json := public.ingest_webhook_lead(ingest_key, token, jsonb_build_object(
    'event_id', 'aviso-portal-2',
    'name', 'Paula Portal',
    'phone', '11977770003'
  ));
  l_portal2 := (v_json ->> 'lead_id')::uuid;

  -- O que route_lead faria ao entregar o mesmo lead ao mesmo corretor.
  perform private.enqueue_lead_notification(l_portal2, u_b1, 'assigned', 0::smallint, null);

  select string_agg(
           case n.user_id when u_b1 then 'b1' when u_owner then 'dono' else 'outro' end, ','
         ) || ':' || count(*)
    into v_text
  from private.lead_notifications n
  where n.lead_id = l_portal2;
  r := r || jsonb_build_object('portal_com_roleta_avisa_corretor', v_text);

  -- ---------------------------------------------------------------------------
  -- 4. Landing page, imobiliária de 1 usuário, sem configuração de rodízio
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_solo, 'role', 'authenticated')::text, true);
  org_solo := public.create_organization('Corretor Autonomo Teste', 'teste-aviso-solo');

  insert into public.landing_pages (
    organization_id, template, name, slug, status, published_at, content
  )
  values (
    org_solo, 'campaign_valuation', 'Campanha Solo', 'campanha-solo', 'published', now(),
    jsonb_build_object('headline', 'Avalie seu imovel', 'cta_label', 'Quero avaliar')
  )
  returning id into page;

  r := r || jsonb_build_object('landing_sem_config_de_rodizio', not exists (
    select 1 from public.lead_routing_settings s where s.organization_id = org_solo
  ));

  -- O formulário público não tem sessão.
  perform set_config('request.jwt.claims', '', true);

  perform public.submit_landing_lead('teste-aviso-solo', 'campanha-solo',
    jsonb_build_object(
      'name', 'Visitante Solo', 'phone', '11977770004', 'consent', 'true',
      'event_id', v_event::text
    ),
    lead_key, repeat('s', 32), null);

  select l.id into l_landing
  from public.leads l
  where l.organization_id = org_solo and l.event_id = v_event;

  select count(*)::integer into v_int
  from private.lead_notifications n
  where n.organization_id = org_solo;
  r := r || jsonb_build_object('landing_aviso_na_fila', v_int);

  r := r || jsonb_build_object('landing_aviso_para_o_unico_user', exists (
    select 1 from private.lead_notifications n
    where n.lead_id = l_landing and n.kind = 'assigned' and n.user_id = u_solo
  ));

  -- Mesmo evento reenviado (duplo clique, nova tentativa do navegador).
  perform public.submit_landing_lead('teste-aviso-solo', 'campanha-solo',
    jsonb_build_object(
      'name', 'Visitante Solo', 'phone', '11977770004', 'consent', 'true',
      'event_id', v_event::text
    ),
    lead_key, repeat('t', 32), null);

  select count(*)::integer into v_int
  from private.lead_notifications n
  where n.organization_id = org_solo;
  r := r || jsonb_build_object('landing_reenvio_nao_duplica', v_int);

  -- ---------------------------------------------------------------------------
  -- 5. Rodízio com um único corretor elegível (b1): o lead não fica sem dono
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  update public.lead_routing_settings
  set sla_reassign_enabled = true, max_reassignments = 3
  where organization_id = org;

  insert into public.leads (organization_id, name, phone, source, stage)
  values (org, 'Lead Um Corretor', '11977770005', 'manual', 'new')
  returning id into l_um;

  update public.leads
  set assigned_at = now() - interval '2 hours',
      first_response_due_at = now() - interval '1 hour'
  where id = l_um;

  perform private.run_lead_routing_pass(200);

  select l.assigned_to = u_b1 into v_bool from public.leads l where l.id = l_um;
  r := r || jsonb_build_object('um_corretor_mantem_responsavel', coalesce(v_bool, false));

  select l.sla_breached_at is not null into v_bool from public.leads l where l.id = l_um;
  r := r || jsonb_build_object('um_corretor_registra_estouro', coalesce(v_bool, false));

  select l.sla_reassignments into v_int from public.leads l where l.id = l_um;
  r := r || jsonb_build_object('um_corretor_nao_conta_redistrib', v_int);

  select count(*)::integer into v_int
  from private.lead_notifications n
  where n.lead_id = l_um and n.kind = 'sla_lost';
  r := r || jsonb_build_object('um_corretor_nao_avisa_perda', v_int);

  select count(*)::integer into v_int
  from private.lead_notifications n
  where n.lead_id = l_um and n.kind = 'sla_breached' and n.user_id = u_owner;
  r := r || jsonb_build_object('um_corretor_avisa_gestao', v_int);

  -- A passada seguinte não repete o aviso.
  perform private.run_lead_routing_pass(200);
  select count(*)::integer into v_int
  from private.lead_notifications n
  where n.lead_id = l_um and n.kind = 'sla_breached';
  r := r || jsonb_build_object('um_corretor_aviso_uma_vez', v_int);

  -- Com outro corretor elegível, a redistribuição continua como antes.
  insert into public.lead_routing_members (organization_id, user_id) values (org, u_b2);

  insert into public.leads (organization_id, name, phone, source, stage)
  values (org, 'Lead Dois Corretores', '11977770006', 'manual', 'new')
  returning id into l_dois;

  select l.assigned_to into v_uuid from public.leads l where l.id = l_dois;

  update public.leads
  set assigned_at = now() - interval '2 hours',
      first_response_due_at = now() - interval '1 hour'
  where id = l_dois;

  perform private.run_lead_routing_pass(200);

  select l.assigned_to is not null
     and l.assigned_to <> v_uuid
     and l.sla_reassignments = 1
     and l.sla_breached_at is null
    into v_bool
  from public.leads l where l.id = l_dois;
  r := r || jsonb_build_object('com_outro_corretor_redistribui', coalesce(v_bool, false));

  -- Roleta manual com um único corretor na fila: o lead continua com ele.
  delete from public.lead_routing_members where organization_id = org and user_id = u_b2;

  insert into public.leads (organization_id, name, phone, source, stage)
  values (org, 'Lead Roleta Manual', '11977770007', 'manual', 'new')
  returning id into l_manual;

  v_json := public.assign_lead_from_roulette(org, l_manual);

  select l.assigned_to = u_b1 and (v_json ->> 'ok')::boolean = false
    into v_bool
  from public.leads l where l.id = l_manual;
  r := r || jsonb_build_object('roleta_manual_mantem_responsavel', coalesce(v_bool, false));

  raise exception 'RESULTADO: %', jsonb_pretty(r);
end;
$$;
