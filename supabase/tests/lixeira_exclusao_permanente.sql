-- =============================================================================
-- Teste da lixeira, exclusão permanente, guarda legal e pedido do titular
-- =============================================================================
-- Migração 20260917122657_trash_bin_and_subject_erasure. Bloco único, sem
-- efeito no banco: cria os dados, confere tudo e termina com `raise exception`
-- — o resultado sai na mensagem do erro (P0001) e a transação inteira é
-- desfeita. Rode no SQL Editor do projeto ou pelo MCP execute_sql (sozinho).
--
-- Cobre:
--   1. Imóvel na lixeira some da página pública, sitemap, feed dos portais,
--      landing page, formulário de contato, busca global e lista (RLS); lead na
--      lixeira some da busca e do relatório de origens. Restaurar traz de volta.
--   2. Só dono e gerente movem, listam, restauram e excluem de vez (corretor:
--      42501 e lista vazia). Confirmação errada: 22023.
--   3. Exclusão permanente sem guarda apaga a linha, põe o arquivo na fila e
--      grava comprovante; a política de Storage deixa o gerente (e não o
--      corretor) ver o arquivo da fila; settle baixa a fila quando o arquivo
--      some.
--   4. Guarda legal: cliente com proposta aceita não é apagado (P0001
--      guarda_legal); anonimizar mantém nome e CPF até 5 anos da conclusão e
--      apaga contato e endereço.
--   5. Pedido do titular: lead sem guarda leva o cliente vinculado (os dois
--      apagados na hora); cliente com autorização assinada é anonimizado, com
--      nota no histórico. Comprovantes e auditoria sem dado pessoal.
--   6. Rotina diária: lead com mais de 30 dias é apagado, imóvel com dossiê é
--      anonimizado (fotos na fila, sem rua), identificação vencida sai.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   publico_pagina_nula / publico_sitemap_sem / publico_feed_sem /
--   publico_landing_sem / busca_global_sem_imovel / lista_rls_sem_imovel : true
--   publico_contato_na_lixeira                  : "P0002"
--   busca_global_sem_lead / relatorio_origens_sem_lead : true
--   restaurado_pagina_volta                     : true
--   corretor_move / corretor_restaura / corretor_exclui : "42501"
--   corretor_lista_vazia                        : true
--   confirmacao_errada                          : "22023"
--   dono_lista_tem_3                            : true
--   exclusao_sem_guarda_apagou / fila_tem_arquivo / comprovante_manual : true
--   gerente_ve_arquivo_da_fila                  : 1
--   corretor_ve_arquivo_da_fila                 : 0
--   settle_com_arquivo / settle_sem_arquivo     : 0 / 1
--   guarda_recusa_exclusao                      : "P0001 guarda_legal"
--   guarda_anonimizar_retorno                   : legal_holds [proposta_aceita, comissao] (o aceite lança a comissão)
--   guarda_anonimizou                           : nome mantido, cpf_mantido, email/telefone/rua/rg nulos, prazo_5_anos, bloqueado
--   titular_lead_apagado / titular_cliente_vinculado_apagado : true
--   titular_autorizacao_anonimizado             : nome "Titular anonimizado", documento nulo, nota no histórico, autorização mantida
--   comprovantes_titular                        : 3 (lead, cliente vinculado, cliente anonimizado)
--   comprovantes_sem_dado_pessoal / auditoria_sem_dado_pessoal : true
--   auditoria_acoes                             : trash 4, restore 1, purge 3, anonymize 2, subject_request 2 (mover/restaurar não geram "update")
--   rotina                                      : deleted 1, anonymized 1, identification_removed 1, failed 0
--   rotina_lead_apagado / rotina_imovel_anonimizado_sem_rua / rotina_dossie_mantido /
--   rotina_fotos_na_fila / rotina_identificacao_removida / cron_agendado : true
--
-- Resultado em 17/09/2026 (projeto qwaywbtyfkovulvirujp): todos os itens acima conferem.

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_manager uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  org uuid;
  slug constant text := 'teste-lixeira-lgpd';
  imv_publico uuid;
  c_publico text;
  imv_negocio uuid;
  imv_autorizacao uuid;
  imv_dossie uuid;
  cli_sem_guarda uuid;
  cli_proposta uuid;
  cli_vinculado uuid;
  cli_autorizacao uuid;
  lead_busca uuid;
  lead_titular uuid;
  lead_antigo uuid;
  arquivo_cliente text;
  foto_dossie text;
  v_int integer;
  v_bool boolean;
  v_text text;
  v_json jsonb;
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
         'teste-lixeira-' || u.nome || '@exemplo.invalid', now(), now(), now()
  from (values (u_owner, 'dono'), (u_manager, 'gerente'), (u_broker, 'corretor')) as u (id, nome);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Lixeira', slug);

  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org;

  update public.organizations set feed_token = repeat('ef', 24) where id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_manager, 'manager', true), (org, u_broker, 'broker', true);

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, neighborhood, city,
    street, street_number, published_to_portals, description
  )
  values
    (org, 'Casa Publica Lixeira', 'sale', 'house', 'active', 700000, 120, 'Centro', 'Campinas',
     'Rua A', '10', true, 'Casa ampla')
  returning id, code into imv_publico, c_publico;

  insert into public.properties (organization_id, title, purpose, type, status, sale_price, living_area, city, street)
  values (org, 'Apartamento Negociado', 'sale', 'apartment', 'active', 500000, 70, 'Campinas', 'Rua B')
  returning id into imv_negocio;

  insert into public.properties (organization_id, title, purpose, type, status, sale_price, living_area, city)
  values (org, 'Sala Autorizada', 'sale', 'office', 'active', 300000, 40, 'Campinas')
  returning id into imv_autorizacao;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, city, street, street_number, description
  )
  values (org, 'Terreno com Dossie', 'sale', 'house', 'active', 900000, 200, 'Campinas', 'Rua C', '99', 'Com matricula')
  returning id into imv_dossie;

  insert into public.landing_pages (organization_id, template, name, slug, status, published_at, content, property_ids)
  values (
    org, 'portfolio_grid', 'Vitrine', 'vitrine-lixeira', 'published', now(),
    jsonb_build_object('headline', 'Nossos imoveis'), array[imv_publico]
  );

  insert into public.clients (organization_id, kind, name, document, email, phone, street, assigned_to)
  values
    (org, 'pf', 'Cliente Sem Guarda', null, 'semguarda@exemplo.invalid', '11999990001', 'Rua X', u_broker)
  returning id into cli_sem_guarda;

  insert into public.clients (organization_id, kind, name, document, email, phone, street, rg, assigned_to)
  values (org, 'pf', 'Comprador Com Proposta', '12345678909', 'comprador@exemplo.invalid', '11999990002', 'Rua Y', '1234567', u_broker)
  returning id into cli_proposta;

  insert into public.clients (organization_id, kind, name, email)
  values (org, 'pf', 'Titular Vinculado Ao Lead', 'vinculado@exemplo.invalid')
  returning id into cli_vinculado;

  insert into public.clients (organization_id, kind, name, document, email, phone)
  values (org, 'pf', 'Proprietario Autorizou', '98765432100', 'proprietario@exemplo.invalid', '11999990003')
  returning id into cli_autorizacao;

  arquivo_cliente := org || '/clients/' || cli_sem_guarda || '/' || gen_random_uuid() || '.pdf';
  insert into storage.objects (bucket_id, name, owner_id) values ('client-documents', arquivo_cliente, u_owner::text);
  insert into public.client_documents (organization_id, client_id, name, storage_path, mime_type, size_bytes)
  values (org, cli_sem_guarda, 'RG.pdf', arquivo_cliente, 'application/pdf', 1024);

  insert into public.proposals (organization_id, property_id, client_id, broker_id, purpose, amount, status)
  values (org, imv_negocio, cli_proposta, u_broker, 'sale', 480000, 'sent');
  update public.proposals set status = 'accepted' where client_id = cli_proposta;

  insert into public.property_owners (organization_id, property_id, client_id)
  values (org, imv_autorizacao, cli_autorizacao);
  insert into public.listing_authorizations (
    organization_id, property_id, owner_client_id, exclusive, starts_on, ends_on, signed_at
  )
  values (org, imv_autorizacao, cli_autorizacao, true, (now() at time zone 'America/Sao_Paulo')::date - 5, (now() at time zone 'America/Sao_Paulo')::date + 60, now() - interval '5 days');

  foto_dossie := org || '/properties/' || imv_dossie || '/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name, owner_id) values ('property-media', foto_dossie, u_owner::text);
  insert into public.property_media (organization_id, property_id, kind, storage_path, position, is_cover)
  values (org, imv_dossie, 'image', foto_dossie, 1, true);
  insert into public.property_documents (organization_id, property_id, kind, storage_path, mime_type, size_bytes)
  values (org, imv_dossie, 'registry', org || '/properties/' || imv_dossie || '/' || gen_random_uuid() || '.pdf', 'application/pdf', 1024);

  insert into public.leads (organization_id, name, email, source)
  values (org, 'Lead Busca Lixeira', 'buscalixeira@exemplo.invalid', 'manual')
  returning id into lead_busca;

  insert into public.leads (organization_id, name, email, source, client_id)
  values (org, 'Lead Titular Pede', 'titularpede@exemplo.invalid', 'manual', cli_vinculado)
  returning id into lead_titular;

  insert into public.leads (organization_id, name, source)
  values (org, 'Lead Muito Antigo', 'manual')
  returning id into lead_antigo;

  -- ---------------------------------------------------------------------------
  -- 2. Corretor não mexe na lixeira
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.move_to_trash('property', imv_publico);
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_move', v_text);
  reset role;

  -- ---------------------------------------------------------------------------
  -- 1. Na lixeira some de tudo
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.move_to_trash('property', imv_publico);
  perform public.move_to_trash('lead', lead_busca);
  perform public.move_to_trash('client', cli_sem_guarda);

  r := r || jsonb_build_object(
    'busca_global_sem_imovel',
    (select count(*) from public.search_crm(org, 'Casa Publica Lixeira', 5) h where h.entity = 'property') = 0,
    'busca_global_sem_lead',
    (select count(*) from public.search_crm(org, 'Lead Busca Lixeira', 5) h where h.entity = 'lead') = 0,
    'lista_rls_sem_imovel', (select count(*) from public.properties where id = imv_publico) = 0,
    'relatorio_origens_sem_lead',
    coalesce((select sum(s.leads) from public.report_lead_sources(org, now() - interval '1 day', now() + interval '1 day', null, 50, null) s), 0) = 2
  );

  begin
    perform public.purge_from_trash('client', cli_sem_guarda, 'Outro Nome');
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('confirmacao_errada', v_text);

  select count(*) = 3 into v_bool from public.list_trash(org);
  r := r || jsonb_build_object('dono_lista_tem_3', v_bool);
  reset role;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  execute 'select public.get_public_property($1, $2) is null' into v_bool using slug, c_publico;
  r := r || jsonb_build_object('publico_pagina_nula', v_bool);

  execute 'select public.get_public_sitemap($1)::text' into v_text using slug;
  r := r || jsonb_build_object('publico_sitemap_sem', position(c_publico in v_text) = 0);

  execute 'select public.get_portal_feed($1, $2)::text' into v_text using slug, repeat('ef', 24);
  r := r || jsonb_build_object('publico_feed_sem', position('Casa Publica Lixeira' in coalesce(v_text, '')) = 0);

  execute 'select public.get_public_landing_page($1, $2)::text' into v_text using slug, 'vitrine-lixeira';
  r := r || jsonb_build_object('publico_landing_sem', position('Casa Publica Lixeira' in coalesce(v_text, '')) = 0);

  begin
    execute 'select public.submit_property_lead($1, $2, $3, $4, $5)'
    using slug, c_publico,
      jsonb_build_object('name', 'Curioso', 'email', 'curioso@exemplo.invalid', 'consent', 'true'),
      lead_key, 'nonce-teste-lixeira-' || gen_random_uuid();
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('publico_contato_na_lixeira', v_text);
  reset role;

  -- Corretor: lista vazia, não restaura nem exclui.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('corretor_lista_vazia', (select count(*) from public.list_trash(org)) = 0);
  begin
    perform public.restore_from_trash('property', imv_publico);
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_restaura', v_text);
  begin
    perform public.purge_from_trash('lead', lead_busca, 'Lead Busca Lixeira');
    v_text := 'passou';
  exception when others then
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('corretor_exclui', v_text);
  reset role;

  -- Gerente restaura o imóvel: a página pública volta.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.restore_from_trash('property', imv_publico);
  reset role;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  execute 'select public.get_public_property($1, $2) is not null' into v_bool using slug, c_publico;
  r := r || jsonb_build_object('restaurado_pagina_volta', v_bool);
  reset role;

  -- ---------------------------------------------------------------------------
  -- 3. Exclusão permanente sem guarda + fila do Storage
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.purge_from_trash('client', cli_sem_guarda, '  cliente sem   guarda ');
  r := r || jsonb_build_object('exclusao_sem_guarda_retorno', v_json);

  execute 'select count(*)::integer from storage.objects where bucket_id = $1 and name = $2'
  into v_int using 'client-documents', arquivo_cliente;
  r := r || jsonb_build_object('gerente_ve_arquivo_da_fila', v_int);

  v_int := public.settle_storage_purge_queue(org);
  r := r || jsonb_build_object('settle_com_arquivo', v_int);
  reset role;

  r := r || jsonb_build_object(
    'exclusao_sem_guarda_apagou', not exists (select 1 from public.clients where id = cli_sem_guarda),
    'fila_tem_arquivo', exists (
      select 1 from private.storage_purge_queue q
      where q.organization_id = org and q.bucket_id = 'client-documents' and q.object_path = arquivo_cliente
    ),
    'comprovante_manual', exists (
      select 1 from public.data_erasure_receipts d
      where d.organization_id = org and d.record_id = cli_sem_guarda and d.reason = 'manual'
        and d.outcome = 'deleted' and d.files_queued = 1 and d.executed_by = u_manager
    )
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select count(*)::integer from storage.objects where bucket_id = $1 and name = $2'
  into v_int using 'client-documents', arquivo_cliente;
  r := r || jsonb_build_object('corretor_ve_arquivo_da_fila', v_int);
  reset role;

  -- Simula a remoção pela Storage API e baixa a fila.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'client-documents' and name = arquivo_cliente;
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('settle_sem_arquivo', public.settle_storage_purge_queue(org));
  reset role;

  -- ---------------------------------------------------------------------------
  -- 4. Guarda legal: proposta aceita
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.move_to_trash('client', cli_proposta);
  begin
    perform public.purge_from_trash('client', cli_proposta, 'Comprador Com Proposta');
    v_text := 'passou';
  exception when others then
    get stacked diagnostics v_text = pg_exception_hint;
    v_text := sqlstate || ' ' || v_text;
  end;
  r := r || jsonb_build_object('guarda_recusa_exclusao', v_text);

  v_json := public.anonymize_from_trash('client', cli_proposta, 'Comprador Com Proposta');
  r := r || jsonb_build_object('guarda_anonimizar_retorno', v_json);
  reset role;

  select jsonb_build_object(
      'nome', c.name, 'cpf_mantido', c.document is not null, 'email_nulo', c.email is null,
      'telefone_nulo', c.phone is null, 'rua_nula', c.street is null, 'rg_nulo', c.rg is null,
      'prazo_5_anos', c.identification_kept_until = ((now() at time zone 'America/Sao_Paulo')::date + interval '5 years')::date,
      'bloqueado', c.deleted_at is not null and c.anonymized_at is not null
    )
    into v_json
  from public.clients c where c.id = cli_proposta;
  r := r || jsonb_build_object('guarda_anonimizou', v_json);

  -- ---------------------------------------------------------------------------
  -- 5. Pedido do titular
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_json := public.erase_subject_data('lead', lead_titular, 'Lead Titular Pede');
  r := r || jsonb_build_object('titular_lead_retorno', v_json);
  v_json := public.erase_subject_data('client', cli_autorizacao, 'Proprietario Autorizou');
  r := r || jsonb_build_object('titular_autorizacao_retorno', v_json);
  reset role;

  r := r || jsonb_build_object(
    'titular_lead_apagado', not exists (select 1 from public.leads where id = lead_titular),
    'titular_cliente_vinculado_apagado', not exists (select 1 from public.clients where id = cli_vinculado),
    'titular_autorizacao_anonimizado', (
      select jsonb_build_object(
        'nome', c.name, 'documento_nulo', c.document is null, 'email_nulo', c.email is null,
        'autorizacao_mantida', exists (select 1 from public.listing_authorizations la where la.owner_client_id = c.id),
        'nota_no_historico', exists (
          select 1 from public.activities a
          where a.client_id = c.id and a.body like 'Pedido do titular (LGPD, art. 18)%'
        )
      )
      from public.clients c where c.id = cli_autorizacao
    ),
    'comprovantes_titular', (
      select count(*) from public.data_erasure_receipts d
      where d.organization_id = org and d.reason = 'subject_request'
    ),
    'comprovantes_sem_dado_pessoal', not exists (
      select 1 from public.data_erasure_receipts d
      where d.organization_id = org
        and (to_jsonb(d)::text ~* 'Titular Pede|Vinculado|Proprietario Autorizou|Comprador|exemplo\.invalid|12345678909')
    ),
    'auditoria_sem_dado_pessoal', not exists (
      select 1 from public.audit_events a
      where a.organization_id = org
        and a.action in ('trash', 'restore', 'purge', 'anonymize', 'subject_request')
        and a.metadata::text ~* 'Titular|Vinculado|Proprietario|Comprador|exemplo\.invalid|12345678909'
    ),
    'auditoria_acoes', (
      select jsonb_object_agg(x.action, x.n)
      from (
        select a.action, count(*) as n from public.audit_events a
        where a.organization_id = org
          and a.action in ('trash', 'restore', 'purge', 'anonymize', 'subject_request', 'update')
        group by a.action
      ) x
    )
  );

  -- ---------------------------------------------------------------------------
  -- 6. Rotina diária
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  update public.leads set deleted_at = now() - interval '31 days' where id = lead_antigo;
  update public.properties set deleted_at = now() - interval '31 days' where id = imv_dossie;
  update public.clients set identification_kept_until = (now() at time zone 'America/Sao_Paulo')::date - 1 where id = cli_proposta;

  v_json := private.purge_expired_trash(1000);
  r := r || jsonb_build_object('rotina', v_json);

  r := r || jsonb_build_object(
    'rotina_lead_apagado', not exists (select 1 from public.leads where id = lead_antigo),
    'rotina_imovel_anonimizado_sem_rua', exists (
      select 1 from public.properties p
      where p.id = imv_dossie and p.anonymized_at is not null and p.street is null
        and p.description is null and not p.published_to_portals
    ),
    'rotina_dossie_mantido', exists (select 1 from public.property_documents d where d.property_id = imv_dossie),
    'rotina_fotos_na_fila', (
      select count(*) from private.storage_purge_queue q
      where q.organization_id = org and q.bucket_id = 'property-media' and q.object_path like org || '/properties/' || imv_dossie || '/%'
    ) = 2,
    'rotina_identificacao_removida', exists (
      select 1 from public.clients c
      where c.id = cli_proposta and c.name = 'Titular anonimizado' and c.document is null
        and c.identification_kept_until is null
    ),
    'cron_agendado', exists (select 1 from cron.job j where j.jobname = 'lixeira-expurgo-diario')
  );

  raise exception 'TESTE DA LIXEIRA E EXCLUSÃO PERMANENTE (rollback): %', jsonb_pretty(r);
end;
$$;
