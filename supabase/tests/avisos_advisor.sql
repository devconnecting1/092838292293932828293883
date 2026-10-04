-- =============================================================================
-- Teste dos avisos do Security/Performance Advisor
-- =============================================================================
-- Migrações private_tables_explicit_deny_policies, advisor_rpc_least_privilege
-- e drop_redundant_indexes. Bloco único, sem efeito no banco: cria os dados,
-- confere tudo e termina com `raise exception` — o resultado sai na mensagem do
-- erro (P0001) e a transação inteira é desfeita. Rode no SQL Editor do projeto
-- ou pelo MCP execute_sql (sozinho, sem outra instrução na mesma chamada).
--
-- Cobre:
--   1. private: toda tabela tem RLS e a política RESTRICTIVE de negação para
--      anon/authenticated; mesmo com grant e política permissiva criados por
--      engano (dentro do teste), authenticated não vê nenhuma linha; funções
--      security definer continuam lendo (get_public_status como anon) e
--      gravando (record_billing_webhook_delivery como anon, com a chave).
--   2. RPCs com p_server_key: security definer, search_path vazio, EXECUTE só
--      para anon e, chamadas como anon com a chave errada, todas recusam com
--      42501 antes de qualquer outra coisa.
--   3. RPCs públicas (landing, imóvel, sitemap, status, proposta): EXECUTE só
--      para anon; com sessão, 42501. get_portal_feed e get_invitation_preview
--      seguem com anon e authenticated (prévia do feed e convite com sessão).
--   4. RPCs de sessão: nenhuma executável por anon, todas com search_path
--      vazio; chamadas por um usuário logado de fora da imobiliária, nenhuma
--      devolve dado.
--   5. get_lead_stage_metrics (security invoker): para dono, gerente e
--      assistente, o mesmo resultado do cálculo sem RLS; corretor e estranho
--      recebem 42501.
--   6. lead_integrations: SELECT só por coluna (webhook_token, secret_id e
--      poll_cursor fora); o dono lê o endereço só pela RPC.
--   7. índices redundantes removidos e toda chave estrangeira com índice.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   private_tabelas_sem_negacao           : 0
--   private_tem_linhas                    : true
--   private_grant_por_engano_ve_linhas    : 0
--   definer_le_private_como_anon          : true
--   definer_grava_private_como_anon       : true
--   servidor_total                        : 94
--   servidor_catalogo_fora_do_padrao      : []
--   servidor_sem_chave_nao_recusou        : {}
--   publicas_catalogo_fora_do_padrao      : []
--   publicas_anon_funciona                : true
--   publicas_com_sessao                   : "NEGADO:42501|NEGADO:42501|NEGADO:42501|NEGADO:42501|NEGADO:42501"
--   feed_e_convite_com_sessao             : true
--   sessao_total                          : 49
--   sessao_catalogo_fora_do_padrao        : []
--   sessao_estranho_recebeu_dado          : {}
--   metricas_invoker                      : true
--   metricas_dono_igual_sem_rls           : true
--   metricas_gerente_igual_sem_rls        : true
--   metricas_assistente_igual_sem_rls     : true
--   metricas_tem_dados                    : true
--   metricas_corretor                     : "NEGADO:42501"
--   metricas_estranho                     : "NEGADO:42501"
--   metricas_rls_corretor_ve_menos        : true
--   integracoes_grant_por_coluna          : true
--   integracoes_dono_le_status            : "connected"
--   integracoes_dono_le_token_direto      : "NEGADO:42501"
--   integracoes_rpc_devolve_endereco      : true
--   indices_removidos_restantes           : 0
--   fks_sem_indice                        : 0
--
-- Os totais crescem a cada RPC nova. Rodado em 17/09/2026 depois da migração
-- 20260917140155_organization_and_account_deletion: sessao_total 49 (era 43 depois
-- da lixeira; +5 da exclusão de imobiliária/conta e +1 de outra migração do dia) e
-- servidor_total 94; todas as demais chaves conferem.

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_manager uuid := gen_random_uuid();
  u_assistant uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  lead_a uuid;
  lead_b uuid;
  v_fn record;
  v_args text;
  v_outcome text;
  v_json jsonb;
  v_base jsonb;
  v_text text;
  v_int integer;
  v_total integer;
  v_list text[];
  v_map jsonb;
  v_billing_key text;
  v_public_fns constant text[] := array[
    'get_public_organization', 'get_public_landing_page', 'get_public_status',
    'get_shared_proposal', 'register_shared_proposal_view', 'get_public_property',
    'get_public_sitemap'
  ];
  v_public_with_session constant text[] := array['get_portal_feed', 'get_invitation_preview'];
begin
  -- ---------------------------------------------------------------------------
  -- Cenário: dono (cria a imobiliária), gerente, assistente, corretor e estranho
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-advisor-dono@exemplo.invalid', now(), now(), now()),
    (u_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-advisor-gerente@exemplo.invalid', now(), now(), now()),
    (u_assistant, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-advisor-assistente@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-advisor-corretor@exemplo.invalid', now(), now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-advisor-estranho@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Advisor', 'teste-advisor-avisos');

  insert into public.memberships (organization_id, user_id, role, active)
  values
    (org, u_manager, 'manager', true),
    (org, u_assistant, 'assistant', true),
    (org, u_broker, 'broker', true);

  -- ---------------------------------------------------------------------------
  -- 1. Schema private
  -- ---------------------------------------------------------------------------
  select count(*) into v_int
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relkind in ('r', 'p')
    and (
      not c.relrowsecurity
      or not exists (
        select 1
        from pg_catalog.pg_policy p
        where p.polrelid = c.oid
          and not p.polpermissive
          and p.polcmd = '*'
          and p.polroles @> array['anon'::regrole::oid, 'authenticated'::regrole::oid]
          and pg_get_expr(p.polqual, p.polrelid) = 'false'
          and pg_get_expr(p.polwithcheck, p.polrelid) = 'false'
      )
    );
  r := r || jsonb_build_object('private_tabelas_sem_negacao', v_int);

  -- Trava: grant e política permissiva "por engano" não abrem nada.
  -- A contagem só prova algo se a tabela tiver linhas; num banco vazio (CI) ela
  -- não tem, então o teste grava um resumo de um dia antigo (desfeito no fim),
  -- e o resultado é o mesmo na nuvem e no banco vazio. "on conflict" só evita
  -- erro se essa linha já existir.
  insert into private.status_daily_summaries (component_key, day, good_samples, total_samples, worst_level)
  values ('crm', date '2000-01-01', 1, 1, 'operational')
  on conflict (component_key, day) do nothing;

  select count(*) into v_total from private.status_daily_summaries;
  r := r || jsonb_build_object('private_tem_linhas', v_total > 0);

  grant select on private.status_daily_summaries to authenticated;
  create policy "teste: permissiva por engano" on private.status_daily_summaries
    for select to authenticated using (true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    select count(*) into v_int from private.status_daily_summaries;
    execute 'reset role';
    r := r || jsonb_build_object('private_grant_por_engano_ve_linhas', v_int);
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('private_grant_por_engano_ve_linhas', 'ERRO:' || sqlstate);
  end;

  -- Funções security definer continuam lendo e gravando em private.
  perform set_config('request.jwt.claims', '', true);
  begin
    execute 'set local role anon';
    v_json := public.get_public_status();
    execute 'reset role';
    r := r || jsonb_build_object(
      'definer_le_private_como_anon', jsonb_array_length(v_json -> 'components') = 8
    );
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('definer_le_private_como_anon', 'ERRO:' || sqlstate);
  end;

  select ds.decrypted_secret into v_billing_key
  from vault.decrypted_secrets ds
  where ds.name = 'billing_server_key';

  select count(*) into v_total from private.status_billing_webhook_deliveries;
  begin
    execute 'set local role anon';
    perform public.record_billing_webhook_delivery(v_billing_key, 'ok', 'checkout.session.completed');
    execute 'reset role';
    select count(*) into v_int from private.status_billing_webhook_deliveries;
    r := r || jsonb_build_object('definer_grava_private_como_anon', v_int = v_total + 1);
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('definer_grava_private_como_anon', 'ERRO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 2. RPCs do servidor (p_server_key): catálogo e recusa sem chave
  -- ---------------------------------------------------------------------------
  v_list := '{}';
  v_map := '{}'::jsonb;
  v_total := 0;
  for v_fn in
    select p.oid, p.proname, p.pronargs, p.proargnames, p.proargtypes::oid[] as argtypes,
      p.prosecdef, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and 'p_server_key' = any (p.proargnames)
    order by p.proname
  loop
    v_total := v_total + 1;

    if not v_fn.prosecdef
       or coalesce(v_fn.proconfig, '{}') <> array['search_path=""']
       or not has_function_privilege('anon', v_fn.oid, 'execute')
       or has_function_privilege('authenticated', v_fn.oid, 'execute')
       or exists (
         select 1
         from aclexplode(coalesce(
           (select p2.proacl from pg_catalog.pg_proc p2 where p2.oid = v_fn.oid),
           acldefault('f', (select p2.proowner from pg_catalog.pg_proc p2 where p2.oid = v_fn.oid))
         )) a
         where a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      v_list := v_list || v_fn.proname::text;
    end if;

    select string_agg(
      case
        when v_fn.proargnames[i] = 'p_server_key' then quote_literal('chave-errada')
        else 'null::' || format_type(v_fn.argtypes[i - 1], null)
      end,
      ', ' order by i
    )
      into v_args
    from generate_series(1, v_fn.pronargs) as i;

    begin
      execute 'set local role anon';
      execute format('select 1 from public.%I(%s)', v_fn.proname, v_args);
      execute 'reset role';
      v_outcome := 'PASSOU';
    exception when others then
      v_outcome := sqlstate;
    end;
    execute 'reset role';

    if v_outcome <> '42501' then
      v_map := v_map || jsonb_build_object(v_fn.proname, v_outcome);
    end if;
  end loop;

  r := r || jsonb_build_object(
    'servidor_total', v_total,
    'servidor_catalogo_fora_do_padrao', to_jsonb(v_list),
    'servidor_sem_chave_nao_recusou', v_map
  );

  -- ---------------------------------------------------------------------------
  -- 3. RPCs públicas
  -- ---------------------------------------------------------------------------
  select coalesce(array_agg(p.proname::text order by p.proname), '{}')
    into v_list
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      (p.proname = any (v_public_fns)
        and (
          not has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
        ))
      or (p.proname = any (v_public_with_session)
        and (
          not has_function_privilege('anon', p.oid, 'execute')
          or not has_function_privilege('authenticated', p.oid, 'execute')
        ))
      or (p.proname = any (v_public_fns || v_public_with_session)
        and (not p.prosecdef or coalesce(p.proconfig, '{}') <> array['search_path=""']))
    );
  r := r || jsonb_build_object('publicas_catalogo_fora_do_padrao', to_jsonb(v_list));

  perform set_config('request.jwt.claims', '', true);
  begin
    execute 'set local role anon';
    v_text := coalesce(public.get_public_organization('teste-advisor-nao-existe')::text, 'null')
      || '|' || coalesce(public.get_public_landing_page('teste-advisor-nao-existe', 'x')::text, 'null')
      || '|' || coalesce(public.get_shared_proposal(repeat('0', 48))::text, 'null');
    perform public.register_shared_proposal_view(repeat('0', 48));
    v_json := public.get_public_status();
    execute 'reset role';
    r := r || jsonb_build_object(
      'publicas_anon_funciona', v_text = 'null|null|null' and v_json ? 'components'
    );
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('publicas_anon_funciona', 'ERRO:' || sqlstate);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  v_list := '{}';
  foreach v_text in array array[
    'select public.get_public_organization(''teste-advisor-avisos'')',
    'select public.get_public_landing_page(''teste-advisor-avisos'', ''x'')',
    'select public.get_public_status()',
    'select public.get_shared_proposal(repeat(''0'', 48))',
    'select public.register_shared_proposal_view(repeat(''0'', 48))'
  ] loop
    begin
      execute 'set local role authenticated';
      execute v_text;
      execute 'reset role';
      v_list := v_list || 'PASSOU'::text;
    exception when others then
      v_list := v_list || ('NEGADO:' || sqlstate);
    end;
    execute 'reset role';
  end loop;
  r := r || jsonb_build_object('publicas_com_sessao', array_to_string(v_list, '|'));

  begin
    execute 'set local role authenticated';
    perform public.get_portal_feed('teste-advisor-avisos', repeat('0', 48));
    perform public.get_invitation_preview(repeat('0', 48));
    execute 'reset role';
    r := r || jsonb_build_object('feed_e_convite_com_sessao', true);
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('feed_e_convite_com_sessao', 'ERRO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 4. RPCs de sessão: estranho logado não recebe dado da imobiliária
  -- ---------------------------------------------------------------------------
  v_list := '{}';
  v_map := '{}'::jsonb;
  v_total := 0;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);

  for v_fn in
    select p.oid, p.proname, p.pronargs, p.proargnames, p.proargtypes::oid[] as argtypes,
      p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not ('p_server_key' = any (coalesce(p.proargnames, '{}')))
      and not (p.proname = any (v_public_fns || v_public_with_session))
      and has_function_privilege('authenticated', p.oid, 'execute')
    order by p.proname
  loop
    v_total := v_total + 1;

    if has_function_privilege('anon', v_fn.oid, 'execute')
       or coalesce(v_fn.proconfig, '{}') <> array['search_path=""'] then
      v_list := v_list || v_fn.proname::text;
    end if;

    select string_agg(
      case
        when v_fn.proargnames[i] = 'p_organization_id' then quote_literal(org) || '::uuid'
        else 'null::' || format_type(v_fn.argtypes[i - 1], null)
      end,
      ', ' order by i
    )
      into v_args
    from generate_series(1, v_fn.pronargs) as i;

    begin
      execute 'set local role authenticated';
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I(%s) as t',
        v_fn.proname, coalesce(v_args, '')
      ) into v_json;
      execute 'reset role';
      -- "Vazio": nenhuma linha, ou só null / [] / {} / false.
      select case
          when bool_and(kv.value in ('null'::jsonb, '[]'::jsonb, '{}'::jsonb, 'false'::jsonb))
            is not false then 'vazio'
          else 'DADO'
        end
        into v_outcome
      from jsonb_array_elements(v_json) e(item)
      cross join lateral jsonb_each(e.item) kv;
    exception when others then
      v_outcome := 'erro:' || sqlstate;
    end;
    execute 'reset role';

    if v_outcome = 'DADO' then
      v_map := v_map || jsonb_build_object(v_fn.proname, v_json);
    end if;
  end loop;

  r := r || jsonb_build_object(
    'sessao_total', v_total,
    'sessao_catalogo_fora_do_padrao', to_jsonb(v_list),
    'sessao_estranho_recebeu_dado', v_map
  );

  -- ---------------------------------------------------------------------------
  -- 5. get_lead_stage_metrics (security invoker)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Advisor A', '11999990101', 'manual', 'new', u_broker)
  returning id into lead_a;
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Advisor B', '11999990102', 'manual', 'new', u_manager)
  returning id into lead_b;
  insert into public.leads (organization_id, name, phone, source, stage, assigned_to)
  values (org, 'Lead Advisor C', '11999990103', 'manual', 'new', u_assistant);

  update public.leads set stage = 'contacted' where id in (lead_a, lead_b);
  update public.leads set stage = 'qualified' where id = lead_b;

  r := r || jsonb_build_object(
    'metricas_invoker',
    not (select p.prosecdef from pg_catalog.pg_proc p
         where p.oid = 'public.get_lead_stage_metrics(uuid, integer)'::regprocedure)
  );

  -- Base sem RLS (postgres ignora RLS): o que a versão security definer devolvia.
  v_base := public.get_lead_stage_metrics(org, 30);
  r := r || jsonb_build_object(
    'metricas_tem_dados',
    (v_base #>> '{totals,leads}')::integer = 3 and jsonb_array_length(v_base -> 'stages') >= 3
  );

  foreach v_text in array array['dono', 'gerente', 'assistente'] loop
    perform set_config('request.jwt.claims',
      json_build_object(
        'sub', case v_text when 'dono' then u_owner when 'gerente' then u_manager else u_assistant end,
        'role', 'authenticated'
      )::text, true);
    begin
      execute 'set local role authenticated';
      v_json := public.get_lead_stage_metrics(org, 30);
      execute 'reset role';
      r := r || jsonb_build_object('metricas_' || v_text || '_igual_sem_rls', v_json = v_base);
    exception when others then
      execute 'reset role';
      r := r || jsonb_build_object('metricas_' || v_text || '_igual_sem_rls', 'ERRO:' || sqlstate);
    end;
  end loop;

  foreach v_text in array array['corretor', 'estranho'] loop
    perform set_config('request.jwt.claims',
      json_build_object(
        'sub', case v_text when 'corretor' then u_broker else u_stranger end,
        'role', 'authenticated'
      )::text, true);
    begin
      execute 'set local role authenticated';
      perform public.get_lead_stage_metrics(org, 30);
      execute 'reset role';
      r := r || jsonb_build_object('metricas_' || v_text, 'PASSOU');
    exception when others then
      execute 'reset role';
      r := r || jsonb_build_object('metricas_' || v_text, 'NEGADO:' || sqlstate);
    end;
  end loop;

  -- O RLS de fato filtra para quem não é da gestão (segunda barreira).
  select count(*) into v_total from public.lead_stage_events where organization_id = org;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    select count(*) into v_int from public.lead_stage_events where organization_id = org;
    execute 'reset role';
    r := r || jsonb_build_object('metricas_rls_corretor_ve_menos', v_int < v_total);
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('metricas_rls_corretor_ve_menos', 'ERRO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 6. lead_integrations: SELECT só por coluna
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'integracoes_grant_por_coluna',
    not has_table_privilege('authenticated', 'public.lead_integrations', 'select')
      and not has_column_privilege('authenticated', 'public.lead_integrations', 'webhook_token', 'select')
      and not has_column_privilege('authenticated', 'public.lead_integrations', 'secret_id', 'select')
      and not has_column_privilege('authenticated', 'public.lead_integrations', 'poll_cursor', 'select')
      and has_column_privilege('authenticated', 'public.lead_integrations', 'status', 'select')
      and has_column_privilege('authenticated', 'public.lead_integrations', 'external_account_id', 'select')
      and has_column_privilege('authenticated', 'public.lead_integrations', 'last_event_at', 'select')
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    perform public.enable_lead_webhook(org, 'canal_pro', false, null);

    select li.status::text into v_text
    from public.lead_integrations li
    where li.organization_id = org and li.provider = 'canal_pro';
    r := r || jsonb_build_object('integracoes_dono_le_status', v_text);

    begin
      execute 'select li.webhook_token from public.lead_integrations li where li.organization_id = $1'
        into v_text using org;
      r := r || jsonb_build_object('integracoes_dono_le_token_direto', 'PASSOU');
    exception when others then
      r := r || jsonb_build_object('integracoes_dono_le_token_direto', 'NEGADO:' || sqlstate);
    end;

    v_json := public.get_lead_integrations_overview(org, 5);
    execute 'reset role';
    r := r || jsonb_build_object(
      'integracoes_rpc_devolve_endereco',
      coalesce(char_length(v_json #>> '{integrations,0,webhook_token}'), 0) = 48
    );
  exception when others then
    execute 'reset role';
    r := r || jsonb_build_object('integracoes_erro', sqlstate || ' ' || sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 7. Índices
  -- ---------------------------------------------------------------------------
  select count(*) into v_int
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'whatsapp_channels_organization_idx', 'connected_accounts_organization_idx',
      'lead_routing_shifts_member_weekday_idx', 'lead_integrations_organization_idx',
      'commission_shares_commission_idx', 'whatsapp_conversations_channel_idx'
    );
  r := r || jsonb_build_object('indices_removidos_restantes', v_int);

  select count(*) into v_int
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class c on c.oid = con.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f'
    and n.nspname in ('public', 'private')
    and not exists (
      select 1
      from pg_catalog.pg_index i
      where i.indrelid = con.conrelid
        and i.indisvalid
        and i.indnkeyatts >= cardinality(con.conkey)
        and ((i.indkey::int2[])[0:cardinality(con.conkey) - 1])::int2[] = con.conkey::int2[]
    );
  r := r || jsonb_build_object('fks_sem_indice', v_int);

  raise exception 'TESTE DOS AVISOS DO ADVISOR (rollback): %', jsonb_pretty(r);
end;
$$;
