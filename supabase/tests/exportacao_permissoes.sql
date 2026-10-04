-- =============================================================================
-- Teste da exportação por papel, da trilha de exportações e do sigilo do
-- contato do proprietário
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--
--   1. Proprietário (clients ligado a property_owners): o captador só lê o
--      proprietário dos imóveis em que é captador ou corretor — o do imóvel
--      alheio não aparece nem na tabela, nem no embed, nem na busca por nome.
--      O corretor do imóvel lê (sem editar); dono e gerente leem todos.
--   2. Padrão sem configuração: só dono e gerente exportam. O corretor recebe
--      allowed = false, a recusa fica em audit_events e a RPC não devolve
--      linha nenhuma, nem com o id negado, nem com um id inventado.
--   3. A exportação permitida conta as linhas no próprio banco, página a
--      página, sem gravar nenhum dado exportado; filtros ou conjunto diferentes
--      do registro são recusados.
--   4. Relatório agregado informa as linhas por `record_report_export_rows`,
--      que não aceita os conjuntos da base.
--   5. Só o dono muda quem exporta (o dono sempre fica); a mudança vale na hora,
--      inclusive no meio de uma exportação, e também vai para a trilha.
--   6. Ninguém grava direto na configuração; anon não executa nada.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   captador_le_proprietario_do_proprio_imovel : true
--   captador_nao_le_proprietario_alheio        : true
--   captador_embed_do_imovel_alheio_sem_nome   : true
--   captador_nao_edita_proprietario_alheio     : 0
--   captador_edita_proprietario_do_seu_imovel  : 1
--   captador_busca_proprietario_alheio         : 0
--   outro_captador_le_o_seu                    : true
--   outro_captador_nao_le_o_alheio             : true
--   outro_captador_busca_o_seu                 : 1
--   corretor_do_imovel_le_proprietario         : true
--   corretor_nao_edita_proprietario            : 0
--   corretor_nao_le_proprietario_alheio        : true
--   gerente_le_todos_os_proprietarios          : 2
--   corretor_exporta_por_padrao                : false
--   corretor_pagina_com_id_negado              : "42501"
--   corretor_pagina_com_id_inventado           : "42501"
--   corretor_nao_le_a_trilha                   : 0
--   dono_exporta_por_padrao                    : true
--   dono_linhas_pagina_1                       : 2
--   dono_linhas_pagina_2                       : 1
--   linhas_registradas                         : 3
--   registro_sem_dado_exportado                : true
--   registro_guarda_filtros                    : "clientes|30-dias|owner"
--   filtro_diferente_recusado                  : "42501"
--   conjunto_diferente_recusado                : "42501"
--   relatorio_agregado_linhas                  : 7
--   contagem_manual_da_base_recusada           : "22023"
--   dono_ve_recusa_do_corretor                 : 1
--   gerente_nao_muda_quem_exporta              : "42501"
--   dono_libera_corretor                       : "{owner,broker}"
--   gerente_perde_exportacao                   : false
--   corretor_exporta_liberado                  : 1
--   mudanca_na_trilha                          : 1
--   permissao_retirada_no_meio                 : "42501"
--   insert_direto_na_configuracao              : "42501"
--   grant_iniciar_anon                         : false
--   grant_iniciar_authenticated                : true
--   grant_exportacao_anon                      : false
--   grant_configuracao_anon                    : false

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_manager uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_cap1 uuid := gen_random_uuid();
  u_cap2 uuid := gen_random_uuid();
  org uuid;
  imovel1 uuid;
  imovel2 uuid;
  dono1 uuid;
  dono2 uuid;
  cliente_corretor uuid;
  v_export uuid;
  v_export_funil uuid;
  v_export_broker uuid;
  v_allowed boolean;
  v_inicio timestamptz := date_trunc('day', now()) - interval '30 days';
  v_fim timestamptz := date_trunc('day', now()) + interval '1 day';
  v_text text;
  v_int integer;
  v_bool boolean;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-exportacao-dono@exemplo.invalid', now(), now(), now()),
    (u_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-exportacao-gerente@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-exportacao-corretor@exemplo.invalid', now(), now(), now()),
    (u_cap1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-exportacao-captador1@exemplo.invalid', now(), now(), now()),
    (u_cap2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-exportacao-captador2@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Exportacao', 'teste-exportacao');

  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values
    (org, u_manager, 'manager', true),
    (org, u_broker, 'broker', true),
    (org, u_cap1, 'capturer', true),
    (org, u_cap2, 'capturer', true);

  -- Imóvel 1: captado pelo captador 1. Imóvel 2: captado pelo captador 2, com o
  -- corretor como responsável.
  insert into public.properties (organization_id, title, purpose, type, captured_by)
  values (org, 'Casa Teste Exportacao Um', 'sale', 'house', u_cap1)
  returning id into imovel1;
  insert into public.properties (organization_id, title, purpose, type, captured_by, broker_id)
  values (org, 'Apto Teste Exportacao Dois', 'sale', 'apartment', u_cap2, u_broker)
  returning id into imovel2;

  -- Proprietários cadastrados pelo dono (nenhum captador é o autor).
  insert into public.clients (organization_id, kind, name, phone, email)
  values (org, 'pf', 'Proprietario Teste Um', '11988880001', 'prop1@exemplo.invalid')
  returning id into dono1;
  insert into public.clients (organization_id, kind, name, phone, email)
  values (org, 'pf', 'Proprietario Teste Dois', '11988880002', 'prop2@exemplo.invalid')
  returning id into dono2;
  insert into public.clients (organization_id, kind, name, phone, assigned_to)
  values (org, 'pf', 'Comprador do Corretor', '11988880003', u_broker)
  returning id into cliente_corretor;

  insert into public.property_owners (organization_id, property_id, client_id)
  values (org, imovel1, dono1), (org, imovel2, dono2);

  -- ---------------------------------------------------------------------------
  -- 1. Contato do proprietário
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_cap1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select exists (select 1 from public.clients where id = $1)' into v_bool using dono1;
  r := r || jsonb_build_object('captador_le_proprietario_do_proprio_imovel', v_bool);

  execute 'select not exists (select 1 from public.clients where id = $1)' into v_bool using dono2;
  r := r || jsonb_build_object('captador_nao_le_proprietario_alheio', v_bool);

  -- O mesmo que o embed `property_owners(..., clients(name))` da ficha do imóvel.
  execute $q$
    select bool_and(c.name is null and c.phone is null)
    from public.property_owners po
    left join public.clients c on c.id = po.client_id
    where po.property_id = $1
  $q$ into v_bool using imovel2;
  r := r || jsonb_build_object('captador_embed_do_imovel_alheio_sem_nome', v_bool);

  execute 'with u as (update public.clients set notes = $2 where id = $1 returning 1) select count(*)::integer from u'
  into v_int using dono2, 'tentativa do captador';
  r := r || jsonb_build_object('captador_nao_edita_proprietario_alheio', v_int);

  execute 'with u as (update public.clients set notes = $2 where id = $1 returning 1) select count(*)::integer from u'
  into v_int using dono1, 'captador atualizou';
  r := r || jsonb_build_object('captador_edita_proprietario_do_seu_imovel', v_int);

  execute 'select count(*)::integer from public.search_properties($1, $2)'
  into v_int using org, 'Proprietario Teste Dois';
  r := r || jsonb_build_object('captador_busca_proprietario_alheio', v_int);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_cap2, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select exists (select 1 from public.clients where id = $1)' into v_bool using dono2;
  r := r || jsonb_build_object('outro_captador_le_o_seu', v_bool);

  execute 'select not exists (select 1 from public.clients where id = $1)' into v_bool using dono1;
  r := r || jsonb_build_object('outro_captador_nao_le_o_alheio', v_bool);

  -- Controle da busca: o mesmo termo acha o imóvel para quem pode ver o dono.
  execute 'select count(*)::integer from public.search_properties($1, $2)'
  into v_int using org, 'Proprietario Teste Dois';
  r := r || jsonb_build_object('outro_captador_busca_o_seu', v_int);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select exists (select 1 from public.clients where id = $1)' into v_bool using dono2;
  r := r || jsonb_build_object('corretor_do_imovel_le_proprietario', v_bool);

  execute 'with u as (update public.clients set notes = $2 where id = $1 returning 1) select count(*)::integer from u'
  into v_int using dono2, 'tentativa do corretor';
  r := r || jsonb_build_object('corretor_nao_edita_proprietario', v_int);

  execute 'select not exists (select 1 from public.clients where id = $1)' into v_bool using dono1;
  r := r || jsonb_build_object('corretor_nao_le_proprietario_alheio', v_bool);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*)::integer from public.clients where id in ($1, $2)'
  into v_int using dono1, dono2;
  r := r || jsonb_build_object('gerente_le_todos_os_proprietarios', v_int);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2. Corretor, sem configuração: exportação negada e registrada
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select s.export_id, s.allowed from public.start_data_export($1, $2, $3, $4, null, $5) s'
  into v_export_broker, v_allowed using org, 'clientes', v_inicio, v_fim, '30-dias';
  r := r || jsonb_build_object('corretor_exporta_por_padrao', v_allowed);

  begin
    execute 'select count(*)::integer from public.export_clients_rows($1, $2, $3, $4)'
    into v_int using org, v_export_broker, v_inicio, v_fim;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_pagina_com_id_negado', v_text);

  begin
    execute 'select count(*)::integer from public.export_clients_rows($1, $2, $3, $4)'
    into v_int using org, gen_random_uuid(), v_inicio, v_fim;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_pagina_com_id_inventado', v_text);

  execute $q$select count(*)::integer from public.audit_events where organization_id = $1 and entity = 'data_export'$q$
  into v_int using org;
  r := r || jsonb_build_object('corretor_nao_le_a_trilha', v_int);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 3 e 4. Dono: exportação permitida, contada no banco
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select s.export_id, s.allowed from public.start_data_export($1, $2, $3, $4, null, $5) s'
  into v_export, v_allowed using org, 'clientes', v_inicio, v_fim, '30-dias';
  r := r || jsonb_build_object('dono_exporta_por_padrao', v_allowed);

  -- Página 1 (2 linhas) e página 2 continuando da última linha.
  execute $q$
    select count(*)::integer, max(e.created_at), (array_agg(e.id order by e.created_at desc, e.id desc))[1]
    from public.export_clients_rows($1, $2, $3, $4, null, null, null, 2) e
  $q$ into v_int, v_cursor_at, v_cursor_id using org, v_export, v_inicio, v_fim;
  r := r || jsonb_build_object('dono_linhas_pagina_1', v_int);

  execute $q$
    select count(*)::integer
    from public.export_clients_rows($1, $2, $3, $4, null, $5, $6, 2) e
  $q$ into v_int using org, v_export, v_inicio, v_fim, v_cursor_at, v_cursor_id;
  r := r || jsonb_build_object('dono_linhas_pagina_2', v_int);

  execute $q$select (metadata ->> 'rows')::integer from public.audit_events where id = $1$q$
  into v_int using v_export;
  r := r || jsonb_build_object('linhas_registradas', v_int);

  execute $q$
    select metadata::text not like '%11988880%'
       and metadata::text not like '%Proprietario%'
       and metadata::text not like '%exemplo.invalid%'
    from public.audit_events where id = $1
  $q$ into v_bool using v_export;
  r := r || jsonb_build_object('registro_sem_dado_exportado', v_bool);

  execute $q$
    select (metadata ->> 'dataset') || '|' || (metadata -> 'filters' ->> 'period_preset') || '|'
      || (metadata ->> 'role')
    from public.audit_events
    where id = $1 and actor_id = $2 and action = 'export' and (metadata ->> 'allowed')::boolean
  $q$ into v_text using v_export, u_owner;
  r := r || jsonb_build_object('registro_guarda_filtros', v_text);

  begin
    execute 'select count(*)::integer from public.export_clients_rows($1, $2, $3, $4)'
    into v_int using org, v_export, v_inicio - interval '1 day', v_fim;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('filtro_diferente_recusado', v_text);

  begin
    execute 'select count(*)::integer from public.export_leads_rows($1, $2, $3, $4)'
    into v_int using org, v_export, v_inicio, v_fim;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('conjunto_diferente_recusado', v_text);

  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, $5) s'
  into v_export_funil using org, 'funil', v_inicio, v_fim, '30-dias';
  execute 'select public.record_report_export_rows($1, $2, $3, $4, $5, $6, null)'
  using org, v_export_funil, 'funil', 7, v_inicio, v_fim;
  execute $q$select (metadata ->> 'rows')::integer from public.audit_events where id = $1$q$
  into v_int using v_export_funil;
  r := r || jsonb_build_object('relatorio_agregado_linhas', v_int);

  begin
    execute 'select public.record_report_export_rows($1, $2, $3, $4, $5, $6, null)'
    using org, v_export, 'clientes', 0, v_inicio, v_fim;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('contagem_manual_da_base_recusada', v_text);

  execute $q$
    select count(*)::integer from public.audit_events
    where organization_id = $1 and entity = 'data_export' and actor_id = $2
      and not (metadata ->> 'allowed')::boolean
  $q$ into v_int using org, u_broker;
  r := r || jsonb_build_object('dono_ve_recusa_do_corretor', v_int);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 5. Quem muda a permissão (e o efeito imediato)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    execute 'select public.set_export_roles($1, $2)'
    using org, '{manager,broker}'::public.app_role[];
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('gerente_nao_muda_quem_exporta', v_text);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- O dono não marcou a si mesmo, e mesmo assim continua na lista.
  execute 'select public.set_export_roles($1, $2)::text'
  into v_text using org, '{broker}'::public.app_role[];
  r := r || jsonb_build_object('dono_libera_corretor', v_text);

  execute $q$
    select count(*)::integer from public.audit_events
    where organization_id = $1 and entity = 'organization_permission_settings' and action = 'update'
  $q$ into v_int using org;
  r := r || jsonb_build_object('mudanca_na_trilha', v_int);

  begin
    execute 'insert into public.organization_permission_settings (organization_id, export_roles) values ($1, $2)'
    using gen_random_uuid(), '{owner}'::public.app_role[];
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('insert_direto_na_configuracao', v_text);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select s.allowed from public.start_data_export($1, $2, $3, $4, null, null) s'
  into v_allowed using org, 'leads', v_inicio, v_fim;
  r := r || jsonb_build_object('gerente_perde_exportacao', v_allowed);

  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Agora liberado: exporta só o próprio cliente (o recorte por papel continua).
  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, null) s'
  into v_export_broker using org, 'clientes', v_inicio, v_fim;
  execute 'select count(*)::integer from public.export_clients_rows($1, $2, $3, $4)'
  into v_int using org, v_export_broker, v_inicio, v_fim;
  r := r || jsonb_build_object('corretor_exporta_liberado', v_int);

  reset role;

  -- O dono volta ao padrão no meio da exportação do corretor.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select public.set_export_roles($1, $2)'
  using org, '{owner,manager}'::public.app_role[];
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    execute 'select count(*)::integer from public.export_clients_rows($1, $2, $3, $4)'
    into v_int using org, v_export_broker, v_inicio, v_fim;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('permissao_retirada_no_meio', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 6. Grants
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'grant_iniciar_anon',
    has_function_privilege(
      'anon', 'public.start_data_export(uuid, text, timestamptz, timestamptz, uuid, text)', 'execute'
    ),
    'grant_iniciar_authenticated',
    has_function_privilege(
      'authenticated', 'public.start_data_export(uuid, text, timestamptz, timestamptz, uuid, text)', 'execute'
    ),
    'grant_exportacao_anon',
    has_function_privilege(
      'anon',
      'public.export_clients_rows(uuid, uuid, timestamptz, timestamptz, uuid, timestamptz, uuid, integer)',
      'execute'
    ),
    'grant_configuracao_anon',
    has_function_privilege('anon', 'public.set_export_roles(uuid, public.app_role[])', 'execute')
  );

  raise exception 'TESTE DE EXPORTACAO E PROPRIETARIO (rollback): %', jsonb_pretty(r);
end;
$$;
