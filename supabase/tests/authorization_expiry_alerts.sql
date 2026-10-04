-- =============================================================================
-- Teste da autorização vencendo: estado, filtro da lista, Painel e avisos
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- Imóveis do cenário (hoje = data de São Paulo):
--   P1 ativo, autorização até hoje+10         -> expiring (marco 15)
--   P2 ativo, autorização vencida ontem       -> expired
--   P3 ativo, vence em 10 dias mas renovada   -> active
--   P4 vendido, vence em 5 dias               -> fora da carteira
--   P5 ativo, vence em 40 dias                -> active
--   P6 ativo, vence hoje                      -> expiring (marco 1)
--   P7 ativo, sem autorização                 -> none
--
-- Resultado esperado (a ordem das chaves pode variar):
--   estados                          : "expiring,expired,active,expiring,active,expiring,none"
--   marcos                           : "null,30,30,15,15,7,7,1,1,null"
--   filtro_vencendo                  : 2
--   filtro_vencida                   : 1
--   filtro_valor_invalido_ignorado   : 7
--   coluna_estado_na_lista           : true
--   estranho_filtro_vencendo         : 0
--   painel_totais                    : "2/1"
--   painel_primeiro_vence_hoje       : true
--   estranho_no_painel               : "0/0"
--   primeira_drenagem                : 4
--   marcos_da_drenagem               : "1,15"
--   destinatarios                    : 2
--   dono_marcado_como_gestao         : true
--   gerente_sem_email_confirmado_fora: true
--   settle                           : {"sent": 2, "failed": 1, "released": 1}
--   liberado_sem_gastar_tentativa    : true
--   segunda_drenagem                 : 2
--   aviso_nao_repete_marco           : 0
--   fila_idempotente                 : 6
--   renovacao_abre_novo_marco        : "30:2"
--   rpc_sem_chave                    : "NEGADO:42501"
--   grant_claim_anon                 : true
--   grant_claim_authenticated        : false
--   grant_painel_anon                : false
--   grant_lista_anon                 : false

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_manager uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  cliente uuid;
  p1 uuid;
  p2 uuid;
  p3 uuid;
  p4 uuid;
  p5 uuid;
  p6 uuid;
  p7 uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_text text;
  v_int integer;
  v_bool boolean;
  v_ids_sent uuid[];
  v_id_failed uuid;
  v_id_released uuid;
  res jsonb;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'notification_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-autorizacao-dono@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-autorizacao-corretor@exemplo.invalid', now(), now(), now()),
    -- Gerente sem e-mail confirmado: entra na fila, mas não é reservado.
    (u_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-autorizacao-gerente@exemplo.invalid', null, now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-autorizacao-estranho@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Autorizacao', 'teste-autorizacao-vencendo');

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_broker, 'broker', true), (org, u_manager, 'manager', true);

  insert into public.clients (organization_id, kind, name)
  values (org, 'pf', 'Proprietario do Teste')
  returning id into cliente;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, captured_by, broker_id
  )
  values (org, 'P1 vence em 10 dias', 'sale', 'apartment', 'active', 500000, 80, u_broker, u_broker)
  returning id into p1;
  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, captured_by, broker_id
  )
  values (org, 'P2 vencida', 'sale', 'apartment', 'active', 500000, 80, u_broker, u_broker)
  returning id into p2;
  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, captured_by, broker_id
  )
  values (org, 'P3 renovada', 'sale', 'apartment', 'active', 500000, 80, u_broker, u_broker)
  returning id into p3;
  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, captured_by, broker_id
  )
  values (org, 'P4 vendido', 'sale', 'apartment', 'sold', 500000, 80, u_broker, u_broker)
  returning id into p4;
  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, captured_by, broker_id
  )
  values (org, 'P5 vence em 40 dias', 'sale', 'apartment', 'active', 500000, 80, u_broker, u_broker)
  returning id into p5;
  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, captured_by, broker_id
  )
  values (org, 'P6 vence hoje', 'sale', 'apartment', 'active', 500000, 80, u_broker, u_broker)
  returning id into p6;
  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, captured_by, broker_id
  )
  values (org, 'P7 sem autorizacao', 'sale', 'apartment', 'active', 500000, 80, u_broker, u_broker)
  returning id into p7;

  insert into public.listing_authorizations (organization_id, property_id, owner_client_id, exclusive, starts_on, ends_on)
  values
    (org, p1, cliente, true, v_today - 80, v_today + 10),
    (org, p2, cliente, false, v_today - 90, v_today - 1),
    (org, p3, cliente, false, v_today - 80, v_today + 10),
    (org, p3, cliente, false, v_today + 11, v_today + 200),
    (org, p4, cliente, false, v_today - 80, v_today + 5),
    (org, p5, cliente, false, v_today - 50, v_today + 40),
    (org, p6, cliente, false, v_today - 30, v_today);

  -- ---------------------------------------------------------------------------
  -- 1. Estado e marcos
  -- ---------------------------------------------------------------------------
  select string_agg(s.state, ',' order by x.ord) into v_text
  from unnest(array[p1, p2, p3, p4, p5, p6, p7]) with ordinality as x(pid, ord)
  cross join lateral private.listing_authorization_state(org, x.pid, v_today) s;
  r := r || jsonb_build_object('estados', v_text);

  select string_agg(coalesce(private.authorization_alert_milestone(d)::text, 'null'), ',' order by ord)
    into v_text
  from unnest(array[31, 30, 16, 15, 8, 7, 2, 1, 0, -1]) with ordinality as x(d, ord);
  r := r || jsonb_build_object('marcos', v_text);

  -- ---------------------------------------------------------------------------
  -- 2. Lista de imóveis e Painel com a sessão do dono (RLS)
  -- ---------------------------------------------------------------------------
  begin
    execute 'set local role authenticated';

    select count(*)::integer into v_int
    from public.search_properties(org, p_limit => 100, p_authorization => 'expiring');
    r := r || jsonb_build_object('filtro_vencendo', v_int);

    select count(*)::integer into v_int
    from public.search_properties(org, p_limit => 100, p_authorization => 'expired');
    r := r || jsonb_build_object('filtro_vencida', v_int);

    select count(*)::integer into v_int
    from public.search_properties(org, p_limit => 100, p_authorization => 'none');
    r := r || jsonb_build_object('filtro_valor_invalido_ignorado', v_int);

    select sp.authorization_state = 'expiring' and sp.authorization_ends_on = v_today + 10
      into v_bool
    from public.search_properties(org, p_limit => 100) sp
    where sp.id = p1;
    r := r || jsonb_build_object('coluna_estado_na_lista', coalesce(v_bool, false));

    res := public.dashboard_authorization_alerts(org, 5);
    r := r || jsonb_build_object(
      'painel_totais', (res ->> 'expiring_total') || '/' || (res ->> 'expired_total')
    );
    r := r || jsonb_build_object(
      'painel_primeiro_vence_hoje',
      (res #>> '{items,0,property_id}')::uuid = p6 and (res #>> '{items,0,days_left}')::integer = 0
    );

    perform set_config('request.jwt.claims',
      json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);

    select count(*)::integer into v_int
    from public.search_properties(org, p_limit => 100, p_authorization => 'expiring');
    r := r || jsonb_build_object('estranho_filtro_vencendo', v_int);

    res := public.dashboard_authorization_alerts(org, 5);
    r := r || jsonb_build_object(
      'estranho_no_painel', (res ->> 'expiring_total') || '/' || (res ->> 'expired_total')
    );

    execute 'reset role';
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('sessao_erro', sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 3. Fila de avisos: reserva, confirmação e "um aviso por marco"
  -- ---------------------------------------------------------------------------
  create temporary table teste_aviso on commit drop as
  select * from public.claim_authorization_alerts(key, 500) c where c.organization_id = org;

  select count(*)::integer into v_int from teste_aviso;
  r := r || jsonb_build_object('primeira_drenagem', v_int);

  select string_agg(distinct milestone::text, ',' order by milestone::text) into v_text from teste_aviso;
  r := r || jsonb_build_object('marcos_da_drenagem', v_text);

  select count(distinct recipient_user_id)::integer into v_int from teste_aviso;
  r := r || jsonb_build_object('destinatarios', v_int);

  select bool_and(recipient_is_manager = (recipient_user_id = u_owner)) into v_bool from teste_aviso;
  r := r || jsonb_build_object('dono_marcado_como_gestao', coalesce(v_bool, false));

  select not exists (select 1 from teste_aviso where recipient_user_id = u_manager) into v_bool;
  r := r || jsonb_build_object('gerente_sem_email_confirmado_fora', v_bool);

  select array_agg(id) into v_ids_sent from teste_aviso where property_id = p1;
  select id into v_id_failed from teste_aviso where property_id = p6 and recipient_user_id = u_owner;
  select id into v_id_released from teste_aviso where property_id = p6 and recipient_user_id = u_broker;

  res := public.settle_authorization_alerts(key, v_ids_sent, array[v_id_failed], array[v_id_released]);
  r := r || jsonb_build_object('settle', res);

  select n.attempts = 0 and n.claimed_at is null into v_bool
  from private.authorization_alert_notifications n where n.id = v_id_released;
  r := r || jsonb_build_object('liberado_sem_gastar_tentativa', coalesce(v_bool, false));

  truncate teste_aviso;
  insert into teste_aviso
  select * from public.claim_authorization_alerts(key, 500) c where c.organization_id = org;

  select count(*)::integer into v_int from teste_aviso;
  r := r || jsonb_build_object('segunda_drenagem', v_int);

  select count(*)::integer into v_int from teste_aviso where property_id = p1;
  r := r || jsonb_build_object('aviso_nao_repete_marco', v_int);

  select count(*)::integer into v_int
  from private.authorization_alert_notifications n where n.organization_id = org;
  r := r || jsonb_build_object('fila_idempotente', v_int);

  -- Renovação: a nova data final abre os marcos de novo (25 dias -> marco 30).
  update public.listing_authorizations set ends_on = v_today + 25 where property_id = p1;
  update private.authorization_alert_notifications set sent_at = now()
  where organization_id = org and property_id = p6;

  truncate teste_aviso;
  insert into teste_aviso
  select * from public.claim_authorization_alerts(key, 500) c where c.organization_id = org;

  select string_agg(distinct milestone::text, ',') || ':' || count(*) into v_text
  from teste_aviso where property_id = p1;
  r := r || jsonb_build_object('renovacao_abre_novo_marco', v_text);

  -- ---------------------------------------------------------------------------
  -- 4. Permissões
  -- ---------------------------------------------------------------------------
  begin
    perform public.claim_authorization_alerts('chave-errada', 10);
    r := r || jsonb_build_object('rpc_sem_chave', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('rpc_sem_chave', 'NEGADO:' || sqlstate);
  end;

  r := r || jsonb_build_object(
    'grant_claim_anon',
    has_function_privilege('anon', 'public.claim_authorization_alerts(text, integer)', 'execute'),
    'grant_claim_authenticated',
    has_function_privilege('authenticated', 'public.claim_authorization_alerts(text, integer)', 'execute'),
    'grant_painel_anon',
    has_function_privilege('anon', 'public.dashboard_authorization_alerts(uuid, integer)', 'execute'),
    'grant_lista_anon',
    has_function_privilege(
      'anon',
      'public.search_properties(uuid, text, public.property_status, public.listing_purpose, public.property_type, numeric, numeric, integer, integer, integer, text)',
      'execute'
    )
  );

  raise exception 'TESTE autorizacao vencendo (rollback): %', jsonb_pretty(r);
end;
$$;
