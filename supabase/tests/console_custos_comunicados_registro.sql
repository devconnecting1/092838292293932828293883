-- =============================================================================
-- Teste do Console da Plataforma: custos de IA, comunicados e retenção
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
-- Usa a chave `platform_server_key` do Vault (sem imprimir).
--
-- O que está sendo provado (migração platform_console_ai_costs_announcements_retention):
--   1. sem PLATFORM_SERVER_KEY (ou com a errada) as cinco RPCs novas recusam
--      com 42501;
--   2. platform_ai_costs devolve o custo, os tokens e as conversas exatamente
--      como estão em ai_usage_periods (ciclo atual e anterior), o teto do plano
--      de private.ai_cost_cap_cents e o câmbio de private.ai_pricing;
--   3. criar, editar e encerrar comunicado grava o registro na mesma transação
--      (e-mail do suporte no texto vira [e-mail] no antes/depois); conta de quem
--      agiu errada desfaz tudo; HTML, link sem https e fim no passado são
--      recusados; encerrado não se edita e encerrar de novo não registra;
--   4. RLS: corretor e usuário sem imobiliária veem só o comunicado "todos" no
--      ar; dono vê também o de donos e gerentes; agendado, vencido e encerrado
--      não aparecem; anon não lê; sessão não grava direto;
--   5. dispensa: só do comunicado que o usuário vê, uma vez, só as próprias
--      linhas; some da faixa só para quem dispensou;
--   6. retenção: DELETE fora da rotina é recusado (mesmo de linha antiga); a
--      rotina apaga só o registro com mais de 2 anos e as dispensas de
--      comunicados fora do ar há mais de 30 dias; job semanal agendado;
--   7. RPCs só para anon; rotina e tabelas sem acesso indevido.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   custos_sem_chave              : "NEGADO:42501"
--   custos_chave_errada           : "NEGADO:42501"
--   lista_comunicados_sem_chave   : "NEGADO:42501"
--   salvar_sem_chave              : "NEGADO:42501"
--   encerrar_sem_chave            : "NEGADO:42501"
--   filtros_sem_chave             : "NEGADO:42501"
--   custos_listou_imobiliaria     : true
--   custos_atual_bate             : true
--   custos_anterior_bate          : true
--   custos_teto_do_plano          : true
--   custos_cambio_do_banco        : true
--   custos_tetos_por_plano        : 5
--   custos_sem_email              : true
--   custos_sem_uso_fora_da_lista  : true
--   comunicado_criar_registrado   : 1
--   comunicado_email_mascarado    : true
--   comunicado_conta_errada       : "NEGADO:42501"
--   comunicado_conta_errada_nada  : 0
--   comunicado_html               : "NEGADO:23514"
--   comunicado_link_http          : "NEGADO:23514"
--   comunicado_fim_no_passado     : "NEGADO:22023"
--   comunicado_editar_registrado  : {"antes": "Teste P3 agendado", "depois": "Teste P3 agendado editado"}
--   comunicado_encerrar_registrado: 1
--   comunicado_encerrar_de_novo   : 1
--   comunicado_editar_encerrado   : "NEGADO:22023"
--   lista_comunicados_total       : 5
--   corretor_ve                   : ["Teste P3 todos"]
--   dono_ve                       : ["Teste P3 lideres", "Teste P3 todos"]
--   sem_imobiliaria_ve            : ["Teste P3 todos"]
--   anon_le                       : "NEGADO:42501"
--   sessao_grava_direto           : "NEGADO:42501"
--   dispensa_ok                   : true
--   dispensa_repetida             : "NEGADO:23505"
--   dispensa_nao_visivel          : "NEGADO:42501"
--   dispensa_agendado             : "NEGADO:42501"
--   dispensa_por_outro            : "NEGADO:42501"
--   dispensa_apagar               : "NEGADO:42501"
--   corretor_faixa_depois         : []
--   corretor_le_dispensas         : 1
--   dono_le_dispensas             : 0
--   dono_faixa_depois             : ["Teste P3 lideres", "Teste P3 todos"]
--   retencao_delete_sem_rotina    : "NEGADO:42501"
--   retencao_recente_com_flag     : "NEGADO:42501"
--   retencao_truncate             : "NEGADO:42501"
--   retencao_apagou_antigo        : true
--   retencao_manteve_recente      : true
--   retencao_apagou_dispensa_velha: true
--   retencao_manteve_dispensa_ativa: true
--   retencao_flag_desligada       : true
--   retencao_job                  : true
--   rpcs_para_anon                : true
--   rpcs_para_authenticated       : false
--   rotina_para_sessao            : false
--   comunicados_insert_sessao     : false
--   dispensas_update_sessao       : false

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_admin uuid := gen_random_uuid();
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_outsider uuid := gen_random_uuid();
  org uuid;
  ctx record;
  v_json jsonb;
  v_org jsonb;
  v_uuid uuid;
  a_all uuid;
  a_leaders uuid;
  a_scheduled uuid;
  a_ended uuid;
  a_expired uuid;
  a_old uuid;
  v_count integer;
  v_before bigint;
  v_old_event bigint;
  v_recent_event bigint;
  v_ended_at timestamptz;
  v_titles jsonb;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'platform_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-p3-equipe@exemplo.invalid', now(), now(), now()),
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-p3-dono@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-p3-corretor@exemplo.invalid', now(), now(), now()),
    (u_outsider, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-p3-sem-imob@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste P3', 'teste-p3-console');

  update public.billing_accounts
  set limits = limits || '{"users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_broker, 'broker', true);

  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------------------
  -- 1. Sem chave e com chave errada
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_ai_costs(null);
    r := r || jsonb_build_object('custos_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('custos_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_ai_costs('chave-errada');
    r := r || jsonb_build_object('custos_chave_errada', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('custos_chave_errada', 'NEGADO:42501');
  end;

  begin
    perform public.platform_list_announcements(null);
    r := r || jsonb_build_object('lista_comunicados_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('lista_comunicados_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_save_announcement(
      null, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Sem chave', 'Texto sem chave',
      'informacao', 'todos', now(), now() + interval '1 day');
    r := r || jsonb_build_object('salvar_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('salvar_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_end_announcement(
      null, u_admin, 'teste-p3-equipe@exemplo.invalid', gen_random_uuid());
    r := r || jsonb_build_object('encerrar_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('encerrar_sem_chave', 'NEGADO:42501');
  end;

  begin
    perform public.platform_audit_event_filters(null);
    r := r || jsonb_build_object('filtros_sem_chave', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('filtros_sem_chave', 'NEGADO:42501');
  end;

  -- ---------------------------------------------------------------------------
  -- 2. Custos de IA batem com ai_usage_periods
  -- ---------------------------------------------------------------------------
  select * into ctx from private.ai_quota_context(org, now());

  insert into public.ai_usage_periods (
    organization_id, period_start, period_end, conversations, requests, input_tokens,
    output_tokens, cache_read_tokens, cache_write_tokens, cost_millicents
  )
  values
    (org, ctx.period_start, ctx.period_end, 7, 31, 12000, 30000, 250000, 90000, 450123),
    (org, ctx.period_start - interval '1 month', ctx.period_start, 4, 20, 8000, 15000, 120000,
     60000, 210987);

  v_json := public.platform_ai_costs(key);

  select value into v_org
  from jsonb_array_elements(v_json -> 'organizations')
  where value ->> 'organization_id' = org::text;

  r := r || jsonb_build_object(
    'custos_listou_imobiliaria', v_org is not null,
    'custos_atual_bate', (
      select (v_org -> 'current' ->> 'cost_millicents')::bigint = p.cost_millicents
        and (v_org -> 'current' ->> 'conversations')::integer = p.conversations
        and (v_org -> 'current' ->> 'requests')::integer = p.requests
        and (v_org -> 'current' ->> 'input_tokens')::bigint = p.input_tokens
        and (v_org -> 'current' ->> 'output_tokens')::bigint = p.output_tokens
        and (v_org -> 'current' ->> 'cache_read_tokens')::bigint = p.cache_read_tokens
        and (v_org -> 'current' ->> 'cache_write_tokens')::bigint = p.cache_write_tokens
      from public.ai_usage_periods p
      where p.organization_id = org and p.period_start = ctx.period_start
    ),
    'custos_anterior_bate', (
      select (v_org -> 'previous' ->> 'cost_millicents')::bigint = p.cost_millicents
        and (v_org -> 'previous' ->> 'period_start')::timestamptz = p.period_start
      from public.ai_usage_periods p
      where p.organization_id = org and p.period_start = ctx.period_start - interval '1 month'
    ),
    'custos_teto_do_plano',
    (v_org ->> 'plan_cap_cents')::integer = private.ai_cost_cap_cents(ctx.plan_key)
      and (v_org ->> 'plan_key') = ctx.plan_key,
    'custos_cambio_do_banco',
    (v_json -> 'pricing' ->> 'exchange_rate')::numeric = (select p.exchange_rate from private.ai_pricing() p),
    'custos_tetos_por_plano', (select count(*) from jsonb_object_keys(v_json -> 'plan_caps_cents')),
    'custos_sem_email', v_json::text !~ '[^[:space:]@"]+@[^[:space:]@"]+',
    'custos_sem_uso_fora_da_lista',
    jsonb_array_length(v_json -> 'organizations') <= (v_json ->> 'organizations_total')::integer
      and not exists (
        select 1
        from jsonb_array_elements(v_json -> 'organizations') e
        where e.value -> 'current' = 'null'::jsonb and e.value -> 'previous' = 'null'::jsonb
      )
  );

  -- ---------------------------------------------------------------------------
  -- 3. Criar, editar e encerrar comunicado (com registro)
  -- ---------------------------------------------------------------------------
  a_all := public.platform_save_announcement(
    key, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Teste P3 todos',
    'Dúvidas? Escreva para suporte@exemplo.invalid.', 'informacao', 'todos',
    now() - interval '1 hour', now() + interval '1 day',
    'https://exemplo.invalid/novidades', 'Ver novidades');

  a_leaders := public.platform_save_announcement(
    key, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Teste P3 lideres',
    'Mudança na cobrança no próximo mês.', 'atencao', 'donos_e_gerentes',
    now() - interval '1 hour', now() + interval '1 day');

  a_scheduled := public.platform_save_announcement(
    key, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Teste P3 agendado',
    'Manutenção programada no domingo.', 'manutencao', 'todos',
    now() + interval '1 day', now() + interval '2 days');

  a_ended := public.platform_save_announcement(
    key, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Teste P3 encerrado',
    'Este aviso vai ser encerrado.', 'informacao', 'todos',
    now() - interval '1 hour', now() + interval '1 day');

  r := r || jsonb_build_object(
    'comunicado_criar_registrado', (
      select count(*)
      from private.platform_audit_events e
      where e.action = 'comunicado.criar' and e.target_type = 'comunicado'
        and e.target_id = a_all::text and e.actor_user_id = u_admin
    ),
    'comunicado_email_mascarado', (
      select e.after_data ->> 'texto' = 'Dúvidas? Escreva para [e-mail]'
      from private.platform_audit_events e
      where e.action = 'comunicado.criar' and e.target_id = a_all::text
    )
  );

  select count(*) into v_count from public.platform_announcements;

  begin
    perform public.platform_save_announcement(
      key, u_admin, 'outra-pessoa@exemplo.invalid', 'Teste P3 conta errada',
      'Não deveria gravar.', 'informacao', 'todos', now(), now() + interval '1 day');
    r := r || jsonb_build_object('comunicado_conta_errada', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('comunicado_conta_errada', 'NEGADO:42501');
  end;

  r := r || jsonb_build_object(
    'comunicado_conta_errada_nada', (select count(*) from public.platform_announcements) - v_count);

  begin
    perform public.platform_save_announcement(
      key, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Teste P3 html',
      '<b>negrito</b>', 'informacao', 'todos', now(), now() + interval '1 day');
    r := r || jsonb_build_object('comunicado_html', 'PASSOU');
  exception when sqlstate '23514' then
    r := r || jsonb_build_object('comunicado_html', 'NEGADO:23514');
  end;

  begin
    perform public.platform_save_announcement(
      key, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Teste P3 link',
      'Link sem https.', 'informacao', 'todos', now(), now() + interval '1 day',
      'http://exemplo.invalid/pagina', 'Abrir');
    r := r || jsonb_build_object('comunicado_link_http', 'PASSOU');
  exception when sqlstate '23514' then
    r := r || jsonb_build_object('comunicado_link_http', 'NEGADO:23514');
  end;

  begin
    perform public.platform_save_announcement(
      key, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Teste P3 passado',
      'Fim no passado.', 'informacao', 'todos', now() - interval '2 days', now() - interval '1 day');
    r := r || jsonb_build_object('comunicado_fim_no_passado', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('comunicado_fim_no_passado', 'NEGADO:22023');
  end;

  perform public.platform_save_announcement(
    key, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Teste P3 agendado editado',
    'Manutenção programada no domingo.', 'manutencao', 'todos',
    now() + interval '1 day', now() + interval '2 days', null, null, a_scheduled);

  r := r || jsonb_build_object(
    'comunicado_editar_registrado', (
      select jsonb_build_object('antes', e.before_data ->> 'titulo', 'depois', e.after_data ->> 'titulo')
      from private.platform_audit_events e
      where e.action = 'comunicado.editar' and e.target_id = a_scheduled::text
    )
  );

  v_ended_at := public.platform_end_announcement(
    key, u_admin, 'teste-p3-equipe@exemplo.invalid', a_ended, 'Aviso publicado por engano');

  r := r || jsonb_build_object(
    'comunicado_encerrar_registrado', (
      select count(*)
      from private.platform_audit_events e
      where e.action = 'comunicado.encerrar' and e.target_id = a_ended::text
        and e.reason = 'Aviso publicado por engano'
        and (e.after_data ->> 'encerrado_em') is not null
    )
  );

  perform public.platform_end_announcement(
    key, u_admin, 'teste-p3-equipe@exemplo.invalid', a_ended);

  r := r || jsonb_build_object(
    'comunicado_encerrar_de_novo', (
      select count(*)
      from private.platform_audit_events e
      where e.action = 'comunicado.encerrar' and e.target_id = a_ended::text
    )
  );

  begin
    perform public.platform_save_announcement(
      key, u_admin, 'teste-p3-equipe@exemplo.invalid', 'Teste P3 reabrir',
      'Não pode editar encerrado.', 'informacao', 'todos', now(), now() + interval '1 day',
      null, null, a_ended);
    r := r || jsonb_build_object('comunicado_editar_encerrado', 'PASSOU');
  exception when sqlstate '22023' then
    r := r || jsonb_build_object('comunicado_editar_encerrado', 'NEGADO:22023');
  end;

  -- Vencido (só dá para gravar direto: a RPC recusa fim no passado).
  insert into public.platform_announcements (title, body, kind, audience, starts_at, ends_at)
  values ('Teste P3 vencido', 'Já passou do fim.', 'informacao', 'todos',
          now() - interval '3 days', now() - interval '1 day')
  returning id into a_expired;

  r := r || jsonb_build_object(
    'lista_comunicados_total', (
      select count(*)
      from public.platform_list_announcements(key, 200) l
      where l.id in (a_all, a_leaders, a_scheduled, a_ended, a_expired)
    )
  );

  -- ---------------------------------------------------------------------------
  -- 4. RLS por público e período
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute $q$
    select coalesce(jsonb_agg(a.title order by a.title), '[]'::jsonb)
    from public.platform_announcements a
    where a.title like 'Teste P3%'
  $q$ into v_titles;
  reset role;
  r := r || jsonb_build_object('corretor_ve', v_titles);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute $q$
    select coalesce(jsonb_agg(a.title order by a.title), '[]'::jsonb)
    from public.platform_announcements a
    where a.title like 'Teste P3%'
  $q$ into v_titles;
  reset role;
  r := r || jsonb_build_object('dono_ve', v_titles);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute $q$
    select coalesce(jsonb_agg(a.title order by a.title), '[]'::jsonb)
    from public.platform_announcements a
    where a.title like 'Teste P3%'
  $q$ into v_titles;
  reset role;
  r := r || jsonb_build_object('sem_imobiliaria_ve', v_titles);

  perform set_config('request.jwt.claims', '', true);
  begin
    set local role anon;
    execute 'select count(*) from public.platform_announcements' into v_count;
    reset role;
    r := r || jsonb_build_object('anon_le', 'PASSOU');
  exception when sqlstate '42501' then
    reset role;
    r := r || jsonb_build_object('anon_le', 'NEGADO:42501');
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    execute $q$
      insert into public.platform_announcements (title, body, kind, audience, starts_at, ends_at)
      values ('Teste P3 direto', 'Gravado direto.', 'informacao', 'todos', now(), now() + interval '1 day')
    $q$;
    reset role;
    r := r || jsonb_build_object('sessao_grava_direto', 'PASSOU');
  exception when sqlstate '42501' then
    reset role;
    r := r || jsonb_build_object('sessao_grava_direto', 'NEGADO:42501');
  end;

  -- ---------------------------------------------------------------------------
  -- 5. Dispensa por usuário
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);

  begin
    set local role authenticated;
    execute 'insert into public.platform_announcement_dismissals (announcement_id) values ($1)'
      using a_all;
    reset role;
    r := r || jsonb_build_object('dispensa_ok', true);
  exception when others then
    reset role;
    r := r || jsonb_build_object('dispensa_ok', 'ERRO:' || sqlstate);
  end;

  begin
    set local role authenticated;
    execute 'insert into public.platform_announcement_dismissals (announcement_id) values ($1)'
      using a_all;
    reset role;
    r := r || jsonb_build_object('dispensa_repetida', 'PASSOU');
  exception when sqlstate '23505' then
    reset role;
    r := r || jsonb_build_object('dispensa_repetida', 'NEGADO:23505');
  end;

  begin
    set local role authenticated;
    execute 'insert into public.platform_announcement_dismissals (announcement_id) values ($1)'
      using a_leaders;
    reset role;
    r := r || jsonb_build_object('dispensa_nao_visivel', 'PASSOU');
  exception when sqlstate '42501' then
    reset role;
    r := r || jsonb_build_object('dispensa_nao_visivel', 'NEGADO:42501');
  end;

  begin
    set local role authenticated;
    execute 'insert into public.platform_announcement_dismissals (announcement_id) values ($1)'
      using a_scheduled;
    reset role;
    r := r || jsonb_build_object('dispensa_agendado', 'PASSOU');
  exception when sqlstate '42501' then
    reset role;
    r := r || jsonb_build_object('dispensa_agendado', 'NEGADO:42501');
  end;

  begin
    set local role authenticated;
    execute 'insert into public.platform_announcement_dismissals (user_id, announcement_id) values ($1, $2)'
      using u_owner, a_all;
    reset role;
    r := r || jsonb_build_object('dispensa_por_outro', 'PASSOU');
  exception when sqlstate '42501' then
    reset role;
    r := r || jsonb_build_object('dispensa_por_outro', 'NEGADO:42501');
  end;

  begin
    set local role authenticated;
    execute 'delete from public.platform_announcement_dismissals where announcement_id = $1'
      using a_all;
    reset role;
    r := r || jsonb_build_object('dispensa_apagar', 'PASSOU');
  exception when sqlstate '42501' then
    reset role;
    r := r || jsonb_build_object('dispensa_apagar', 'NEGADO:42501');
  end;

  -- Faixa do corretor = comunicados no ar sem dispensa dele.
  set local role authenticated;
  execute $q$
    select coalesce(jsonb_agg(a.title order by a.title), '[]'::jsonb)
    from public.platform_announcements a
    where a.title like 'Teste P3%'
      and not exists (
        select 1 from public.platform_announcement_dismissals d where d.announcement_id = a.id
      )
  $q$ into v_titles;
  execute 'select count(*) from public.platform_announcement_dismissals' into v_count;
  reset role;
  r := r || jsonb_build_object('corretor_faixa_depois', v_titles, 'corretor_le_dispensas', v_count);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select count(*) from public.platform_announcement_dismissals' into v_count;
  execute $q$
    select coalesce(jsonb_agg(a.title order by a.title), '[]'::jsonb)
    from public.platform_announcements a
    where a.title like 'Teste P3%'
      and not exists (
        select 1 from public.platform_announcement_dismissals d where d.announcement_id = a.id
      )
  $q$ into v_titles;
  reset role;
  r := r || jsonb_build_object('dono_le_dispensas', v_count, 'dono_faixa_depois', v_titles);

  perform set_config('request.jwt.claims', '', true);

  -- ---------------------------------------------------------------------------
  -- 6. Retenção
  -- ---------------------------------------------------------------------------
  insert into private.platform_audit_events (occurred_at, actor_user_id, actor_email, action)
  values (now() - interval '2 years 1 day', u_admin, 'teste-p3-equipe@exemplo.invalid', 'teste.retencao')
  returning id into v_old_event;

  insert into private.platform_audit_events (occurred_at, actor_user_id, actor_email, action)
  values (now() - interval '1 year 11 months', u_admin, 'teste-p3-equipe@exemplo.invalid', 'teste.retencao')
  returning id into v_recent_event;

  begin
    delete from private.platform_audit_events where id = v_old_event;
    r := r || jsonb_build_object('retencao_delete_sem_rotina', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('retencao_delete_sem_rotina', 'NEGADO:42501');
  end;

  begin
    perform set_config('private.platform_audit_purge', 'on', true);
    delete from private.platform_audit_events where id = v_recent_event;
    r := r || jsonb_build_object('retencao_recente_com_flag', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('retencao_recente_com_flag', 'NEGADO:42501');
  end;
  perform set_config('private.platform_audit_purge', 'off', true);

  begin
    truncate private.platform_audit_events;
    r := r || jsonb_build_object('retencao_truncate', 'PASSOU');
  exception when sqlstate '42501' then
    r := r || jsonb_build_object('retencao_truncate', 'NEGADO:42501');
  end;

  -- Comunicado fora do ar há 40 dias, com dispensa antiga.
  insert into public.platform_announcements (title, body, kind, audience, starts_at, ends_at)
  values ('Teste P3 antigo', 'Saiu do ar faz tempo.', 'informacao', 'todos',
          now() - interval '60 days', now() - interval '40 days')
  returning id into a_old;

  insert into public.platform_announcement_dismissals (user_id, announcement_id, dismissed_at)
  values (u_broker, a_old, now() - interval '50 days');

  perform private.purge_platform_audit_events();

  r := r || jsonb_build_object(
    'retencao_apagou_antigo', not exists (select 1 from private.platform_audit_events where id = v_old_event),
    'retencao_manteve_recente', exists (select 1 from private.platform_audit_events where id = v_recent_event),
    'retencao_apagou_dispensa_velha', not exists (
      select 1 from public.platform_announcement_dismissals where announcement_id = a_old),
    'retencao_manteve_dispensa_ativa', exists (
      select 1 from public.platform_announcement_dismissals
      where announcement_id = a_all and user_id = u_broker),
    'retencao_flag_desligada', current_setting('private.platform_audit_purge', true) = 'off',
    'retencao_job', exists (
      select 1 from cron.job j
      where j.jobname = 'retencao-registro-console' and j.schedule = '35 4 * * 0' and j.active
        and j.command ilike '%private.purge_platform_audit_events()%')
  );

  -- ---------------------------------------------------------------------------
  -- 7. Privilégios
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'rpcs_para_anon',
    has_function_privilege('anon', 'public.platform_ai_costs(text)', 'execute')
      and has_function_privilege('anon', 'public.platform_list_announcements(text, integer)', 'execute')
      and has_function_privilege('anon',
        'public.platform_save_announcement(text, uuid, text, text, text, text, text, timestamptz, timestamptz, text, text, uuid)',
        'execute')
      and has_function_privilege('anon', 'public.platform_end_announcement(text, uuid, text, uuid, text)', 'execute')
      and has_function_privilege('anon', 'public.platform_audit_event_filters(text)', 'execute'),
    'rpcs_para_authenticated',
    has_function_privilege('authenticated', 'public.platform_ai_costs(text)', 'execute')
      or has_function_privilege('authenticated', 'public.platform_list_announcements(text, integer)', 'execute')
      or has_function_privilege('authenticated',
        'public.platform_save_announcement(text, uuid, text, text, text, text, text, timestamptz, timestamptz, text, text, uuid)',
        'execute')
      or has_function_privilege('authenticated', 'public.platform_end_announcement(text, uuid, text, uuid, text)', 'execute')
      or has_function_privilege('authenticated', 'public.platform_audit_event_filters(text)', 'execute'),
    'rotina_para_sessao',
    has_function_privilege('anon', 'private.purge_platform_audit_events()', 'execute')
      or has_function_privilege('authenticated', 'private.purge_platform_audit_events()', 'execute'),
    'comunicados_insert_sessao',
    has_table_privilege('authenticated', 'public.platform_announcements', 'insert')
      or has_table_privilege('authenticated', 'public.platform_announcements', 'update')
      or has_table_privilege('anon', 'public.platform_announcements', 'select'),
    'dispensas_update_sessao',
    has_table_privilege('authenticated', 'public.platform_announcement_dismissals', 'update')
      or has_table_privilege('authenticated', 'public.platform_announcement_dismissals', 'delete')
      or has_column_privilege('authenticated', 'public.platform_announcement_dismissals', 'user_id', 'insert')
  );

  raise exception 'TESTE CONSOLE CUSTOS COMUNICADOS REGISTRO (rollback): %', r;
end;
$$;
