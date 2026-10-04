-- =============================================================================
-- Teste da importação de planilhas (clientes, leads e imóveis)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- Cenário: 1 dono, 1 corretor (na fila do rodízio ligado) e o dono de outra
-- imobiliária. Já existe um cliente com telefone 11987654321 e e-mail
-- existente@exemplo.com. Todas as chamadas às RPCs rodam como `authenticated`
-- (sessão do usuário, RLS valendo).
--
-- Resultado esperado (a ordem das chaves pode variar):
--   corretor_nao_inicia                 : "NEGADO:42501"
--   estranho_nao_grava_no_lote_alheio   : "NEGADO:42501"
--   clientes_lote_0                     : {"failed": 2, "skipped": 2, "inserted": 3, "updated": 0}
--   motivos_lote_0                      : ["inserted", "skipped:duplicate_in_base", "failed:invalid_phone", "failed:required_contact", "inserted", "skipped:duplicate_in_base", "inserted"]
--   reenvio_do_lote_e_replay            : true
--   reenvio_nao_duplica                 : 4
--   etiqueta_e_base_legal               : true
--   importacao_fechada                  : {"failed": 3, "skipped": 3, "inserted": 3, "updated": 0}
--   auditoria_so_contagens              : true
--   fechar_de_novo_nao_duplica_auditoria: 1
--   lote_apos_fechar                    : "NEGADO:22023"
--   reimportar_cria_zero                : {"failed": 2, "skipped": 5, "inserted": 0, "updated": 0}
--   previa_linhas_existentes            : [2, 3, 6, 7, 8]
--   atualizar_existentes                : {"failed": 0, "skipped": 0, "inserted": 0, "updated": 1}
--   cidade_atualizada_sem_apagar_telefone   : true
--   lote_grande_recusado                : "NEGADO:22023"
--   leads_lote                          : {"failed": 1, "skipped": 0, "inserted": 3, "updated": 0}
--   lead_importado_fora_do_rodizio      : true
--   lead_com_responsavel_sem_prazo      : true
--   lead_perdido_ganha_motivo           : true
--   lead_manual_continua_no_rodizio     : true
--   imoveis_lote                        : {"failed": 1, "skipped": 0, "inserted": 3, "updated": 0}
--   imovel_completo_ativo               : "active"
--   imovel_incompleto_rascunho          : "draft:saved_as_draft"
--   codigo_imv_gerado_e_referencia      : true
--   imoveis_reimportados                : {"failed": 0, "skipped": 3, "inserted": 0, "updated": 0}
--   corretor_nao_ve_importacoes         : 0

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  org uuid;
  org_other uuid;
  job1 uuid := gen_random_uuid();
  job2 uuid := gen_random_uuid();
  job3 uuid := gen_random_uuid();
  job_leads uuid := gen_random_uuid();
  job_props uuid := gen_random_uuid();
  job_props2 uuid := gen_random_uuid();
  rows_clients jsonb;
  rows_leads jsonb;
  rows_props jsonb;
  res jsonb;
  res2 jsonb;
  v_int integer;
  v_bool boolean;
  v_text text;
begin
  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-importacao-dono@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-importacao-corretor@exemplo.invalid', now(), now(), now()),
    (u_stranger, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-importacao-estranho@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Importacao', 'teste-importacao');

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_broker, 'broker', true);

  insert into public.lead_routing_settings (
    organization_id, roulette_enabled, respect_schedule, fallback_to_page_assignee,
    sla_minutes, sla_reassign_enabled, sla_warning_percent, max_reassignments, time_zone
  )
  values (org, true, false, true, 5, true, 50, 1, 'America/Sao_Paulo');

  insert into public.lead_routing_members (organization_id, user_id, active, weight)
  values (org, u_broker, true, 1);

  insert into public.clients (organization_id, kind, name, phone, email, city, lgpd_legal_basis)
  values (org, 'pf', 'Cliente Existente', '11987654321', 'existente@exemplo.com', 'Campinas', 'contract');

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  org_other := public.create_organization('Outra Imobiliaria Importacao', 'teste-importacao-outra');

  -- Linhas já normalizadas como a tela envia (telefone só dígitos, e-mail minúsculo).
  rows_clients := jsonb_build_array(
    jsonb_build_object('row', 2, 'name', 'Ana Nova', 'phone', '11912345678', 'tags', jsonb_build_array('vip')),
    jsonb_build_object('row', 3, 'name', 'Mesmo Telefone', 'phone', '11987654321'),
    jsonb_build_object('row', 4, 'name', 'Telefone Ruim', 'phone', '123'),
    jsonb_build_object('row', 5, 'name', 'Sem Contato', 'city', 'Santos'),
    jsonb_build_object('row', 6, 'name', 'Bruno CPF', 'document', '52998224725', 'email', 'bruno@exemplo.com'),
    jsonb_build_object('row', 7, 'name', 'Mesmo Email', 'email', 'existente@exemplo.com'),
    jsonb_build_object('row', 8, 'name', 'Carla WhatsApp', 'whatsapp', '1133334444')
  );

  -- ---------------------------------------------------------------------------
  -- 1. Permissões
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.import_start(org, gen_random_uuid(), 'clients', 'skip', 10,
      '{"legal_basis": "legitimate_interest"}'::jsonb);
    r := r || jsonb_build_object('corretor_nao_inicia', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('corretor_nao_inicia', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2. Clientes: validação no banco, duplicados e idempotência do lote
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.import_start(org, job1, 'clients', 'skip', 9,
    '{"legal_basis": "legitimate_interest", "tag": "Importado"}'::jsonb);

  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.import_batch(org, job1, 0, rows_clients);
    r := r || jsonb_build_object('estranho_nao_grava_no_lote_alheio', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('estranho_nao_grava_no_lote_alheio', 'NEGADO:' || sqlstate);
  end;

  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  res := public.import_batch(org, job1, 0, rows_clients);
  r := r || jsonb_build_object('clientes_lote_0', jsonb_build_object(
    'inserted', res -> 'inserted', 'updated', res -> 'updated',
    'skipped', res -> 'skipped', 'failed', res -> 'failed'));
  r := r || jsonb_build_object('motivos_lote_0', (
    select jsonb_agg(
      (x.value ->> 'status') || coalesce(':' || (x.value ->> 'code'), '')
      order by (x.value ->> 'row')::integer)
    from jsonb_array_elements(res -> 'results') as x(value)));

  res2 := public.import_batch(org, job1, 0, rows_clients);
  r := r || jsonb_build_object('reenvio_do_lote_e_replay',
    (res2 ->> 'replayed')::boolean and res2 -> 'results' = res -> 'results');

  execute 'select count(*) from public.clients where organization_id = $1' into v_int using org;
  r := r || jsonb_build_object('reenvio_nao_duplica', v_int);

  execute 'select ''Importado'' = any (tags) and ''vip'' = any (tags)
      and lgpd_legal_basis = ''legitimate_interest''
    from public.clients where organization_id = $1 and name = ''Ana Nova'''
    into v_bool using org;
  r := r || jsonb_build_object('etiqueta_e_base_legal', v_bool);

  -- A tela recusou 1 linha na validação e achou 1 duplicada no próprio arquivo.
  res := public.import_finish(org, job1, 1, 1);
  r := r || jsonb_build_object('importacao_fechada', jsonb_build_object(
    'inserted', res -> 'inserted', 'updated', res -> 'updated',
    'skipped', res -> 'skipped', 'failed', res -> 'failed'));

  execute 'select bool_and(
      (select array_agg(k order by k) from jsonb_object_keys(metadata) k)
        = array[''batches'', ''duplicate_mode'', ''failed'', ''inserted'', ''kind'',
                ''photo_links'', ''skipped'', ''total_rows'', ''updated'']
      and entity = ''import_jobs'')
    from public.audit_events
    where organization_id = $1 and action = ''import'' and entity_id = $2'
    into v_bool using org, job1;
  r := r || jsonb_build_object('auditoria_so_contagens', v_bool);

  perform public.import_finish(org, job1, 1, 1);
  execute 'select count(*) from public.audit_events
    where organization_id = $1 and action = ''import'' and entity_id = $2'
    into v_int using org, job1;
  r := r || jsonb_build_object('fechar_de_novo_nao_duplica_auditoria', v_int);

  begin
    perform public.import_batch(org, job1, 1, rows_clients);
    r := r || jsonb_build_object('lote_apos_fechar', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('lote_apos_fechar', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 3. Reimportar o mesmo arquivo: nada novo
  -- ---------------------------------------------------------------------------
  perform public.import_start(org, job2, 'clients', 'skip', 7,
    '{"legal_basis": "legitimate_interest"}'::jsonb);
  res := public.import_batch(org, job2, 0, rows_clients);
  r := r || jsonb_build_object('reimportar_cria_zero', jsonb_build_object(
    'inserted', res -> 'inserted', 'updated', res -> 'updated',
    'skipped', res -> 'skipped', 'failed', res -> 'failed'));

  r := r || jsonb_build_object('previa_linhas_existentes',
    public.import_find_existing(org, 'clients', rows_clients));

  -- ---------------------------------------------------------------------------
  -- 4. Atualizar existentes: só o que veio preenchido substitui
  -- ---------------------------------------------------------------------------
  perform public.import_start(org, job3, 'clients', 'update', 1,
    '{"legal_basis": "contract"}'::jsonb);
  res := public.import_batch(org, job3, 0, jsonb_build_array(
    jsonb_build_object('row', 2, 'name', 'Cliente Existente', 'email', 'existente@exemplo.com',
      'city', 'Valinhos')));
  r := r || jsonb_build_object('atualizar_existentes', jsonb_build_object(
    'inserted', res -> 'inserted', 'updated', res -> 'updated',
    'skipped', res -> 'skipped', 'failed', res -> 'failed'));

  execute 'select city = ''Valinhos'' and phone = ''11987654321'' and lgpd_legal_basis = ''contract''
    from public.clients where organization_id = $1 and email = ''existente@exemplo.com'''
    into v_bool using org;
  r := r || jsonb_build_object('cidade_atualizada_sem_apagar_telefone', v_bool);

  begin
    perform public.import_batch(org, job3, 1, (
      select jsonb_agg(jsonb_build_object('row', g, 'name', 'X' || g, 'phone', '11999990000'))
      from generate_series(1, 251) g));
    r := r || jsonb_build_object('lote_grande_recusado', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('lote_grande_recusado', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 5. Leads: fora do rodízio e sem prazo de primeiro contato
  -- ---------------------------------------------------------------------------
  rows_leads := jsonb_build_array(
    jsonb_build_object('row', 2, 'name', 'Lead Sem Dono', 'phone', '11955554444', 'stage', 'new',
      'source', 'portal', 'interest', 'buy'),
    jsonb_build_object('row', 3, 'name', 'Lead Do Corretor', 'email', 'lead@exemplo.com',
      'assigned_to', u_broker),
    jsonb_build_object('row', 4, 'name', 'Lead Perdido', 'phone', '21988887777', 'stage', 'lost'),
    jsonb_build_object('row', 5, 'name', 'Lead Landing', 'phone', '21977776666', 'source', 'landing_page')
  );

  perform public.import_start(org, job_leads, 'leads', 'skip', 4, '{}'::jsonb);
  res := public.import_batch(org, job_leads, 0, rows_leads);
  r := r || jsonb_build_object('leads_lote', jsonb_build_object(
    'inserted', res -> 'inserted', 'updated', res -> 'updated',
    'skipped', res -> 'skipped', 'failed', res -> 'failed'));

  execute 'select assigned_to is null and routing_due_at is null and first_response_due_at is null
    from public.leads where organization_id = $1 and name = ''Lead Sem Dono'''
    into v_bool using org;
  r := r || jsonb_build_object('lead_importado_fora_do_rodizio', v_bool);

  execute 'select assigned_to = $2 and first_response_due_at is null
    from public.leads where organization_id = $1 and name = ''Lead Do Corretor'''
    into v_bool using org, u_broker;
  r := r || jsonb_build_object('lead_com_responsavel_sem_prazo', v_bool);

  execute 'select lost_reason is not null
    from public.leads where organization_id = $1 and name = ''Lead Perdido'''
    into v_bool using org;
  r := r || jsonb_build_object('lead_perdido_ganha_motivo', v_bool);

  -- Fora da importação, o lead manual continua indo para a roleta.
  insert into public.leads (organization_id, name, phone, source)
  values (org, 'Lead Manual', '11944443333', 'manual');

  execute 'select assigned_to = $2 and first_response_due_at is not null
    from public.leads where organization_id = $1 and name = ''Lead Manual'''
    into v_bool using org, u_broker;
  r := r || jsonb_build_object('lead_manual_continua_no_rodizio', v_bool);

  -- ---------------------------------------------------------------------------
  -- 6. Imóveis: rascunho quando falta o mínimo, código de referência e reimportação
  -- ---------------------------------------------------------------------------
  rows_props := jsonb_build_array(
    jsonb_build_object('row', 2, 'external_code', 'AP-001', 'title', 'Apartamento no Centro',
      'purpose', 'sale', 'type', 'apartment', 'sale_price', 450000, 'living_area', 72.5,
      'bedrooms', 2, 'features', jsonb_build_array('pool', 'Vista para o mar'), 'city', 'Campinas',
      'state', 'SP'),
    jsonb_build_object('row', 3, 'external_code', 'CA-002', 'title', 'Casa sem preço',
      'purpose', 'rent', 'type', 'house', 'living_area', 150),
    jsonb_build_object('row', 4, 'title', 'Terreno no Bairro Alto', 'title_generated', false,
      'purpose', 'sale', 'type', 'land', 'sale_price', 200000, 'lot_area', 360,
      'street', 'Rua das Flores', 'street_number', '10', 'city', 'Campinas'),
    jsonb_build_object('row', 5, 'title', 'Tipo inválido', 'purpose', 'sale', 'type', 'castle')
  );

  perform public.import_start(org, job_props, 'properties', 'skip', 4, '{}'::jsonb);
  res := public.import_batch(org, job_props, 0, rows_props);
  r := r || jsonb_build_object('imoveis_lote', jsonb_build_object(
    'inserted', res -> 'inserted', 'updated', res -> 'updated',
    'skipped', res -> 'skipped', 'failed', res -> 'failed'));

  execute 'select status::text from public.properties
    where organization_id = $1 and external_code = ''AP-001'''
    into v_text using org;
  r := r || jsonb_build_object('imovel_completo_ativo', v_text);

  select p.status::text || ':' || coalesce(x.value ->> 'code', '')
  into v_text
  from public.properties p
  cross join jsonb_array_elements(res -> 'results') as x(value)
  where p.organization_id = org and p.external_code = 'CA-002' and (x.value ->> 'row') = '3';
  r := r || jsonb_build_object('imovel_incompleto_rascunho', v_text);

  execute 'select bool_and(code ~ ''^IMV-[0-9]{6,}$'') and count(*) filter (where external_code is not null) = 2
    from public.properties where organization_id = $1'
    into v_bool using org;
  r := r || jsonb_build_object('codigo_imv_gerado_e_referencia', v_bool);

  perform public.import_start(org, job_props2, 'properties', 'skip', 3, '{}'::jsonb);
  res := public.import_batch(org, job_props2, 0, rows_props - 3);
  r := r || jsonb_build_object('imoveis_reimportados', jsonb_build_object(
    'inserted', res -> 'inserted', 'updated', res -> 'updated',
    'skipped', res -> 'skipped', 'failed', res -> 'failed'));

  reset role;

  -- ---------------------------------------------------------------------------
  -- 7. O corretor não enxerga o registro das importações
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*) from public.import_jobs where organization_id = $1' into v_int using org;
  r := r || jsonb_build_object('corretor_nao_ve_importacoes', v_int);

  reset role;

  raise exception 'TESTE DE IMPORTACAO (rollback): %', jsonb_pretty(r);
end;
$$;
