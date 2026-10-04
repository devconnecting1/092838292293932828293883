-- =============================================================================
-- Teste do imóvel restrito (sigilo) e do dossiê do imóvel
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- Cenário: a Cobertura Sigilosa é restrita, captada por um captador, com um
-- corretor responsável e compartilhada com um corretor escolhido. Pendurado
-- nela há de tudo: foto, proprietário, autorização, chave e retirada, proposta
-- (do corretor comum!) com link e pedido de desconto, atividade, visita,
-- tarefa, documento do dossiê e arquivos nos buckets. O Apartamento Aberto é o
-- controle: prova que o corretor comum enxerga o que não é restrito.
--
-- O que está sendo provado:
--
--   1. Corretor comum não lê NADA do imóvel restrito: tabelas (properties,
--      property_media, property_owners, listing_authorizations, keys,
--      key_movements, proposals, proposal_rounds, proposal_shares,
--      proposal_discount_requests, property_documents, property_shares,
--      activities, appointments, tasks), a view client_property_matches, os
--      buckets (property-media e property-documents), a lista de imóveis e a
--      busca por proprietário (search_properties), a busca global (search_crm),
--      as exportações de imóveis e de propostas, o painel
--      (dashboard_properties_by_status e dashboard_authorization_alerts), o
--      documento da proposta, o link, os pedidos de desconto e o registro de
--      acesso. Nem as funções de acesso deixam passar.
--   2. Assistente sem compartilhamento também não vê nem edita; e não consegue
--      marcar um imóvel como restrito.
--   3. Dono, gerente, captador, corretor responsável e o corretor escolhido veem
--      o imóvel, o dossiê e o arquivo do dossiê.
--   4. O corretor comum não se compartilha o imóvel, não envia documento e não
--      sobe arquivo no bucket do dossiê; o captador sobe.
--   5. Imóvel restrito nunca sai para fora: publicação nos portais é desligada
--      (gatilho + CHECK) e ele não aparece em página pública, sitemap, landing
--      page nem no formulário de contato do imóvel.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   corretor_tabelas                          : todas as 18 contagens 0
--   corretor_total_linhas_do_restrito         : 0
--   corretor_lista_imoveis / _busca_por_proprietario / _busca_global_titulo /
--   _busca_global_codigo / _exporta_restrito / _exporta_proposta_do_restrito /
--   _pedidos_de_desconto / _edita_restrito     : 0
--   corretor_painel_por_status                : "(active,1,800000.00,0)" (só o aberto)
--   corretor_painel_autorizacao_sem_restrito  : true
--   corretor_documento_da_proposta_nulo       : true
--   corretor_gera_link                        : "42501"
--   corretor_pede_desconto                    : "P0001 Proposta não encontrada."
--   corretor_registra_acesso_ao_imovel        : "P0002"
--   corretor_baixa_documento                  : "P0002"
--   corretor_funcoes_de_acesso                : tudo false, restrito_na_lista_de_ocultos true
--   corretor_se_compartilha / _registra_documento / _sobe_arquivo_no_dossie_alheio : "42501"
--   controle_corretor_ve_aberto               : properties 1, client_property_matches 1, storage_fotos 1
--   controle_corretor_busca_global_aberto     : 1
--   assistente_linhas_do_restrito / _edita_restrito : 0
--   assistente_can_edit_restrito              : false
--   assistente_marca_restrito                 : "42501"
--   dono_ve / gerente_ve / captador_ve        : 1
--   dono_documento_da_proposta                : true
--   dono_ve_compartilhamentos                 : 1
--   responsavel_ve_imovel_e_dossie            : 2
--   escolhido_ve                              : properties 1, property_documents 1, storage_dossie 1, proposals 1
--   escolhido_tira_sigilo                     : 0
--   captador_sobe_arquivo_no_dossie           : "passou"
--   captador_nome_de_arquivo_com_dado_pessoal : "42501"
--   captador_compartilha                      : 2
--   restrito_publicacao_desligada_no_cadastro / _na_edicao : true
--   publico_pagina_restrito_nula / publico_sitemap_sem_restrito /
--   publico_feed_sem_restrito / publico_landing_sem_restrito : true
--   controle_publico_pagina_aberto / _sitemap_com_aberto / _feed_com_aberto /
--   _landing_com_aberto                       : true
--   publico_contato_restrito                  : "P0002"

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_manager uuid := gen_random_uuid();
  u_cap uuid := gen_random_uuid();
  u_resp uuid := gen_random_uuid();
  u_shared uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_assist uuid := gen_random_uuid();
  org uuid;
  imv_restrito uuid;
  imv_aberto uuid;
  c_restrito text;
  c_aberto text;
  cli_dono uuid;
  cli_comprador uuid;
  chave uuid;
  proposta uuid;
  documento uuid;
  foto_restrita text;
  arquivo_dossie text;
  v_int integer;
  v_bool boolean;
  v_text text;
  v_json jsonb;
  v_export uuid;
  v_inicio timestamptz := now() - interval '1 day';
  v_fim timestamptz := now() + interval '1 day';
  lead_key text;
begin
  select ds.decrypted_secret into lead_key
  from vault.decrypted_secrets ds
  where ds.name = 'lead_server_key';

  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'teste-sigilo-' || u.nome || '@exemplo.invalid', now(), now(), now()
  from (
    values (u_owner, 'dono'), (u_manager, 'gerente'), (u_cap, 'captador'),
           (u_resp, 'responsavel'), (u_shared, 'escolhido'), (u_broker, 'corretor'),
           (u_assist, 'assistente')
  ) as u (id, nome);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Sigilo', 'teste-imovel-sigilo');

  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org;

  update public.organizations
  set feed_token = repeat('ab', 24)
  where id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values
    (org, u_manager, 'manager', true),
    (org, u_cap, 'capturer', true),
    (org, u_resp, 'broker', true),
    (org, u_shared, 'broker', true),
    (org, u_broker, 'broker', true),
    (org, u_assist, 'assistant', true);

  insert into public.clients (organization_id, kind, name, assigned_to)
  values (org, 'pf', 'Proprietario Sigiloso VIP', u_resp)
  returning id into cli_dono;

  insert into public.clients (organization_id, kind, name, assigned_to)
  values (org, 'pf', 'Comprador do Corretor', u_broker)
  returning id into cli_comprador;

  -- Restrito já no cadastro, pedindo publicação: o gatilho desliga.
  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, neighborhood, city,
    captured_by, broker_id, is_restricted, published_to_portals, registry_number
  )
  values (
    org, 'Cobertura Sigilosa', 'sale', 'apartment', 'active', 9000000, 400, 'Jardins', 'Sao Paulo',
    u_cap, u_resp, true, true, '123.456'
  )
  returning id, code into imv_restrito, c_restrito;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, neighborhood, city,
    published_to_portals
  )
  values (
    org, 'Apartamento Aberto', 'sale', 'apartment', 'active', 800000, 90, 'Jardins', 'Sao Paulo',
    true
  )
  returning id, code into imv_aberto, c_aberto;

  foto_restrita := org || '/properties/' || imv_restrito || '/' || gen_random_uuid() || '.jpg';
  arquivo_dossie := org || '/properties/' || imv_restrito || '/' || gen_random_uuid() || '.pdf';

  insert into storage.objects (bucket_id, name, owner_id)
  values
    ('property-media', foto_restrita, u_owner::text),
    ('property-media', org || '/properties/' || imv_aberto || '/' || gen_random_uuid() || '.jpg', u_owner::text),
    ('property-documents', arquivo_dossie, u_owner::text);

  insert into public.property_media (organization_id, property_id, kind, storage_path, position, is_cover)
  values (org, imv_restrito, 'image', foto_restrita, 1, true);

  insert into public.property_owners (organization_id, property_id, client_id)
  values (org, imv_restrito, cli_dono);

  insert into public.listing_authorizations (organization_id, property_id, owner_client_id, exclusive, starts_on, ends_on)
  values (org, imv_restrito, cli_dono, true, (now() at time zone 'America/Sao_Paulo')::date - 30, (now() at time zone 'America/Sao_Paulo')::date + 10);

  insert into public.keys (organization_id, property_id, label, location)
  values (org, imv_restrito, 'Chave da cobertura', 'Cofre')
  returning id into chave;

  insert into public.key_movements (organization_id, key_id, taken_by_user, created_by)
  values (org, chave, u_resp, u_owner);

  -- Proposta do corretor comum, anterior ao sigilo (ele é o corretor dela).
  insert into public.proposals (organization_id, property_id, client_id, broker_id, purpose, amount, status)
  values (org, imv_restrito, cli_comprador, u_broker, 'sale', 8500000, 'sent')
  returning id into proposta;

  insert into public.proposal_shares (organization_id, proposal_id, token, expires_at)
  values (org, proposta, repeat('cd', 24), now() + interval '10 days');

  insert into public.proposal_discount_requests (
    organization_id, proposal_id, amount_cents, reference_cents, discount_percent, requested_by
  )
  values (org, proposta, 850000000, 900000000, 5.556, u_broker);

  insert into public.activities (organization_id, property_id, type, body)
  values (org, imv_restrito, 'note', 'Visita do comprador VIP na cobertura');

  insert into public.appointments (organization_id, property_id, broker_id, starts_at)
  values (org, imv_restrito, u_resp, now() + interval '1 day');

  insert into public.tasks (organization_id, title, assignee_id, property_id)
  values (org, 'Levar a planta da cobertura', u_resp, imv_restrito);

  insert into public.property_documents (organization_id, property_id, kind, valid_until, storage_path, mime_type, size_bytes)
  values (org, imv_restrito, 'registry', (now() at time zone 'America/Sao_Paulo')::date + 30, arquivo_dossie, 'application/pdf', 1024)
  returning id into documento;

  insert into public.property_shares (organization_id, property_id, user_id)
  values (org, imv_restrito, u_shared);

  -- Interesse do comprador compatível com os dois imóveis.
  insert into public.client_interests (organization_id, client_id, purpose, city)
  values (org, cli_comprador, 'sale', 'Sao Paulo');

  insert into public.landing_pages (organization_id, template, name, slug, status, published_at, content, property_ids)
  values (
    org, 'portfolio_grid', 'Vitrine', 'vitrine-sigilo', 'published', now(),
    jsonb_build_object('headline', 'Nossos imoveis'), array[imv_restrito, imv_aberto]
  );

  -- O dono libera exportação para corretores.
  perform public.set_export_roles(org, '{broker}'::public.app_role[]);

  -- ---------------------------------------------------------------------------
  -- 5. Nada sai para fora (e a publicação ficou desligada)
  -- ---------------------------------------------------------------------------
  select p.published_to_portals into v_bool from public.properties p where p.id = imv_restrito;
  r := r || jsonb_build_object('restrito_publicacao_desligada_no_cadastro', not v_bool);

  update public.properties set published_to_portals = true where id = imv_restrito;
  select p.published_to_portals into v_bool from public.properties p where p.id = imv_restrito;
  r := r || jsonb_build_object('restrito_publicacao_desligada_na_edicao', not v_bool);

  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  execute 'select public.get_public_property($1, $2) is null' into v_bool
  using 'teste-imovel-sigilo', c_restrito;
  r := r || jsonb_build_object('publico_pagina_restrito_nula', v_bool);

  execute 'select public.get_public_property($1, $2) is not null' into v_bool
  using 'teste-imovel-sigilo', c_aberto;
  r := r || jsonb_build_object('controle_publico_pagina_aberto', v_bool);

  execute 'select public.get_public_sitemap($1)::text' into v_text using 'teste-imovel-sigilo';
  r := r || jsonb_build_object(
    'publico_sitemap_sem_restrito', position(c_restrito in v_text) = 0,
    'controle_publico_sitemap_com_aberto', position(c_aberto in v_text) > 0
  );

  execute 'select public.get_portal_feed($1, $2)::text' into v_text
  using 'teste-imovel-sigilo', repeat('ab', 24);
  r := r || jsonb_build_object(
    'publico_feed_sem_restrito', position('Cobertura Sigilosa' in v_text) = 0,
    'controle_publico_feed_com_aberto', position('Apartamento Aberto' in v_text) > 0
  );

  execute 'select public.get_public_landing_page($1, $2)::text' into v_text
  using 'teste-imovel-sigilo', 'vitrine-sigilo';
  r := r || jsonb_build_object(
    'publico_landing_sem_restrito', position('Cobertura Sigilosa' in v_text) = 0,
    'controle_publico_landing_com_aberto', position('Apartamento Aberto' in v_text) > 0
  );

  begin
    execute 'select public.submit_property_lead($1, $2, $3, $4, $5)'
    using 'teste-imovel-sigilo', c_restrito,
      jsonb_build_object('name', 'Curioso', 'email', 'curioso@exemplo.invalid', 'consent', 'true'),
      lead_key, 'nonce-teste-sigilo-' || gen_random_uuid();
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('publico_contato_restrito', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 1. Corretor comum: nada do imóvel restrito
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute $q$
    select jsonb_build_object(
      'properties', (select count(*) from public.properties where id = $1),
      'property_media', (select count(*) from public.property_media where property_id = $1),
      'property_owners', (select count(*) from public.property_owners where property_id = $1),
      'listing_authorizations', (select count(*) from public.listing_authorizations where property_id = $1),
      'keys', (select count(*) from public.keys where property_id = $1),
      'key_movements', (select count(*) from public.key_movements where key_id = $2),
      'proposals', (select count(*) from public.proposals where property_id = $1),
      'proposal_rounds', (select count(*) from public.proposal_rounds where proposal_id = $3),
      'proposal_shares', (select count(*) from public.proposal_shares where proposal_id = $3),
      'proposal_discount_requests', (select count(*) from public.proposal_discount_requests where proposal_id = $3),
      'property_documents', (select count(*) from public.property_documents where property_id = $1),
      'property_shares', (select count(*) from public.property_shares where property_id = $1),
      'activities', (select count(*) from public.activities where property_id = $1),
      'appointments', (select count(*) from public.appointments where property_id = $1),
      'tasks', (select count(*) from public.tasks where property_id = $1),
      'client_property_matches', (select count(*) from public.client_property_matches where property_id = $1),
      'storage_fotos', (select count(*) from storage.objects where bucket_id = 'property-media' and name like $4),
      'storage_dossie', (select count(*) from storage.objects where bucket_id = 'property-documents' and name like $4)
    )
  $q$ into v_json using imv_restrito, chave, proposta, '%' || imv_restrito || '%';
  r := r || jsonb_build_object('corretor_tabelas', v_json);

  select sum(value::integer)::integer into v_int from jsonb_each_text(v_json);
  r := r || jsonb_build_object('corretor_total_linhas_do_restrito', v_int);

  execute $q$
    select jsonb_build_object(
      'properties', (select count(*) from public.properties where id = $1),
      'client_property_matches', (select count(*) from public.client_property_matches where property_id = $1),
      'storage_fotos', (select count(*) from storage.objects where bucket_id = 'property-media' and name like $2)
    )
  $q$ into v_json using imv_aberto, '%' || imv_aberto || '%';
  r := r || jsonb_build_object('controle_corretor_ve_aberto', v_json);

  execute 'select count(*)::integer from public.search_properties($1, $2)'
  into v_int using org, 'Sigilosa';
  r := r || jsonb_build_object('corretor_lista_imoveis', v_int);

  execute 'select count(*)::integer from public.search_properties($1, $2)'
  into v_int using org, 'Proprietario Sigiloso';
  r := r || jsonb_build_object('corretor_busca_por_proprietario', v_int);

  execute 'select count(*)::integer from public.search_crm($1, $2) h where h.entity = $3'
  into v_int using org, 'Sigilosa', 'property';
  r := r || jsonb_build_object('corretor_busca_global_titulo', v_int);

  execute 'select count(*)::integer from public.search_crm($1, $2) h where h.entity = $3'
  into v_int using org, lower(c_restrito), 'property';
  r := r || jsonb_build_object('corretor_busca_global_codigo', v_int);

  execute 'select count(*)::integer from public.search_crm($1, $2) h where h.entity = $3'
  into v_int using org, 'Aberto', 'property';
  r := r || jsonb_build_object('controle_corretor_busca_global_aberto', v_int);

  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, $5) s'
  into v_export using org, 'propostas', v_inicio, v_fim, '30-dias';
  execute 'select count(*)::integer from public.export_proposals_rows($1, $2, $3, $4) e where e.id = $5'
  into v_int using org, v_export, v_inicio, v_fim, proposta;
  r := r || jsonb_build_object('corretor_exporta_proposta_do_restrito', v_int);

  execute 'select s.export_id from public.start_data_export($1, $2, $3, $4, null, $5) s'
  into v_export using org, 'imoveis', v_inicio, v_fim, '30-dias';
  execute 'select count(*)::integer from public.export_properties_rows($1, $2, $3, $4) e where e.id = $5'
  into v_int using org, v_export, v_inicio, v_fim, imv_restrito;
  r := r || jsonb_build_object('corretor_exporta_restrito', v_int);

  execute 'select public.dashboard_properties_by_status($1)::text' into v_text using org;
  r := r || jsonb_build_object('corretor_painel_por_status', v_text);

  execute 'select position($2 in public.dashboard_authorization_alerts($1)::text) = 0'
  into v_bool using org, c_restrito;
  r := r || jsonb_build_object('corretor_painel_autorizacao_sem_restrito', v_bool);

  execute 'select public.get_proposal_document($1) is null' into v_bool using proposta;
  r := r || jsonb_build_object('corretor_documento_da_proposta_nulo', v_bool);

  execute 'select count(*)::integer from public.list_proposal_discount_requests($1, $2)'
  into v_int using org, array[proposta];
  r := r || jsonb_build_object('corretor_pedidos_de_desconto', v_int);

  begin
    execute 'select public.share_proposal($1)' using proposta;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_gera_link', v_text);

  begin
    execute 'select public.request_proposal_discount($1, $2)' using proposta, 'teste';
    v_text := 'passou';
  exception when others then
    v_text := sqlstate || ' ' || sqlerrm;
  end;
  r := r || jsonb_build_object('corretor_pede_desconto', v_text);

  begin
    execute 'select public.log_access_event($1, $2, $3)' using 'properties', imv_restrito, 'view';
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_registra_acesso_ao_imovel', v_text);

  begin
    execute 'select public.log_access_event($1, $2, $3)' using 'property_documents', documento, 'download';
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_baixa_documento', v_text);

  execute $q$
    select jsonb_build_object(
      'can_view_property', private.can_view_property($1),
      'can_edit_property', private.can_edit_property($1),
      'can_manage_property', private.can_manage_property($1),
      'storage_can_view_property', private.storage_can_view_property(array[$2::text, 'properties', $1::text]),
      'restrito_na_lista_de_ocultos', $1 = any (private.hidden_property_ids())
    )
  $q$ into v_json using imv_restrito, org;
  r := r || jsonb_build_object('corretor_funcoes_de_acesso', v_json);

  execute 'with u as (update public.properties set title = $2 where id = $1 returning 1) select count(*)::integer from u'
  into v_int using imv_restrito, 'Tentativa';
  r := r || jsonb_build_object('corretor_edita_restrito', v_int);

  begin
    execute 'insert into public.property_shares (organization_id, property_id, user_id) values ($1, $2, $3)'
    using org, imv_restrito, u_broker;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_se_compartilha', v_text);

  begin
    execute $q$
      insert into public.property_documents (organization_id, property_id, kind, storage_path, mime_type, size_bytes)
      values ($1, $2, 'other', $3, 'application/pdf', 10)
    $q$ using org, imv_restrito, arquivo_dossie;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_registra_documento', v_text);

  begin
    execute 'insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)'
    using 'property-documents', org || '/properties/' || imv_aberto || '/' || gen_random_uuid() || '.pdf', u_broker::text;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_sobe_arquivo_no_dossie_alheio', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2. Assistente sem compartilhamento
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_assist, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute $q$
    select (select count(*) from public.properties where id = $1)
      + (select count(*) from public.property_documents where property_id = $1)
      + (select count(*) from public.proposals where property_id = $1)
      + (select count(*) from public.appointments where property_id = $1)
      + (select count(*) from public.tasks where property_id = $1)
  $q$ into v_int using imv_restrito;
  r := r || jsonb_build_object('assistente_linhas_do_restrito', v_int);

  execute 'with u as (update public.properties set title = $2 where id = $1 returning 1) select count(*)::integer from u'
  into v_int using imv_restrito, 'Tentativa';
  r := r || jsonb_build_object('assistente_edita_restrito', v_int);

  execute 'select private.can_edit_property($1)' into v_bool using imv_restrito;
  r := r || jsonb_build_object('assistente_can_edit_restrito', v_bool);

  begin
    execute 'update public.properties set is_restricted = true where id = $1' using imv_aberto;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('assistente_marca_restrito', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 3 e 4. Quem tem acesso
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select (select count(*) from public.properties where id = $1)::integer' into v_int using imv_restrito;
  r := r || jsonb_build_object('dono_ve', v_int);
  execute 'select public.get_proposal_document($1) is not null' into v_bool using proposta;
  r := r || jsonb_build_object('dono_documento_da_proposta', v_bool);
  execute 'select count(*)::integer from public.property_shares where property_id = $1' into v_int using imv_restrito;
  r := r || jsonb_build_object('dono_ve_compartilhamentos', v_int);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select (select count(*) from public.properties where id = $1)::integer' into v_int using imv_restrito;
  r := r || jsonb_build_object('gerente_ve', v_int);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_resp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute $q$
    select (select count(*) from public.properties where id = $1)::integer
      + (select count(*) from public.property_documents where property_id = $1)::integer
  $q$ into v_int using imv_restrito;
  r := r || jsonb_build_object('responsavel_ve_imovel_e_dossie', v_int);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_shared, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute $q$
    select jsonb_build_object(
      'properties', (select count(*) from public.properties where id = $1),
      'property_documents', (select count(*) from public.property_documents where property_id = $1),
      'storage_dossie', (select count(*) from storage.objects where bucket_id = 'property-documents' and name = $2),
      'proposals', (select count(*) from public.proposals where property_id = $1)
    )
  $q$ into v_json using imv_restrito, arquivo_dossie;
  r := r || jsonb_build_object('escolhido_ve', v_json);

  -- Quem foi escolhido só vê: não edita (nem tira o sigilo).
  execute 'with u as (update public.properties set is_restricted = false where id = $1 returning 1) select count(*)::integer from u'
  into v_int using imv_restrito;
  r := r || jsonb_build_object('escolhido_tira_sigilo', v_int);
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_cap, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select (select count(*) from public.properties where id = $1)::integer' into v_int using imv_restrito;
  r := r || jsonb_build_object('captador_ve', v_int);

  begin
    execute 'insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)'
    using 'property-documents', org || '/properties/' || imv_restrito || '/' || gen_random_uuid() || '.pdf', u_cap::text;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('captador_sobe_arquivo_no_dossie', v_text);

  begin
    execute 'insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)'
    using 'property-documents', org || '/properties/' || imv_restrito || '/Matricula Joao Silva.pdf', u_cap::text;
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('captador_nome_de_arquivo_com_dado_pessoal', v_text);

  execute 'insert into public.property_shares (organization_id, property_id, user_id) values ($1, $2, $3)'
  using org, imv_restrito, u_assist;
  execute 'select count(*)::integer from public.property_shares where property_id = $1' into v_int using imv_restrito;
  r := r || jsonb_build_object('captador_compartilha', v_int);
  reset role;

  raise exception 'TESTE DO IMÓVEL RESTRITO (rollback): %', jsonb_pretty(r);
end;
$$;
