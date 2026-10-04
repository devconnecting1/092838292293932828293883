-- =============================================================================
-- Teste da importação de planilhas v2: datas do lead, proprietários, fotos por
-- link, assistente importando e "Desfazer esta importação"
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou pelo MCP execute_sql.
--
-- Cenário: dono, assistente e corretor na mesma imobiliária. Já existe um
-- cliente com e-mail existente@exemplo.com. As RPCs rodam como `authenticated`.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   corretor_nao_importa              : "NEGADO:42501"
--   assistente_importa_leads          : {"failed": 2, "skipped": 0, "inserted": 2, "updated": 0}
--   motivos_datas                     : ["inserted", "inserted", "failed:invalid_date_order", "failed:invalid_date"]
--   lead_com_datas_da_planilha        : true
--   evento_de_ganho_na_data_da_planilha: true
--   lead_sem_data_sem_evento          : true
--   origem_nao_muda_no_update         : true
--   relatorio_marco_2025              : {"won": 1, "in_sla": 0, "answered": 1, "received": 1}
--   relatorio_mes_atual               : {"won": 0, "in_sla": 0, "answered": 0, "received": 0}
--   assistente_ve_so_as_proprias      : 1
--   dono_ve_todas                     : 2
--   imoveis_com_proprietarios         : {"failed": 2, "skipped": 0, "inserted": 2, "updated": 0}
--   motivos_proprietarios             : ["inserted", "failed:invalid_owner_share", "inserted", "failed:invalid_owner"]
--   vinculos_e_percentuais            : [40.00, 60.00]
--   proprietario_novo_como_cliente    : true
--   proprietario_existente_reaproveitado: true
--   fila_de_fotos                     : {"done": 0, "total": 2, "failed": 0, "pending": 2}
--   corretor_nao_baixa_fotos          : "NEGADO:42501"
--   fotos_reservadas                  : 2
--   foto_gravada_como_upload          : true
--   foto_com_falha                    : {"done": 1, "total": 2, "failed": 1, "pending": 0}
--   falha_sem_link                    : [{"row": 2, "code": "timeout", "position": 1}]
--   desfazer_clientes                 : {"kept": 1, "removed": 1}
--   cliente_editado_fica              : true
--   auditoria_do_desfazer             : true
--   desfazer_de_novo                  : "NEGADO:22023"
--   lote_depois_de_desfeita           : "NEGADO:22023"
--   desfazer_imoveis                  : {"kept": {"properties": 1, "property_owners": 1}, "removed": {"clients": 2, "properties": 1, "property_media": 1, "property_owners": 2}}
--   arquivos_das_fotos_para_apagar    : 1
--   imovel_em_uso_fica                : true
--   desfazer_leads                    : {"kept": 1, "removed": 1}
--   prazo_de_7_dias                   : "NEGADO:22023"

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_assistant uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  org uuid;
  job_leads uuid := gen_random_uuid();
  job_owner_leads uuid := gen_random_uuid();
  job_props uuid := gen_random_uuid();
  job_clients uuid := gen_random_uuid();
  job_old uuid := gen_random_uuid();
  v_existing_client uuid;
  v_other_client uuid;
  v_prop2 uuid;
  v_prop4 uuid;
  v_lead_dated uuid;
  v_lead_undated uuid;
  v_claimed jsonb;
  v_item jsonb;
  res jsonb;
  v_prep jsonb;
  v_paths integer := 0;
  v_int integer;
  v_bool boolean;
  i integer;
begin
  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-importacao-v2-dono@exemplo.invalid', now(), now(), now()),
    (u_assistant, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-importacao-v2-assistente@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-importacao-v2-corretor@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Importacao V2', 'teste-importacao-v2');

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_assistant, 'assistant', true), (org, u_broker, 'broker', true);

  insert into public.clients (organization_id, kind, name, email, lgpd_legal_basis)
  values (org, 'pf', 'Cliente Existente', 'existente@exemplo.com', 'contract')
  returning id into v_existing_client;

  insert into public.clients (organization_id, kind, name, email, lgpd_legal_basis)
  values (org, 'pf', 'Outro Proprietario Manual', 'outro@exemplo.com', 'contract')
  returning id into v_other_client;

  -- ---------------------------------------------------------------------------
  -- 1. Permissão: corretor não importa; assistente importa
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.import_start(org, gen_random_uuid(), 'leads', 'skip', 1, '{}'::jsonb);
    r := r || jsonb_build_object('corretor_nao_importa', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('corretor_nao_importa', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2. Leads com as datas da planilha (assistente)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_assistant, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.import_start(org, job_leads, 'leads', 'skip', 4, '{}'::jsonb);
  res := public.import_batch(org, job_leads, 0, jsonb_build_array(
    jsonb_build_object('row', 2, 'name', 'Lead Com Datas', 'phone', '11955550001', 'stage', 'won',
      'assigned_to', u_broker,
      'received_at', '2025-03-10T12:00:00-03:00',
      'first_contact_at', '2025-03-10T12:30:00-03:00',
      'closed_at', '2025-03-20T15:00:00-03:00'),
    jsonb_build_object('row', 3, 'name', 'Lead Sem Datas', 'phone', '11955550002', 'stage', 'won',
      'assigned_to', u_broker),
    jsonb_build_object('row', 4, 'name', 'Lead Datas Trocadas', 'phone', '11955550003',
      'received_at', '2025-03-10T12:00:00-03:00',
      'first_contact_at', '2025-03-01T12:00:00-03:00'),
    jsonb_build_object('row', 5, 'name', 'Lead Data Ruim', 'phone', '11955550004',
      'received_at', 'ontem')
  ));
  r := r || jsonb_build_object('assistente_importa_leads', jsonb_build_object(
    'inserted', res -> 'inserted', 'updated', res -> 'updated',
    'skipped', res -> 'skipped', 'failed', res -> 'failed'));
  r := r || jsonb_build_object('motivos_datas', (
    select jsonb_agg(
      (x.value ->> 'status') || coalesce(':' || (x.value ->> 'code'), '')
      order by (x.value ->> 'row')::integer)
    from jsonb_array_elements(res -> 'results') as x(value)));

  perform public.import_finish(org, job_leads, 0, 0);

  reset role;

  select l.id into v_lead_dated from public.leads l where l.organization_id = org and l.name = 'Lead Com Datas';
  select l.id into v_lead_undated from public.leads l where l.organization_id = org and l.name = 'Lead Sem Datas';

  select l.created_at = timestamptz '2025-03-10T12:00:00-03:00'
     and l.assigned_at = l.created_at
     and l.first_contact_at = timestamptz '2025-03-10T12:30:00-03:00'
     and l.import_job_id = job_leads
     and l.imported_at is not null
     and l.first_response_due_at is null
  into v_bool
  from public.leads l where l.id = v_lead_dated;
  r := r || jsonb_build_object('lead_com_datas_da_planilha', v_bool);

  select count(*) = 1 and bool_and(ev.created_at = timestamptz '2025-03-20T15:00:00-03:00' and ev.reason = 'import')
  into v_bool
  from public.lead_stage_events ev where ev.lead_id = v_lead_dated;
  r := r || jsonb_build_object('evento_de_ganho_na_data_da_planilha', v_bool);

  select (select count(*) from public.lead_stage_events ev where ev.lead_id = v_lead_undated) = 0
     and l.created_at = l.imported_at
  into v_bool
  from public.leads l where l.id = v_lead_undated;
  r := r || jsonb_build_object('lead_sem_data_sem_evento', v_bool);

  -- A origem não muda por UPDATE (ninguém tira o lead do filtro de SLA): pela
  -- API não há grant na coluna, e o gatilho segura mesmo para quem tem.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.leads set import_job_id = null, imported_at = null where id = v_lead_dated;
  exception when others then
    null;
  end;
  reset role;
  update public.leads set import_job_id = null, imported_at = null where id = v_lead_dated;

  select l.import_job_id = job_leads and l.imported_at is not null into v_bool
  from public.leads l where l.id = v_lead_dated;
  r := r || jsonb_build_object('origem_nao_muda_no_update', v_bool);

  select jsonb_build_object(
    'received', b.leads_received, 'answered', b.leads_answered,
    'in_sla', b.leads_in_sla, 'won', b.leads_won)
  into res
  from private.report_broker_performance(
    org, timestamptz '2025-03-01T00:00:00-03:00', timestamptz '2025-04-01T00:00:00-03:00', null, null
  ) b
  where b.user_id = u_broker;
  r := r || jsonb_build_object('relatorio_marco_2025', res);

  select jsonb_build_object(
    'received', b.leads_received, 'answered', b.leads_answered,
    'in_sla', b.leads_in_sla, 'won', b.leads_won)
  into res
  from private.report_broker_performance(org, date_trunc('month', now()), now() + interval '1 day', null, null) b
  where b.user_id = u_broker;
  r := r || jsonb_build_object('relatorio_mes_atual', res);

  -- Dono também importa (para conferir quem enxerga o quê).
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.import_start(org, job_owner_leads, 'leads', 'skip', 1, '{}'::jsonb);
  execute 'select count(*) from public.import_jobs where organization_id = $1' into v_int using org;
  r := r || jsonb_build_object('dono_ve_todas', v_int);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_assistant, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select count(*) from public.import_jobs where organization_id = $1' into v_int using org;
  r := r || jsonb_build_object('assistente_ve_so_as_proprias', v_int);

  -- ---------------------------------------------------------------------------
  -- 3. Imóveis com proprietários e links de foto (assistente)
  -- ---------------------------------------------------------------------------
  perform public.import_start(org, job_props, 'properties', 'skip', 4, '{}'::jsonb);
  res := public.import_batch(org, job_props, 0, jsonb_build_array(
    jsonb_build_object('row', 2, 'external_code', 'V2-001', 'title', 'Apartamento com donos',
      'purpose', 'sale', 'type', 'apartment', 'sale_price', 500000, 'living_area', 80,
      'owners', jsonb_build_array(
        jsonb_build_object('name', 'Maria Dona', 'document', '52998224725', 'share_percent', 60),
        jsonb_build_object('name', 'Joao Dono', 'phone', '11911112222', 'share_percent', 40)),
      'photo_urls', jsonb_build_array('https://example.com/a.jpg', 'https://example.com/b.jpg')),
    jsonb_build_object('row', 3, 'external_code', 'V2-002', 'title', 'Soma errada',
      'purpose', 'sale', 'type', 'apartment', 'sale_price', 1, 'living_area', 1,
      'owners', jsonb_build_array(
        jsonb_build_object('name', 'A', 'email', 'a@exemplo.com', 'share_percent', 50),
        jsonb_build_object('name', 'B', 'email', 'b@exemplo.com', 'share_percent', 40))),
    jsonb_build_object('row', 4, 'external_code', 'V2-003', 'title', 'Casa do cliente existente',
      'purpose', 'rent', 'type', 'house', 'rent_price', 3000, 'living_area', 120,
      'owners', jsonb_build_array(
        jsonb_build_object('name', 'Cliente Existente', 'email', 'existente@exemplo.com'))),
    jsonb_build_object('row', 5, 'external_code', 'V2-004', 'title', 'Dono sem contato',
      'purpose', 'sale', 'type', 'apartment', 'sale_price', 1, 'living_area', 1,
      'owners', jsonb_build_array(jsonb_build_object('name', 'Sem Contato')))
  ));
  r := r || jsonb_build_object('imoveis_com_proprietarios', jsonb_build_object(
    'inserted', res -> 'inserted', 'updated', res -> 'updated',
    'skipped', res -> 'skipped', 'failed', res -> 'failed'));
  r := r || jsonb_build_object('motivos_proprietarios', (
    select jsonb_agg(
      (x.value ->> 'status') || coalesce(':' || (x.value ->> 'code'), '')
      order by (x.value ->> 'row')::integer)
    from jsonb_array_elements(res -> 'results') as x(value)));

  perform public.import_finish(org, job_props, 0, 0);

  reset role;

  select p.id into v_prop2 from public.properties p where p.organization_id = org and p.external_code = 'V2-001';
  select p.id into v_prop4 from public.properties p where p.organization_id = org and p.external_code = 'V2-003';

  r := r || jsonb_build_object('vinculos_e_percentuais', (
    select jsonb_agg(po.share_percent order by po.share_percent)
    from public.property_owners po where po.property_id = v_prop2));

  select count(*) = 2 and bool_and('Proprietário' = any (c.tags) and c.lgpd_legal_basis = 'contract')
  into v_bool
  from public.clients c
  where c.organization_id = org and c.name in ('Maria Dona', 'Joao Dono');
  r := r || jsonb_build_object('proprietario_novo_como_cliente', v_bool);

  select exists (
    select 1 from public.property_owners po
    where po.property_id = v_prop4 and po.client_id = v_existing_client and po.share_percent is null
  ) and (select count(*) from public.clients c where c.organization_id = org and c.email = 'existente@exemplo.com') = 1
  into v_bool;
  r := r || jsonb_build_object('proprietario_existente_reaproveitado', v_bool);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_assistant, 'role', 'authenticated')::text, true);
  set local role authenticated;

  res := public.import_photos_status(org, job_props);
  r := r || jsonb_build_object('fila_de_fotos', res - 'failures');

  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.import_photos_claim(org, job_props, 4);
    r := r || jsonb_build_object('corretor_nao_baixa_fotos', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('corretor_nao_baixa_fotos', 'NEGADO:' || sqlstate);
  end;

  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_assistant, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_claimed := public.import_photos_claim(org, job_props, 4);
  r := r || jsonb_build_object('fotos_reservadas', jsonb_array_length(v_claimed));

  for v_item in select x.value from jsonb_array_elements(v_claimed) as x(value) order by (x.value ->> 'position')::integer loop
    if (v_item ->> 'position')::integer = 0 then
      res := public.import_photos_complete(
        org, job_props, (v_item ->> 'id')::uuid,
        org::text || '/properties/' || (v_item ->> 'property_id') || '/' || gen_random_uuid()::text || '.jpg',
        null
      );
    else
      res := public.import_photos_complete(org, job_props, (v_item ->> 'id')::uuid, null, 'timeout');
    end if;
  end loop;

  execute 'select count(*) = 1 and bool_and(is_cover and kind = ''image'' and storage_path is not null)
    from public.property_media where property_id = $1'
    into v_bool using v_prop2;
  r := r || jsonb_build_object('foto_gravada_como_upload', v_bool);

  res := public.import_photos_status(org, job_props);
  r := r || jsonb_build_object('foto_com_falha', res - 'failures');
  r := r || jsonb_build_object('falha_sem_link', res -> 'failures');

  -- ---------------------------------------------------------------------------
  -- 4. Desfazer: clientes (um editado depois fica)
  -- ---------------------------------------------------------------------------
  perform public.import_start(org, job_clients, 'clients', 'skip', 2,
    '{"legal_basis": "legitimate_interest"}'::jsonb);
  perform public.import_batch(org, job_clients, 0, jsonb_build_array(
    jsonb_build_object('row', 2, 'name', 'Cliente Importado Um', 'phone', '11933330001'),
    jsonb_build_object('row', 3, 'name', 'Cliente Importado Dois', 'phone', '11933330002')
  ));
  perform public.import_finish(org, job_clients, 0, 0);

  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.clients set city = 'Campinas'
  where organization_id = org and name = 'Cliente Importado Dois';
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_assistant, 'role', 'authenticated')::text, true);
  set local role authenticated;

  for i in 1..10 loop
    v_prep := public.import_undo_prepare(org, job_clients, 100);
    res := public.import_undo_apply(org, job_clients);
    exit when (res ->> 'done')::boolean;
  end loop;

  r := r || jsonb_build_object('desfazer_clientes', jsonb_build_object(
    'removed', res -> 'removed' -> 'clients', 'kept', res -> 'kept' -> 'clients'));

  reset role;

  select (select count(*) from public.clients c where c.organization_id = org and c.name = 'Cliente Importado Dois') = 1
     and (select count(*) from public.clients c where c.organization_id = org and c.name = 'Cliente Importado Um') = 0
  into v_bool;
  r := r || jsonb_build_object('cliente_editado_fica', v_bool);

  select exists (
    select 1 from public.audit_events a
    where a.organization_id = org and a.action = 'import_undo' and a.entity = 'import_jobs'
      and a.entity_id = job_clients and a.actor_id = u_assistant
  ) and exists (
    select 1 from public.import_jobs j where j.id = job_clients and j.undone_at is not null and j.undone_by = u_assistant
  )
  into v_bool;
  r := r || jsonb_build_object('auditoria_do_desfazer', v_bool);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_assistant, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.import_undo_prepare(org, job_clients, 100);
    r := r || jsonb_build_object('desfazer_de_novo', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('desfazer_de_novo', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.import_batch(org, job_clients, 5, jsonb_build_array(
      jsonb_build_object('row', 9, 'name', 'Depois', 'phone', '11933330009')));
    r := r || jsonb_build_object('lote_depois_de_desfeita', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('lote_depois_de_desfeita', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 5. Desfazer: imóveis (dono desfaz a importação da assistente). O imóvel
  --    com vínculo feito à mão depois fica; o outro sai com fotos, vínculos e
  --    os clientes proprietários criados pela importação.
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.property_owners (organization_id, property_id, client_id, share_percent)
  values (org, v_prop4, v_other_client, null);

  for i in 1..10 loop
    v_prep := public.import_undo_prepare(org, job_props, 100);
    v_paths := v_paths + jsonb_array_length(v_prep -> 'storage_paths');
    res := public.import_undo_apply(org, job_props);
    exit when (res ->> 'done')::boolean;
  end loop;

  r := r || jsonb_build_object('desfazer_imoveis', jsonb_build_object(
    'removed', jsonb_strip_nulls((
      select jsonb_object_agg(e.key, e.value) from jsonb_each(res -> 'removed') e where e.value <> '0'::jsonb
    )),
    'kept', (
      select jsonb_object_agg(e.key, e.value) from jsonb_each(res -> 'kept') e where e.value <> '0'::jsonb
    )));
  r := r || jsonb_build_object('arquivos_das_fotos_para_apagar', v_paths);

  reset role;

  select not exists (select 1 from public.properties p where p.id = v_prop2)
     and exists (select 1 from public.properties p where p.id = v_prop4)
     and exists (select 1 from public.clients c where c.id = v_existing_client)
  into v_bool;
  r := r || jsonb_build_object('imovel_em_uso_fica', v_bool);

  -- ---------------------------------------------------------------------------
  -- 6. Desfazer: leads (o que mudou de etapa depois fica)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.leads set stage = 'lost', lost_reason = 'Preço' where id = v_lead_dated;

  for i in 1..10 loop
    v_prep := public.import_undo_prepare(org, job_leads, 100);
    res := public.import_undo_apply(org, job_leads);
    exit when (res ->> 'done')::boolean;
  end loop;

  r := r || jsonb_build_object('desfazer_leads', jsonb_build_object(
    'removed', res -> 'removed' -> 'leads', 'kept', res -> 'kept' -> 'leads'));

  reset role;

  -- ---------------------------------------------------------------------------
  -- 7. Prazo de 7 dias
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.import_start(org, job_old, 'leads', 'skip', 1, '{}'::jsonb);
  perform public.import_finish(org, job_old, 1, 0);
  reset role;

  update public.import_jobs
  set created_at = now() - interval '9 days', finished_at = now() - interval '8 days'
  where id = job_old;

  set local role authenticated;
  begin
    perform public.import_undo_prepare(org, job_old, 100);
    r := r || jsonb_build_object('prazo_de_7_dias', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('prazo_de_7_dias', 'NEGADO:' || sqlstate);
  end;
  reset role;

  raise exception 'TESTE DE IMPORTACAO V2 (rollback): %', jsonb_pretty(r);
end;
$$;
