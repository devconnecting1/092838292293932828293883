-- =============================================================================
-- Teste do adicional "+10 imóveis com foto" (migração billing_owned_listing_packs)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--   · sync_billing_account grava owned_listing_packs, addon_keys e o limite
--     somado (Imobiliária 20 + 1 pacote = 30), como o webhook envia;
--   · o gatilho de fotos deixa passar o 21º ao 30º imóvel com foto e barra o
--     31º com limite 30 (os pacotes contam no limite);
--   · tirar o pacote volta o limite a 20 sem apagar nada (os 30 continuam);
--   · quantidade inválida (1001, negativa, texto, fracionada) é recusada;
--   · get_billing_overview devolve a quantidade de pacotes ao membro;
--   · membros leem a coluna nova (grant por coluna), anon não.
--
-- Resultado esperado:
--   pacotes_gravados        : 1
--   addon_keys              : ["owned_listings"]
--   limite_gravado          : 30
--   fotos_ate_30            : 30
--   imovel_31_com_pacote    : "limite_owned_listings {"limit": 30, "usage": 30}"
--   overview_pacotes        : 1
--   sem_pacote_limite       : 20
--   sem_pacote_imovel_31    : "limite_owned_listings {"limit": 20, "usage": 30}"
--   nada_apagado            : 30
--   pacotes_1001            : "RECUSADO:22023"
--   pacotes_negativo        : "RECUSADO:22023"
--   pacotes_texto           : "RECUSADO:22023"
--   pacotes_fracionado      : "RECUSADO:22023"
--   grant_membros           : true
--   grant_anon              : false

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  org uuid;
  imovel uuid;
  v_key text;
  v_customer text := 'cus_TestePacotes' || substr(md5(gen_random_uuid()::text), 1, 10);
  v_base jsonb;
  v_count integer := 0;
  v_state text;
  v_detail text;
  i integer;
begin
  select s.decrypted_secret into v_key
  from vault.decrypted_secrets s
  where s.name = 'billing_server_key';

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'teste-pacotes-dono@exemplo.invalid', now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  org := public.create_organization('Imobiliaria Teste Pacotes', 'teste-pacotes-imoveis');

  -- Payload como o webhook monta (subscriptionBillingFields): Imobiliária mensal,
  -- 1 pacote, limite de imóveis já somado pelo servidor.
  v_base := jsonb_build_object(
    'stripe_customer_id', v_customer,
    'stripe_subscription_id', 'sub_TestePacotes' || substr(md5(gen_random_uuid()::text), 1, 10),
    'plan_key', 'imobiliaria',
    'billing_interval', 'month',
    'status', 'active',
    'seats', 3,
    'current_period_end', to_jsonb(now() + interval '20 days'),
    'cancel_at_period_end', false
  );

  perform public.sync_billing_account(v_key, org, v_base || jsonb_build_object(
    'owned_listing_packs', 1,
    'addon_keys', jsonb_build_array('owned_listings'),
    'limits', jsonb_build_object('users', 3, 'landing_pages', 1, 'owned_listings', 30,
      'photos_per_listing', 10, 'pipelines', 3, 'ai_conversations', 50)
  ));

  select b.owned_listing_packs, to_jsonb(b.addon_keys), (b.limits ->> 'owned_listings')::integer
  into i, v_base, v_count
  from public.billing_accounts b
  where b.organization_id = org;

  r := r || jsonb_build_object('pacotes_gravados', i, 'addon_keys', v_base,
    'limite_gravado', v_count);

  -- 30 imóveis com uma foto cada: todos passam pelo gatilho (20 do plano + 10).
  v_count := 0;
  for i in 1..31 loop
    insert into public.properties (organization_id, title, purpose, type)
    values (org, 'Imovel pacote ' || i, 'sale', 'apartment')
    returning id into imovel;

    begin
      insert into public.property_media (organization_id, property_id, kind, storage_path, position)
      values (org, imovel, 'image', org::text || '/properties/' || imovel::text || '/f1.webp', 1);
      v_count := v_count + 1;
    exception when others then
      get stacked diagnostics v_state = message_text, v_detail = pg_exception_detail;
      r := r || jsonb_build_object('imovel_31_com_pacote', v_state || ' ' || coalesce(v_detail, ''));
    end;
  end loop;

  r := r || jsonb_build_object('fotos_ate_30', v_count);

  begin
    set local role authenticated;
    r := r || jsonb_build_object('overview_pacotes',
      public.get_billing_overview(org) -> 'owned_listing_packs');
    reset role;
  exception when others then
    reset role;
    r := r || jsonb_build_object('overview_pacotes', 'NEGADO:' || sqlstate);
  end;

  -- Remoção do pacote (fim do ciclo): o limite volta a 20 e nada é apagado.
  perform public.sync_billing_account(v_key, org, jsonb_build_object(
    'stripe_customer_id', v_customer,
    'plan_key', 'imobiliaria',
    'status', 'active',
    'owned_listing_packs', 0,
    'addon_keys', '[]'::jsonb,
    'limits', jsonb_build_object('users', 3, 'landing_pages', 1, 'owned_listings', 20,
      'photos_per_listing', 10, 'pipelines', 3, 'ai_conversations', 50)
  ));

  r := r || jsonb_build_object('sem_pacote_limite',
    private.billing_limit(org, 'owned_listings'));

  begin
    insert into public.property_media (organization_id, property_id, kind, storage_path, position)
    values (org, imovel, 'image', org::text || '/properties/' || imovel::text || '/f2.webp', 1);
    r := r || jsonb_build_object('sem_pacote_imovel_31', 'PERMITIDO');
  exception when others then
    get stacked diagnostics v_state = message_text, v_detail = pg_exception_detail;
    r := r || jsonb_build_object('sem_pacote_imovel_31', v_state || ' ' || coalesce(v_detail, ''));
  end;

  r := r || jsonb_build_object('nada_apagado', private.owned_listing_count(org));

  -- Quantidades inválidas.
  begin
    perform public.sync_billing_account(v_key, org,
      jsonb_build_object('stripe_customer_id', v_customer, 'plan_key', null, 'status', null,
        'owned_listing_packs', 1001));
    r := r || jsonb_build_object('pacotes_1001', 'ACEITO');
  exception when others then
    r := r || jsonb_build_object('pacotes_1001', 'RECUSADO:' || sqlstate);
  end;

  begin
    perform public.sync_billing_account(v_key, org,
      jsonb_build_object('stripe_customer_id', v_customer, 'plan_key', null, 'status', null,
        'owned_listing_packs', -1));
    r := r || jsonb_build_object('pacotes_negativo', 'ACEITO');
  exception when others then
    r := r || jsonb_build_object('pacotes_negativo', 'RECUSADO:' || sqlstate);
  end;

  begin
    perform public.sync_billing_account(v_key, org,
      jsonb_build_object('stripe_customer_id', v_customer, 'plan_key', null, 'status', null,
        'owned_listing_packs', '2'));
    r := r || jsonb_build_object('pacotes_texto', 'ACEITO');
  exception when others then
    r := r || jsonb_build_object('pacotes_texto', 'RECUSADO:' || sqlstate);
  end;

  begin
    perform public.sync_billing_account(v_key, org,
      jsonb_build_object('stripe_customer_id', v_customer, 'plan_key', null, 'status', null,
        'owned_listing_packs', 1.5));
    r := r || jsonb_build_object('pacotes_fracionado', 'ACEITO');
  exception when others then
    r := r || jsonb_build_object('pacotes_fracionado', 'RECUSADO:' || sqlstate);
  end;

  r := r || jsonb_build_object(
    'grant_membros',
      has_column_privilege('authenticated', 'public.billing_accounts', 'owned_listing_packs', 'select'),
    'grant_anon',
      has_column_privilege('anon', 'public.billing_accounts', 'owned_listing_packs', 'select'));

  raise exception 'TESTE DOS PACOTES DE IMÓVEIS COM FOTO (rollback): %', jsonb_pretty(r);
end;
$$;
