-- =============================================================================
-- Teste de contas conectadas, consentimento com prova e canal de WhatsApp
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- Resultado esperado:
--   b_le_conexao_de_a              : 0
--   b_le_canal_de_a                : 0
--   b_le_conversa_de_a             : 0
--   b_le_mensagem_de_a             : 0
--   b_le_supressao_de_a            : 0
--   b_le_consentimento_de_a        : 0
--   b_le_aceite_de_a               : 0
--   a_le_a_propria_conexao         : 1
--   credencial_pela_api            : "NEGADO:42501"
--   sessao_insere_conexao          : "NEGADO:42501"
--   sessao_insere_mensagem         : "NEGADO:42501"
--   sessao_insere_supressao        : "NEGADO:42501"
--   sessao_insere_consentimento    : "NEGADO:42501"
--   sessao_apaga_supressao         : "NEGADO:42501"
--   sessao_edita_consentimento     : "NEGADO:42501"
--   credencial_sem_chave           : "NEGADO:42501"
--   conectar_sem_aceite            : "aceite_dos_termos_ausente"
--   conectar_com_nonce_repetido    : "NEGADO:42501"
--   waba_de_a_em_b                 : "conta_ja_conectada_em_outra_imobiliaria"
--   numero_de_a_em_b               : "numero_ja_conectado_em_outra_imobiliaria"
--   importacao_consente_divulgacao : "NEGADO:23514"
--   texto_livre_na_janela          : true
--   texto_livre_fora_da_janela     : "janela_de_24h_fechada"
--   marketing_sem_consentimento    : "sem_consentimento_de_divulgacao"
--   marketing_com_consentimento    : true
--   marketing_apos_supressao       : "contato_na_lista_de_supressao"
--   soltar_sem_consentimento_novo  : "sem_consentimento_posterior_a_supressao"
--   soltar_com_consentimento_novo  : true
--   conexao_desligada_bloqueia     : "conexao_desligada"
--   bloqueio_da_plataforma_trava   : "42501"
--   qualidade_red_suspende         : true
--   qualidade_red_bloqueia_envio   : "numero_suspenso_por_qualidade"
--   qualidade_green_libera         : false
--   erro_131050_suprime            : true
--   erro_131050_revoga_consent     : "revoked"
--   erro_132015_descarta           : "discarded"
--   webhook_atrasado_nao_volta     : "delivered"
--   entrega_repetida_e_idempotente : true
--   grant_connect_anon             : true
--   grant_connect_authenticated    : false
--   grant_queue_authenticated      : true

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  org_a uuid;
  org_b uuid;
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  terms_a uuid;
  terms_b uuid;
  conn_a uuid;
  chan_a uuid;
  conv_a uuid;
  msg_a uuid;
  sup_a uuid;
  res jsonb;
  n integer;
  txt text;
  contato constant text := '5511988887777';
  wamid_in constant text := 'wamid.TESTE.IN.0001';
  wamid_out constant text := 'wamid.TESTE.OUT.0001';
begin
  -- ---------------------------------------------------------------------------
  -- 1. Duas imobiliárias, dois donos
  -- ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (u_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-conexoes-a@exemplo.invalid', now(), now()),
    (u_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-conexoes-b@exemplo.invalid', now(), now());

  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'connections_server_key';

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  org_a := public.create_organization('Imobiliaria Teste Conexoes A', 'teste-conexoes-a');

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  org_b := public.create_organization('Imobiliaria Teste Conexoes B', 'teste-conexoes-b');

  -- ---------------------------------------------------------------------------
  -- 2. Aceite dos termos e conexão da conta de A
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_a, 'role', 'authenticated')::text, true);

  terms_a := public.accept_connection_terms(
    org_a, 'whatsapp', 'meta_whatsapp_business_terms', '2026-09-16',
    'https://www.whatsapp.com/legal/meta-terms-whatsapp-business',
    'Declaro que a conta do WhatsApp Business pertence a esta imobiliaria e que a Meta cobra o envio diretamente dela.',
    null, 'teste', '{}'::jsonb
  );

  -- Conectar sem aceite é recusado (Tech Provider Terms §2.1).
  begin
    res := public.connect_connection_account(
      key, 'nonce-teste-sem-aceite-0000001', org_a, 'whatsapp', '900000000000001',
      '800000000000001', 'Teste', null, '{}', 'TOKEN-TESTE-A', null, '{}'::jsonb, u_a, null
    );
    r := r || jsonb_build_object('conectar_sem_aceite', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('conectar_sem_aceite', sqlerrm);
  end;

  res := public.connect_connection_account(
    key, 'nonce-teste-conexao-a-00000001', org_a, 'whatsapp', '900000000000001',
    '800000000000001', 'Imobiliaria A', null, array['whatsapp_business_messaging'],
    'TOKEN-TESTE-A', null, '{}'::jsonb, u_a, terms_a
  );
  conn_a := (res ->> 'connected_account_id')::uuid;

  -- Nonce já usado não serve de novo.
  begin
    res := public.connect_connection_account(
      key, 'nonce-teste-conexao-a-00000001', org_a, 'whatsapp', '900000000000001',
      '800000000000001', 'Imobiliaria A', null, '{}', 'TOKEN-TESTE-A', null, '{}'::jsonb, u_a, terms_a
    );
    r := r || jsonb_build_object('conectar_com_nonce_repetido', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('conectar_com_nonce_repetido', 'NEGADO:' || sqlstate);
  end;

  res := public.register_whatsapp_channel(
    key, 'nonce-teste-canal-a-000000001', org_a, conn_a,
    '900000000000001', '700000000000001', '5511999998888', 'Imobiliaria A'
  );
  chan_a := (res ->> 'channel_id')::uuid;

  -- ---------------------------------------------------------------------------
  -- 3. A mesma conta da Meta em outra imobiliária é recusada
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b, 'role', 'authenticated')::text, true);

  terms_b := public.accept_connection_terms(
    org_b, 'whatsapp', 'meta_whatsapp_business_terms', '2026-09-16',
    'https://www.whatsapp.com/legal/meta-terms-whatsapp-business',
    'Declaro que a conta do WhatsApp Business pertence a esta imobiliaria e que a Meta cobra o envio diretamente dela.',
    null, 'teste', '{}'::jsonb
  );

  begin
    res := public.connect_connection_account(
      key, 'nonce-teste-conexao-b-00000001', org_b, 'whatsapp', '900000000000001',
      '800000000000001', 'Imobiliaria B', null, '{}', 'TOKEN-TESTE-B', null, '{}'::jsonb, u_b, terms_b
    );
    r := r || jsonb_build_object('waba_de_a_em_b', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('waba_de_a_em_b', sqlerrm);
  end;

  -- Conta própria de B, para poder testar o número repetido.
  res := public.connect_connection_account(
    key, 'nonce-teste-conexao-b-00000002', org_b, 'whatsapp', '900000000000002',
    '800000000000002', 'Imobiliaria B', null, '{}', 'TOKEN-TESTE-B', null, '{}'::jsonb, u_b, terms_b
  );

  begin
    res := public.register_whatsapp_channel(
      key, 'nonce-teste-canal-b-000000001', org_b,
      (res ->> 'connected_account_id')::uuid,
      '900000000000002', '700000000000001', '5511999998888', 'Imobiliaria B'
    );
    r := r || jsonb_build_object('numero_de_a_em_b', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('numero_de_a_em_b', sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 4. Uma conversa e uma mensagem recebida em A
  -- ---------------------------------------------------------------------------
  res := public.ingest_whatsapp_message(
    key, '700000000000001', wamid_in, contato, 'Contato Teste',
    'Ainda esta disponivel?', '[]'::jsonb, now()
  );
  conv_a := (res ->> 'conversation_id')::uuid;

  -- Reentrega do mesmo webhook não duplica.
  res := public.ingest_whatsapp_message(
    key, '700000000000001', wamid_in, contato, 'Contato Teste',
    'Ainda esta disponivel?', '[]'::jsonb, now()
  );
  r := r || jsonb_build_object('entrega_repetida_e_idempotente', (res ->> 'duplicate')::boolean);

  -- ---------------------------------------------------------------------------
  -- 5. Isolamento: B não enxerga nada de A
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b, 'role', 'authenticated')::text, true);

  set local role authenticated;

  execute 'select count(*) from public.connected_accounts where organization_id = $1'
    into n using org_a;
  r := r || jsonb_build_object('b_le_conexao_de_a', n);

  execute 'select count(*) from public.whatsapp_channels where organization_id = $1'
    into n using org_a;
  r := r || jsonb_build_object('b_le_canal_de_a', n);

  execute 'select count(*) from public.whatsapp_conversations where organization_id = $1'
    into n using org_a;
  r := r || jsonb_build_object('b_le_conversa_de_a', n);

  execute 'select count(*) from public.whatsapp_messages where organization_id = $1'
    into n using org_a;
  r := r || jsonb_build_object('b_le_mensagem_de_a', n);

  execute 'select count(*) from public.connection_terms_acceptances where organization_id = $1'
    into n using org_a;
  r := r || jsonb_build_object('b_le_aceite_de_a', n);

  reset role;

  -- A enxerga a conexão dela.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*) from public.connected_accounts where organization_id = $1'
    into n using org_a;
  r := r || jsonb_build_object('a_le_a_propria_conexao', n);

  -- A credencial não sai pela API nem para o dono: a coluna está fora do grant.
  begin
    execute 'select credential_secret_id from public.connected_accounts where id = $1' using conn_a;
    r := r || jsonb_build_object('credencial_pela_api', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('credencial_pela_api', 'NEGADO:' || sqlstate);
  end;

  -- Nenhuma escrita direta com sessão.
  begin
    execute 'insert into public.connected_accounts (organization_id, provider, external_account_id)
             values ($1, ''whatsapp'', ''999999999999999'')' using org_a;
    r := r || jsonb_build_object('sessao_insere_conexao', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('sessao_insere_conexao', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'insert into public.whatsapp_messages
               (organization_id, conversation_id, direction, status, body)
             values ($1, $2, ''outbound'', ''delivered'', ''passei por fora'')'
      using org_a, conv_a;
    r := r || jsonb_build_object('sessao_insere_mensagem', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('sessao_insere_mensagem', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'insert into public.whatsapp_suppressions
               (organization_id, contact_wa_id, scope, source)
             values ($1, $2, ''marketing'', ''manual'')' using org_a, contato;
    r := r || jsonb_build_object('sessao_insere_supressao', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('sessao_insere_supressao', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'insert into public.consent_records
               (organization_id, action, purpose, channel, source, subject_address,
                disclosure_text, disclosure_sha256, policy_version)
             values ($1, ''granted'', ''divulgacao'', ''whatsapp'', ''formulario_site'', $2,
                     ''texto qualquer com mais de vinte caracteres'', repeat(''a'', 64), ''x'')'
      using org_a, contato;
    r := r || jsonb_build_object('sessao_insere_consentimento', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('sessao_insere_consentimento', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'delete from public.whatsapp_suppressions where organization_id = $1' using org_a;
    r := r || jsonb_build_object('sessao_apaga_supressao', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('sessao_apaga_supressao', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'update public.consent_records set action = ''granted'' where organization_id = $1'
      using org_a;
    r := r || jsonb_build_object('sessao_edita_consentimento', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('sessao_edita_consentimento', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 6. Credencial sem a chave do servidor
  -- ---------------------------------------------------------------------------
  begin
    res := public.get_connection_credential('chave-errada', conn_a);
    r := r || jsonb_build_object('credencial_sem_chave', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('credencial_sem_chave', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 7. Consentimento: origem sem prova não autoriza divulgação
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_a, 'role', 'authenticated')::text, true);

  begin
    perform public.record_consent(
      org_a, 'granted', 'divulgacao', 'whatsapp', 'importacao', contato,
      'Texto qualquer com mais de vinte caracteres para passar no tamanho minimo.',
      '2026-09-16'
    );
    r := r || jsonb_build_object('importacao_consente_divulgacao', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('importacao_consente_divulgacao', 'NEGADO:' || sqlstate);
  end;

  -- ---------------------------------------------------------------------------
  -- 8. Envio: janela, consentimento e supressão
  -- ---------------------------------------------------------------------------
  res := public.queue_whatsapp_message(conv_a, 'Oi, tudo bem?', null, false);
  r := r || jsonb_build_object('texto_livre_na_janela', (res ->> 'ok')::boolean);
  msg_a := (res ->> 'message_id')::uuid;

  -- Marketing sem consentimento não sai, mesmo dentro da janela.
  res := public.queue_whatsapp_message(conv_a, null, 'oferta_lancamento', true);
  r := r || jsonb_build_object('marketing_sem_consentimento', res ->> 'reason');

  perform public.record_consent(
    org_a, 'granted', 'divulgacao', 'whatsapp', 'formulario_site', contato,
    'Autorizo receber ofertas e lancamentos da Imobiliaria Teste pelo WhatsApp. Posso revogar quando quiser.',
    '2026-09-16'
  );

  res := public.queue_whatsapp_message(conv_a, null, 'oferta_lancamento', true);
  r := r || jsonb_build_object('marketing_com_consentimento', (res ->> 'ok')::boolean);

  -- Supressão manual barra a divulgação mesmo com consentimento registrado.
  sup_a := public.add_whatsapp_suppression(org_a, contato, 'marketing', 'Pediu para parar no atendimento.');
  res := public.queue_whatsapp_message(conv_a, null, 'oferta_lancamento', true);
  r := r || jsonb_build_object('marketing_apos_supressao', res ->> 'reason');

  -- Sair da lista exige consentimento NOVO, posterior à supressão.
  begin
    res := public.release_whatsapp_suppression(sup_a, 'tentando contornar');
    r := r || jsonb_build_object('soltar_sem_consentimento_novo', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('soltar_sem_consentimento_novo', sqlerrm);
  end;

  perform public.record_consent(
    org_a, 'granted', 'divulgacao', 'whatsapp', 'whatsapp_opt_in', contato,
    'O contato pediu, por escrito no WhatsApp, para voltar a receber ofertas da Imobiliaria Teste.',
    '2026-09-16'
  );
  res := public.release_whatsapp_suppression(sup_a, 'Consentimento novo registrado.');
  r := r || jsonb_build_object('soltar_com_consentimento_novo', (res ->> 'released')::boolean);

  -- Fora da janela de 24 h, texto livre não sai.
  update public.whatsapp_conversations
  set last_inbound_at = now() - interval '25 hours'
  where id = conv_a;

  res := public.queue_whatsapp_message(conv_a, 'Oi de novo', null, false);
  r := r || jsonb_build_object('texto_livre_fora_da_janela', res ->> 'reason');

  update public.whatsapp_conversations set last_inbound_at = now() where id = conv_a;

  -- ---------------------------------------------------------------------------
  -- 9. Interruptores: imobiliária e plataforma
  -- ---------------------------------------------------------------------------
  perform public.set_connection_enabled(conn_a, false);
  res := public.queue_whatsapp_message(conv_a, 'Vai sair?', null, false);
  r := r || jsonb_build_object('conexao_desligada_bloqueia', res ->> 'reason');
  perform public.set_connection_enabled(conn_a, true);

  perform public.set_connection_platform_block(key, conn_a, true, 'Teste de sobrevivencia.');
  begin
    perform public.set_connection_enabled(conn_a, true);
    r := r || jsonb_build_object('bloqueio_da_plataforma_trava', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('bloqueio_da_plataforma_trava', sqlstate);
  end;
  perform public.set_connection_platform_block(key, conn_a, false, null);

  -- ---------------------------------------------------------------------------
  -- 10. Qualidade do número
  -- ---------------------------------------------------------------------------
  res := public.sync_whatsapp_channel_health(key, '700000000000001', 'RED', 'TIER_250', 80, null);
  r := r || jsonb_build_object('qualidade_red_suspende', (res ->> 'auto_suspended')::boolean);

  res := public.queue_whatsapp_message(conv_a, 'Vai sair?', null, false);
  r := r || jsonb_build_object('qualidade_red_bloqueia_envio', res ->> 'reason');

  -- O webhook de qualidade identifica o número pelo NÚMERO EXIBIDO.
  res := public.sync_whatsapp_channel_health(key, null, 'GREEN', null, null, '+55 11 99999-8888');
  r := r || jsonb_build_object('qualidade_green_libera', (res ->> 'auto_suspended')::boolean);

  -- ---------------------------------------------------------------------------
  -- 11. Estado da mensagem: 131050, 132015 e webhook atrasado
  -- ---------------------------------------------------------------------------
  perform public.mark_whatsapp_message_sent(key, msg_a, wamid_out, null, null, null);

  perform public.update_whatsapp_message_status(
    key, '700000000000001', wamid_out, 'delivered', null, null, 'service', 'regular', now()
  );
  -- Webhook de `sent` chegando DEPOIS do `delivered` não pode voltar atrás.
  perform public.update_whatsapp_message_status(
    key, '700000000000001', wamid_out, 'sent', null, null, null, null, now()
  );
  select m.status::text into txt from public.whatsapp_messages m where m.id = msg_a;
  r := r || jsonb_build_object('webhook_atrasado_nao_volta', txt);

  -- 132015: a Meta descartou a mensagem retida; não volta para a fila.
  update public.whatsapp_messages set status = 'held', wamid = 'wamid.TESTE.HELD'
  where id = msg_a;
  perform public.update_whatsapp_message_status(
    key, '700000000000001', 'wamid.TESTE.HELD', 'failed', 132015, 'Template is paused', null, null, now()
  );
  select m.status::text into txt from public.whatsapp_messages m where m.id = msg_a;
  r := r || jsonb_build_object('erro_132015_descarta', txt);

  -- 131050: o contato desligou a divulgação. Supressão + revogação com prova.
  update public.whatsapp_messages set status = 'accepted', wamid = 'wamid.TESTE.131050'
  where id = msg_a;
  res := public.update_whatsapp_message_status(
    key, '700000000000001', 'wamid.TESTE.131050', 'failed', 131050,
    'Unable to deliver the message', null, null, now()
  );
  r := r || jsonb_build_object('erro_131050_suprime', (res ->> 'suppressed')::boolean);

  select cr.action::text into txt
  from public.consent_records cr
  where cr.organization_id = org_a
    and cr.channel = 'whatsapp'
    and cr.subject_address = contato
    and cr.purpose = 'divulgacao'
  order by cr.collected_at desc, cr.id desc
  limit 1;
  r := r || jsonb_build_object('erro_131050_revoga_consent', txt);

  -- ---------------------------------------------------------------------------
  -- 12. Isolamento do que foi criado depois (supressão e consentimento)
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*) from public.whatsapp_suppressions where organization_id = $1'
    into n using org_a;
  r := r || jsonb_build_object('b_le_supressao_de_a', n);

  execute 'select count(*) from public.consent_records where organization_id = $1'
    into n using org_a;
  r := r || jsonb_build_object('b_le_consentimento_de_a', n);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 13. Grants das RPCs
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object('grant_connect_anon', has_function_privilege(
    'anon',
    'public.connect_connection_account(text, text, uuid, public.connection_provider, text, text, text, text, text[], text, timestamptz, jsonb, uuid, uuid)',
    'execute'));

  r := r || jsonb_build_object('grant_connect_authenticated', has_function_privilege(
    'authenticated',
    'public.connect_connection_account(text, text, uuid, public.connection_provider, text, text, text, text, text[], text, timestamptz, jsonb, uuid, uuid)',
    'execute'));

  r := r || jsonb_build_object('grant_queue_authenticated', has_function_privilege(
    'authenticated', 'public.queue_whatsapp_message(uuid, text, text, boolean)', 'execute'));

  raise exception using errcode = 'P0001', message = jsonb_pretty(r);
end;
$$;
