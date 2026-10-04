-- =============================================================================
-- Teste da exclusão da imobiliária, da exclusão da própria conta e da lixeira
-- fora do limite de imóveis com foto
-- =============================================================================
-- Migração 20260917140155_organization_and_account_deletion. Bloco único, sem efeito no
-- banco: cria os dados, confere tudo e termina com `raise exception` — o
-- resultado sai na mensagem do erro (P0001) e a transação inteira é desfeita.
-- Rode no SQL Editor do projeto ou pelo MCP execute_sql (sozinho).
--
-- Cobre:
--   1. Lixeira fora do limite: imóvel com foto na lixeira não conta
--      (owned_listing_count e get_owned_listing_usage); a vaga liberada aceita
--      a foto de outro imóvel; restaurar acima do limite é recusado.
--   2. Agendar exclusão: corretor e gerente 42501; confirmação errada 22023;
--      assinatura que renova P0001 assinatura_ativa; agendado = modo leitura
--      (gatilho a0_billing_writable recusa lead novo); membro vê o agendamento,
--      estranho não; agendar de novo 55000.
--   3. Aviso de 3 dias: chave errada 42501; aparece só a 3 dias e uma vez.
--   4. Cancelar: só o dono; a escrita volta; auditoria sem dado pessoal.
--   5. Executar: assinatura voltou a renovar = pula; sem renovação apaga a
--      imobiliária em cascata e registra a limpeza do Storage; o servidor
--      (anon + chave) reserva os arquivos, a política anon libera só o
--      reservado, e o settle solta a reserva vencida sem concluir enquanto há
--      arquivo.
--   6. Excluir minha conta: confirmação errada 22023; único dono P0001
--      unico_dono; com outro dono, perfil anonimizado, memberships inativas,
--      push, preferências e rodízio apagados; a imobiliária continua.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   limite_antes / uso_rpc_antes                 : 1 / 1
--   limite_com_imovel_na_lixeira                 : 0
--   foto_em_outro_imovel_com_vaga                : "ok"
--   restaurar_acima_do_limite                    : "P0001 limite_owned_listings"
--   agendar_corretor / agendar_gerente           : "42501"
--   agendar_confirmacao_errada                   : "22023"
--   agendar_com_assinatura_renovando             : "P0001 assinatura_ativa"
--   agendado_30_dias / agendado_emails_do_dono   : true / true
--   agendado_modo_leitura                        : "read_only"
--   agendado_lead_novo                           : "P0001 assinatura_somente_leitura"
--   agendado_membro_ve / agendado_estranho_ve    : true / 0
--   agendar_de_novo                              : "55000"
--   aviso_chave_errada                           : "42501"
--   aviso_a_30_dias / aviso_a_2_dias / aviso_depois_de_marcar : 0 / 1 / 0
--   aviso_marcado                                : true
--   cancelar_gerente                             : "42501"
--   cancelado_escrita_volta / cancelado_estado   : "ok" / "active"
--   auditoria_acoes                              : deletion_scheduled 2, deletion_canceled 1
--   auditoria_sem_dado_pessoal                   : true
--   executar_com_assinatura_renovando            : skipped 1, deleted 0 (last_error assinatura_ativa)
--   executar                                     : deleted 1, skipped 0, failed 0
--   executado_imobiliaria_apagada / executado_cascata / executado_registro : true
--   storage_claim_chave_errada                   : "42501"
--   storage_claim_reservou                       : 3
--   storage_politica_anon_reservado / storage_politica_anon_outro : 1 / 0
--   storage_settle_com_arquivo                   : released 0, finished 0
--   storage_settle_reserva_vencida               : released 3, finished 0
--   conta_confirmacao_errada                     : "22023"
--   conta_unico_dono / conta_bloqueios           : "P0001 unico_dono" / 1
--   conta_excluida_retorno                       : memberships_deactivated 1
--   conta_perfil_anonimizado / conta_sem_acesso / conta_dados_pessoais_apagados : true
--   conta_imobiliaria_continua_com_dono          : true
--   conta_corretor_excluida                      : true
--   cron_agendado                                : true
--
-- Resultado em 17/09/2026 (projeto qwaywbtyfkovulvirujp, depois de aplicar a
-- migração): todos os itens acima conferem.

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_manager uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_stranger uuid := gen_random_uuid();
  u_solo uuid := gen_random_uuid();
  u_coowner uuid := gen_random_uuid();
  u_leaver uuid := gen_random_uuid();
  org uuid;
  org_conta uuid;
  imv_a uuid;
  imv_b uuid;
  arquivo_doc text;
  arquivo_outro text;
  server_key text;
  v_int integer;
  v_text text;
  v_hint text;
  v_json jsonb;
begin
  -- ---------------------------------------------------------------------------
  -- Cenário
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'teste-exclusao-' || u.nome || '@exemplo.invalid', now(), now(), now()
  from (
    values (u_owner, 'dono'), (u_manager, 'gerente'), (u_broker, 'corretor'), (u_stranger, 'estranho'),
           (u_solo, 'solo'), (u_coowner, 'codono'), (u_leaver, 'saindo')
  ) as u (id, nome);

  select ds.decrypted_secret into server_key
  from vault.decrypted_secrets ds
  where ds.name = 'organization_deletion_server_key';

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Exclusao', 'teste-exclusao-imob');

  update public.billing_accounts
  set limits = limits || '{"owned_listings": 1, "users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_manager, 'manager', true), (org, u_broker, 'broker', true);

  -- ---------------------------------------------------------------------------
  -- 1. Lixeira fora do limite de imóveis com foto
  -- ---------------------------------------------------------------------------
  insert into public.properties (organization_id, title, purpose, type, status, sale_price, living_area, city)
  values (org, 'Casa Com Foto', 'sale', 'house', 'active', 500000, 90, 'Campinas')
  returning id into imv_a;

  insert into public.properties (organization_id, title, purpose, type, status, sale_price, living_area, city)
  values (org, 'Apartamento Novo', 'sale', 'apartment', 'active', 400000, 60, 'Campinas')
  returning id into imv_b;

  insert into storage.objects (bucket_id, name, owner_id)
  values
    ('property-media', org || '/properties/' || imv_a || '/a1.webp', u_owner::text),
    ('property-media', org || '/properties/' || imv_b || '/b1.webp', u_owner::text);

  insert into public.property_media (organization_id, property_id, kind, storage_path, position)
  values (org, imv_a, 'image', org || '/properties/' || imv_a || '/a1.webp', 1);

  r := r || jsonb_build_object('limite_antes', private.owned_listing_count(org));

  set local role authenticated;
  r := r || jsonb_build_object('uso_rpc_antes', public.get_owned_listing_usage(org));
  perform public.move_to_trash('property', imv_a);
  reset role;

  r := r || jsonb_build_object('limite_com_imovel_na_lixeira', private.owned_listing_count(org));

  begin
    insert into public.property_media (organization_id, property_id, kind, storage_path, position)
    values (org, imv_b, 'image', org || '/properties/' || imv_b || '/b1.webp', 1);
    v_text := 'ok';
  exception when others then
    v_text := sqlstate || ' ' || sqlerrm;
  end;
  r := r || jsonb_build_object('foto_em_outro_imovel_com_vaga', v_text);

  begin
    set local role authenticated;
    perform public.restore_from_trash('property', imv_a);
    reset role;
    v_text := 'ok';
  exception when others then
    reset role;
    v_text := sqlstate || ' ' || sqlerrm;
  end;
  r := r || jsonb_build_object('restaurar_acima_do_limite', v_text);

  -- ---------------------------------------------------------------------------
  -- 2. Agendar a exclusão da imobiliária
  -- ---------------------------------------------------------------------------
  update public.billing_accounts
  set stripe_customer_id = 'cus_TesteExclusao', stripe_subscription_id = 'sub_TesteExclusao',
      status = 'active', current_period_end = now() + interval '20 days', cancel_at_period_end = false
  where organization_id = org;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.schedule_organization_deletion(org, 'teste-exclusao-imob');
    reset role;
    v_text := 'ok';
  exception when others then
    reset role;
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('agendar_corretor', v_text);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.schedule_organization_deletion(org, 'teste-exclusao-imob');
    reset role;
    v_text := 'ok';
  exception when others then
    reset role;
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('agendar_gerente', v_text);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.schedule_organization_deletion(org, 'outra-imobiliaria');
    reset role;
    v_text := 'ok';
  exception when others then
    reset role;
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('agendar_confirmacao_errada', v_text);

  begin
    set local role authenticated;
    perform public.schedule_organization_deletion(org, 'teste-exclusao-imob');
    reset role;
    v_text := 'ok';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    reset role;
    v_text := sqlstate || ' ' || coalesce(v_hint, '');
  end;
  r := r || jsonb_build_object('agendar_com_assinatura_renovando', v_text);

  update public.billing_accounts set cancel_at_period_end = true where organization_id = org;

  set local role authenticated;
  v_json := public.schedule_organization_deletion(org, '  Imobiliaria   TESTE Exclusao ');
  reset role;

  r := r || jsonb_build_object(
    'agendado_30_dias',
      (v_json ->> 'execute_after')::timestamptz between now() + interval '29 days 23 hours'
                                                   and now() + interval '30 days 1 hour',
    'agendado_emails_do_dono',
      (v_json -> 'owner_emails') = '["teste-exclusao-dono@exemplo.invalid"]'::jsonb,
    'agendado_modo_leitura', private.billing_state(org)
  );

  begin
    insert into public.leads (organization_id, name, phone, source, stage)
    values (org, 'Lead Na Trava', '11999990201', 'manual', 'new');
    v_text := 'ok';
  exception when others then
    v_text := sqlstate || ' ' || sqlerrm;
  end;
  r := r || jsonb_build_object('agendado_lead_novo', v_text);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select d.scheduled into v_text from public.get_organization_deletion(org) d;
  reset role;
  r := r || jsonb_build_object('agendado_membro_ve', v_text::boolean);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*)::integer into v_int from public.get_organization_deletion(org);
  reset role;
  r := r || jsonb_build_object('agendado_estranho_ve', v_int);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.schedule_organization_deletion(org, 'teste-exclusao-imob');
    reset role;
    v_text := 'ok';
  exception when others then
    reset role;
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('agendar_de_novo', v_text);

  -- ---------------------------------------------------------------------------
  -- 3. Aviso de 3 dias (servidor, anon + chave)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    set local role anon;
    perform public.list_organization_deletion_reminders('chave-errada', 10);
    reset role;
    v_text := 'ok';
  exception when others then
    reset role;
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('aviso_chave_errada', v_text);

  set local role anon;
  select count(*)::integer into v_int
  from public.list_organization_deletion_reminders(server_key, 50) x where x.organization_id = org;
  reset role;
  r := r || jsonb_build_object('aviso_a_30_dias', v_int);

  update private.organization_deletions set execute_after = now() + interval '2 days' where organization_id = org;

  set local role anon;
  select count(*)::integer into v_int
  from public.list_organization_deletion_reminders(server_key, 50) x
  where x.organization_id = org
    and x.recipient_emails = array['teste-exclusao-dono@exemplo.invalid']
    and x.organization_slug = 'teste-exclusao-imob';
  r := r || jsonb_build_object('aviso_a_2_dias', v_int);
  r := r || jsonb_build_object('aviso_marcado', public.mark_organization_deletion_reminded(server_key, org));
  select count(*)::integer into v_int
  from public.list_organization_deletion_reminders(server_key, 50) x where x.organization_id = org;
  reset role;
  r := r || jsonb_build_object('aviso_depois_de_marcar', v_int);

  -- ---------------------------------------------------------------------------
  -- 4. Cancelar
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_manager, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.cancel_organization_deletion(org);
    reset role;
    v_text := 'ok';
  exception when others then
    reset role;
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('cancelar_gerente', v_text);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.cancel_organization_deletion(org);
  reset role;

  begin
    insert into public.leads (organization_id, name, phone, source, stage)
    values (org, 'Lead Depois De Cancelar', '11999990202', 'manual', 'new');
    v_text := 'ok';
  exception when others then
    v_text := sqlstate || ' ' || sqlerrm;
  end;
  r := r || jsonb_build_object('cancelado_escrita_volta', v_text, 'cancelado_estado', private.billing_state(org));

  -- Agenda de novo e vence o prazo.
  set local role authenticated;
  perform public.schedule_organization_deletion(org, 'teste-exclusao-imob');
  reset role;

  select jsonb_object_agg(x.action, x.n) into v_json
  from (
    select a.action, count(*) as n
    from public.audit_events a
    where a.organization_id = org and a.action in ('deletion_scheduled', 'deletion_canceled')
    group by a.action
  ) x;
  r := r || jsonb_build_object(
    'auditoria_acoes', v_json,
    'auditoria_sem_dado_pessoal', not exists (
      select 1 from public.audit_events a
      where a.organization_id = org
        and a.action in ('deletion_scheduled', 'deletion_canceled')
        and (a.metadata::text ilike '%exemplo.invalid%' or a.metadata::text ilike '%Imobiliaria Teste%')
    )
  );

  update private.organization_deletions
  set requested_at = now() - interval '31 days', execute_after = now() - interval '1 minute'
  where organization_id = org;

  -- ---------------------------------------------------------------------------
  -- 5. Executar
  -- ---------------------------------------------------------------------------
  arquivo_doc := org || '/clients/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf';
  insert into storage.objects (bucket_id, name, owner_id) values ('client-documents', arquivo_doc, u_owner::text);

  update public.billing_accounts set cancel_at_period_end = false where organization_id = org;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  v_json := private.execute_due_organization_deletions();
  r := r || jsonb_build_object(
    'executar_com_assinatura_renovando', v_json || jsonb_build_object(
      'last_error', (select d.last_error from private.organization_deletions d where d.organization_id = org),
      'imobiliaria_existe', exists (select 1 from public.organizations o where o.id = org)
    )
  );

  update public.billing_accounts set cancel_at_period_end = true where organization_id = org;

  r := r || jsonb_build_object('executar', private.execute_due_organization_deletions());
  r := r || jsonb_build_object(
    'executado_imobiliaria_apagada', not exists (select 1 from public.organizations o where o.id = org),
    'executado_cascata',
      not exists (select 1 from public.memberships m where m.organization_id = org)
      and not exists (select 1 from public.properties p where p.organization_id = org)
      and not exists (select 1 from public.leads l where l.organization_id = org)
      and not exists (select 1 from public.billing_accounts b where b.organization_id = org)
      and not exists (select 1 from private.organization_deletions d where d.organization_id = org),
    'executado_registro', exists (
      select 1 from private.organization_storage_purges pu
      where pu.organization_id = org and pu.finished_at is null
        and pu.requested_at < now() - interval '30 days'
    )
  );

  -- Arquivo de outra imobiliária (existente) para a política anon.
  arquivo_outro := gen_random_uuid() || '/clients/' || gen_random_uuid() || '/x.pdf';

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    set local role anon;
    perform public.claim_organization_storage_objects('chave-errada', 10);
    reset role;
    v_text := 'ok';
  exception when others then
    reset role;
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('storage_claim_chave_errada', v_text);

  set local role anon;
  select count(*)::integer into v_int
  from public.claim_organization_storage_objects(server_key, 1000) x
  where x.object_path like org || '/%';
  r := r || jsonb_build_object('storage_claim_reservou', v_int);

  execute 'select count(*)::integer from storage.objects where bucket_id = $1 and name = $2'
    into v_int using 'client-documents', arquivo_doc;
  r := r || jsonb_build_object('storage_politica_anon_reservado', v_int);
  reset role;

  insert into storage.objects (bucket_id, name, owner_id) values ('client-documents', arquivo_outro, u_owner::text);
  set local role anon;
  execute 'select count(*)::integer from storage.objects where bucket_id = $1 and name = $2'
    into v_int using 'client-documents', arquivo_outro;
  r := r || jsonb_build_object('storage_politica_anon_outro', v_int);

  r := r || jsonb_build_object('storage_settle_com_arquivo', public.settle_organization_storage_purge(server_key));
  reset role;

  update private.organization_storage_claims set expires_at = now() - interval '1 second' where organization_id = org;

  set local role anon;
  r := r || jsonb_build_object('storage_settle_reserva_vencida', public.settle_organization_storage_purge(server_key));
  reset role;

  -- ---------------------------------------------------------------------------
  -- 6. Excluir minha conta
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_solo, 'role', 'authenticated')::text, true);
  org_conta := public.create_organization('Imobiliaria Teste Conta', 'teste-exclusao-conta');

  update public.billing_accounts
  set limits = limits || '{"users": 20}'::jsonb
  where organization_id = org_conta;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org_conta, u_leaver, 'broker', true);

  update public.profiles
  set full_name = 'Pessoa Solo', phone = '11999990301', creci_number = '12345', creci_state = 'SP'
  where id = u_solo;

  insert into public.push_subscriptions (user_id, organization_id, endpoint, p256dh, auth_secret)
  values (u_leaver, org_conta, 'https://push.exemplo.invalid/' || gen_random_uuid(), repeat('a', 87), repeat('b', 22));
  insert into public.email_preferences (user_id) values (u_leaver);
  insert into public.lead_routing_members (organization_id, user_id) values (org_conta, u_leaver);

  begin
    set local role authenticated;
    perform public.delete_my_account('outro@exemplo.invalid');
    reset role;
    v_text := 'ok';
  exception when others then
    reset role;
    v_text := sqlstate;
  end;
  r := r || jsonb_build_object('conta_confirmacao_errada', v_text);

  begin
    set local role authenticated;
    perform public.delete_my_account('TESTE-EXCLUSAO-SOLO@exemplo.invalid ');
    reset role;
    v_text := 'ok';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    reset role;
    v_text := sqlstate || ' ' || coalesce(v_hint, '');
  end;

  set local role authenticated;
  select count(*)::integer into v_int from public.get_my_account_deletion_blockers();
  reset role;
  r := r || jsonb_build_object('conta_unico_dono', v_text, 'conta_bloqueios', v_int);

  insert into public.memberships (organization_id, user_id, role, active)
  values (org_conta, u_coowner, 'owner', true);

  set local role authenticated;
  r := r || jsonb_build_object('conta_excluida_retorno', public.delete_my_account('teste-exclusao-solo@exemplo.invalid'));
  reset role;

  r := r || jsonb_build_object(
    'conta_perfil_anonimizado', exists (
      select 1 from public.profiles p
      where p.id = u_solo and p.full_name = 'Usuário removido' and p.email is null and p.phone is null
        and p.creci_number is null and p.creci_state is null and p.avatar_url is null
    ),
    'conta_sem_acesso', not exists (select 1 from public.memberships m where m.user_id = u_solo and m.active),
    'conta_imobiliaria_continua_com_dono', exists (
      select 1 from public.memberships m
      where m.organization_id = org_conta and m.user_id = u_coowner and m.role = 'owner' and m.active
    )
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_leaver, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.delete_my_account('teste-exclusao-saindo@exemplo.invalid');
  reset role;

  r := r || jsonb_build_object(
    'conta_dados_pessoais_apagados',
      not exists (select 1 from public.push_subscriptions s where s.user_id = u_leaver)
      and not exists (select 1 from public.email_preferences e where e.user_id = u_leaver)
      and not exists (select 1 from public.lead_routing_members lr where lr.user_id = u_leaver),
    'conta_corretor_excluida', not exists (select 1 from public.memberships m where m.user_id = u_leaver and m.active),
    'cron_agendado', exists (select 1 from cron.job j where j.jobname = 'imobiliaria-exclusao-diaria')
  );

  raise exception 'TESTE DA EXCLUSÃO DE IMOBILIÁRIA E DE CONTA (rollback): %', jsonb_pretty(r);
end;
$$;
