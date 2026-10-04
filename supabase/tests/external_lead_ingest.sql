-- =============================================================================
-- Teste da entrada de leads das origens externas (Canal Pro e Meta Lead Ads)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo garantido:
--   * sem a chave do servidor, nenhuma RPC de entrada escreve nada (42501);
--   * token do webhook errado devolve "unknown_account" e não vaza se a
--     imobiliária existe;
--   * lead do Canal Pro vira lead com source 'portal', casa com o imóvel pelo
--     ListingID (= properties.code) e entra no rodízio quando ele está ligado;
--   * a MESMA entrega reenviada não cria um segundo lead (idempotência);
--   * a MESMA PESSOA chegando por OUTRA origem nas últimas 24 h não cria um
--     segundo lead: a entrega fica marcada como duplicada e aponta o lead
--     original (é o caso "o mesmo lead chega por dois portais");
--   * entrega sem nome e entrega sem contato são recusadas com motivo, sem
--     derrubar a requisição;
--   * lead da Meta vira lead com source 'social';
--   * desconectar apaga a credencial do Vault de verdade, e apagar a
--     imobiliária leva a credencial junto (gatilho, sem segredo órfão);
--   * membro de outra imobiliária não enxerga integração nem entrega alheia.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   sem_chave_recusa               : "42501"
--   token_errado                   : "unknown_account"
--   canalpro_status                : "accepted"
--   canalpro_source                : "portal"
--   canalpro_imovel                : "casado"
--   canalpro_responsavel           : "roleta"
--   reentrega_status               : "duplicate"
--   reentrega_nao_duplicou_lead    : 1
--   mesma_pessoa_outro_portal      : "duplicate"
--   mesma_pessoa_aponta_o_lead     : "mesmo"
--   sem_nome_status                : "rejected"
--   sem_nome_motivo                : "sem_nome"
--   sem_contato_motivo             : "sem_contato"
--   meta_status                    : "accepted"
--   meta_source                    : "social"
--   credencial_lida_pelo_servidor  : "ok"
--   desconectar_apaga_segredo      : "apagado"
--   outra_imobiliaria_ve_integracao: 0
--   outra_imobiliaria_ve_entrega   : 0
--   apagar_imobiliaria_apaga_segredo: "apagado"

do $$
declare
  r jsonb := '{}'::jsonb;
  ingest_key text;
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_alheio uuid := gen_random_uuid();
  org uuid;
  org_alheia uuid;
  prop uuid;
  prop_code text;
  token text;
  secret_id uuid;
  lead_id uuid;
  v_text text;
  v_int integer;
  v_json jsonb;
begin
  select ds.decrypted_secret into ingest_key
  from vault.decrypted_secrets ds
  where ds.name = 'lead_ingest_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-ingest-dono@exemplo.invalid', now(), now(), now()),
    (u_broker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-ingest-corretor@exemplo.invalid', now(), now(), now()),
    (u_alheio, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-ingest-alheio@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Ingest', 'teste-ingest-leads');

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_broker, 'broker', true);

  -- O código do anúncio é gerado pelo banco (IMV-000001…) e é justamente ele
  -- que vai no <ListingID> do feed VRSync.
  insert into public.properties (organization_id, title, purpose, type, status)
  values (org, 'Apartamento de teste', 'sale', 'apartment', 'draft')
  returning id, code into prop, prop_code;

  -- ---------------------------------------------------------------------------
  -- 1. Sem a chave do servidor: nada entra
  -- ---------------------------------------------------------------------------
  begin
    perform public.ingest_webhook_lead('chave-errada', repeat('a', 48),
      jsonb_build_object('event_id', 'x', 'name', 'Fulano', 'phone', '11988887777'));
    r := r || jsonb_build_object('sem_chave_recusa', 'passou');
  exception when insufficient_privilege then
    r := r || jsonb_build_object('sem_chave_recusa', '42501');
  end;

  -- ---------------------------------------------------------------------------
  -- 2. Token do webhook errado: resposta neutra
  -- ---------------------------------------------------------------------------
  v_json := public.ingest_webhook_lead(ingest_key, repeat('f', 48),
    jsonb_build_object('event_id', 'x', 'name', 'Fulano', 'phone', '11988887777'));
  r := r || jsonb_build_object('token_errado', v_json ->> 'status');

  -- ---------------------------------------------------------------------------
  -- 3. Canal Pro conectado, rodízio ligado com um corretor de plantão
  -- ---------------------------------------------------------------------------
  token := public.enable_lead_webhook(org, 'canal_pro', false, 'Imobiliaria Teste');

  insert into public.lead_routing_settings (organization_id, roulette_enabled, sla_minutes)
  values (org, true, 5);
  insert into public.lead_routing_members (organization_id, user_id) values (org, u_broker);

  v_json := public.ingest_webhook_lead(ingest_key, token, jsonb_build_object(
    'event_id', '59ee0fc6e4b043e1b2a6d863',
    'name', 'Maria Compradora',
    'email', 'maria@exemplo.invalid',
    'phone', '11988887777',
    'message', 'Tenho interesse neste imovel.',
    'interest', 'buy',
    'listing_code', lower(prop_code),
    'origin', 'zapimoveis',
    'occurred_at', (now() - interval '2 minutes')::text,
    'utm', jsonb_build_object('source', 'zapimoveis', 'medium', 'portal')
  ));
  r := r || jsonb_build_object('canalpro_status', v_json ->> 'status');
  lead_id := (v_json ->> 'lead_id')::uuid;

  select l.source::text into v_text from public.leads l where l.id = lead_id;
  r := r || jsonb_build_object('canalpro_source', v_text);

  select case when l.property_id = prop then 'casado' else 'solto' end into v_text
  from public.leads l where l.id = lead_id;
  r := r || jsonb_build_object('canalpro_imovel', v_text);

  select case when l.assigned_to = u_broker then 'roleta' else 'sem' end into v_text
  from public.leads l where l.id = lead_id;
  r := r || jsonb_build_object('canalpro_responsavel', v_text);

  -- ---------------------------------------------------------------------------
  -- 4. Reentrega da MESMA entrega (o Grupo OLX repete até 3 vezes)
  -- ---------------------------------------------------------------------------
  v_json := public.ingest_webhook_lead(ingest_key, token, jsonb_build_object(
    'event_id', '59ee0fc6e4b043e1b2a6d863',
    'name', 'Maria Compradora',
    'phone', '11988887777'
  ));
  r := r || jsonb_build_object('reentrega_status', v_json ->> 'status');

  select count(*) into v_int
  from public.leads l
  where l.organization_id = org and l.phone = '11988887777';
  r := r || jsonb_build_object('reentrega_nao_duplicou_lead', v_int);

  -- ---------------------------------------------------------------------------
  -- 5. A MESMA PESSOA chegando por OUTRO portal (mesmo telefone, outro evento)
  -- ---------------------------------------------------------------------------
  v_json := public.ingest_webhook_lead(ingest_key, token, jsonb_build_object(
    'event_id', 'outro-portal-0001',
    'name', 'Maria C.',
    'phone', '+55 (11) 98888-7777',
    'origin', 'vivareal'
  ));
  r := r || jsonb_build_object('mesma_pessoa_outro_portal', v_json ->> 'status');
  r := r || jsonb_build_object(
    'mesma_pessoa_aponta_o_lead',
    case when (v_json ->> 'lead_id')::uuid = lead_id then 'mesmo' else 'outro' end
  );

  -- ---------------------------------------------------------------------------
  -- 6. Entregas recusadas: sem nome e sem contato
  -- ---------------------------------------------------------------------------
  v_json := public.ingest_webhook_lead(ingest_key, token,
    jsonb_build_object('event_id', 'sem-nome-1', 'phone', '11977776666'));
  r := r || jsonb_build_object('sem_nome_status', v_json ->> 'status');
  r := r || jsonb_build_object('sem_nome_motivo', v_json ->> 'reason');

  v_json := public.ingest_webhook_lead(ingest_key, token,
    jsonb_build_object('event_id', 'sem-contato-1', 'name', 'Joao Sem Contato'));
  r := r || jsonb_build_object('sem_contato_motivo', v_json ->> 'reason');

  -- ---------------------------------------------------------------------------
  -- 7. Meta Lead Ads: conta do cliente com credencial no Vault
  -- ---------------------------------------------------------------------------
  perform public.connect_lead_integration(
    org, 'meta_lead_ads', '1234567890', 'EAABtokenDeTesteLongoSuficiente', 'Pagina da Imobiliaria'
  );

  v_json := public.register_lead_delivery(
    ingest_key, 'meta_lead_ads', '1234567890', '9988776655', now(), 'facebook'
  );

  v_json := public.ingest_external_lead(ingest_key, org, 'meta_lead_ads', jsonb_build_object(
    'event_id', '9988776655',
    'name', 'Carlos Instagram',
    'email', 'carlos@exemplo.invalid',
    'origin', 'facebook',
    'utm', jsonb_build_object('source', 'facebook', 'medium', 'lead_ads')
  ));
  r := r || jsonb_build_object('meta_status', v_json ->> 'status');

  select l.source::text into v_text from public.leads l where l.id = (v_json ->> 'lead_id')::uuid;
  r := r || jsonb_build_object('meta_source', v_text);

  -- ---------------------------------------------------------------------------
  -- 8. A credencial sai só pela RPC do servidor
  -- ---------------------------------------------------------------------------
  select case when public.read_lead_integration_secret(ingest_key, org, 'meta_lead_ads')
                    = 'EAABtokenDeTesteLongoSuficiente'
              then 'ok' else 'divergente' end
    into v_text;
  r := r || jsonb_build_object('credencial_lida_pelo_servidor', v_text);

  select li.secret_id into secret_id
  from public.lead_integrations li
  where li.organization_id = org and li.provider = 'meta_lead_ads';

  perform public.disconnect_lead_integration(org, 'meta_lead_ads');

  select case when exists (select 1 from vault.secrets s where s.id = secret_id)
              then 'continua' else 'apagado' end
    into v_text;
  r := r || jsonb_build_object('desconectar_apaga_segredo', v_text);

  -- ---------------------------------------------------------------------------
  -- 9. Isolamento: outra imobiliária não vê nada disto
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_alheio, 'role', 'authenticated')::text, true);
  org_alheia := public.create_organization('Outra Imobiliaria', 'teste-ingest-alheia');

  set local role authenticated;

  select count(*) into v_int from public.lead_integrations li where li.organization_id = org;
  r := r || jsonb_build_object('outra_imobiliaria_ve_integracao', v_int);

  select count(*) into v_int
  from public.lead_integration_deliveries del where del.organization_id = org;
  r := r || jsonb_build_object('outra_imobiliaria_ve_entrega', v_int);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 10. Apagar a imobiliária leva a credencial do cliente junto (gatilho
  --     lead_integrations_drop_secret), sem deixar segredo órfão no Vault
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  perform public.connect_lead_integration(
    org, 'meta_lead_ads', '5550001111', 'EAAoutroTokenDeTesteLongo', 'Pagina de novo'
  );

  select li.secret_id into secret_id
  from public.lead_integrations li
  where li.organization_id = org and li.provider = 'meta_lead_ads';

  delete from public.organizations o where o.id = org;

  select case when exists (select 1 from vault.secrets s where s.id = secret_id)
              then 'continua' else 'apagado' end
    into v_text;
  r := r || jsonb_build_object('apagar_imobiliaria_apaga_segredo', v_text);

  raise exception 'RESULTADO %', jsonb_pretty(r);
end;
$$;
