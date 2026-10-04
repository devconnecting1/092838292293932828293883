-- =============================================================================
-- Teste do CRECI F do dono na landing page e na página pública do imóvel
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- As leituras rodam com `set local role anon` (o mesmo papel do servidor Next
-- com a chave publishable).
--
-- O que está sendo provado (migração public_pages_owner_creci):
--   1. Corretor autônomo sem CRECI J: get_public_landing_page e
--      get_public_property devolvem o CRECI F do dono (número aparado e UF) no
--      objeto "organization" — os mesmos valores de get_public_organization.
--   2. Nada mais do perfil sai: nem nome, telefone, e-mail ou foto do dono; as
--      chaves de "organization" são só as da allowlist.
--   3. Com CRECI J preenchido, o CRECI F do dono não sai (null).
--   4. CRECI de corretor da equipe não vira fallback.
--   5. Grants não mudaram: landing para anon e authenticated, imóvel só para
--      anon; a regra (private.public_owner_creci) não é executável por anon
--      nem authenticated.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   landing_autonomo_creci_f            : "12345/SP"
--   imovel_autonomo_creci_f             : "12345/SP"
--   igual_get_public_organization       : true
--   so_chaves_publicas                  : true
--   sem_outros_dados_do_perfil          : true
--   landing_com_creci_j                 : "54321-J|null|null"
--   imovel_com_creci_j                  : "54321-J|null|null"
--   imovel_da_equipe_publicado          : true
--   corretor_nao_vira_fallback          : "null|null"
--   grant_landing_anon                  : true
--   grant_landing_authenticated         : false
--   grant_imovel_anon                   : true
--   grant_imovel_authenticated          : false
--   regra_privada_anon_authenticated    : false

do $$
declare
  r jsonb := '{}'::jsonb;
  u_solo uuid := gen_random_uuid();
  u_owner_j uuid := gen_random_uuid();
  u_owner_sem uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  org_solo uuid;
  org_j uuid;
  org_sem uuid;
  imv_solo uuid;
  imv_j uuid;
  c_solo text;
  c_j text;
  c_sem text;
  v_landing jsonb;
  v_imovel jsonb;
  v_org jsonb;
  v_landing_j jsonb;
  v_imovel_j jsonb;
  v_imovel_sem jsonb;
  allowed_landing constant text[] := array[
    'name', 'city', 'state', 'phone', 'email', 'creci', 'brand',
    'owner_creci_number', 'owner_creci_state'
  ];
  allowed_imovel constant text[] := array[
    'slug', 'name', 'city', 'state', 'phone', 'email', 'creci', 'brand',
    'owner_creci_number', 'owner_creci_state'
  ];
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'teste-creci-paginas-' || u.nome || '@exemplo.invalid', now(), now(), now()
  from (
    values (u_solo, 'autonomo'), (u_owner_j, 'dono-j'), (u_owner_sem, 'dono-sem'),
           (u_broker, 'corretor')
  ) as u (id, nome);

  update public.profiles
  set full_name = 'Autonomo Sigiloso', phone = '11977776666', creci_number = ' 12345 ',
      creci_state = 'SP', avatar_url = 'https://fotos.exemplo.invalid/perfil.jpg'
  where id = u_solo;
  update public.profiles set creci_number = '99999', creci_state = 'RJ' where id = u_owner_j;
  update public.profiles set creci_number = '77777', creci_state = 'MG' where id = u_broker;

  -- Corretor autônomo: sem CRECI J.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_solo, 'role', 'authenticated')::text, true);
  org_solo := public.create_organization('Autonomo Creci Paginas', 'teste-creci-pag-autonomo');
  update public.organizations set creci = '  ', phone = '11955554444' where id = org_solo;
  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100}'::jsonb
  where organization_id = org_solo;

  insert into public.properties (organization_id, title, purpose, type, status, sale_price, living_area, city)
  values (org_solo, 'Casa do Autonomo', 'sale', 'house', 'active', 500000, 120, 'Campinas')
  returning id, code into imv_solo, c_solo;

  insert into public.landing_pages (
    organization_id, template, name, slug, status, published_at, content, property_ids
  )
  values (org_solo, 'portfolio_grid', 'Vitrine', 'vitrine-creci', 'published', now(),
          jsonb_build_object('headline', 'Meus imoveis'), array[imv_solo]);

  -- Imobiliária com CRECI J (o dono também tem CRECI F, que não pode sair).
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner_j, 'role', 'authenticated')::text, true);
  org_j := public.create_organization('Imobiliaria Creci J Paginas', 'teste-creci-pag-juridica');
  update public.organizations set creci = '54321-J' where id = org_j;
  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100}'::jsonb
  where organization_id = org_j;

  insert into public.properties (organization_id, title, purpose, type, status, sale_price, living_area, city)
  values (org_j, 'Apartamento da Imobiliaria', 'sale', 'apartment', 'active', 700000, 80, 'Campinas')
  returning id, code into imv_j, c_j;

  insert into public.landing_pages (
    organization_id, template, name, slug, status, published_at, content, property_ids
  )
  values (org_j, 'portfolio_grid', 'Vitrine', 'vitrine-creci', 'published', now(),
          jsonb_build_object('headline', 'Nossos imoveis'), array[imv_j]);

  -- Sem CRECI J e dono sem CRECI; só o corretor da equipe tem.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner_sem, 'role', 'authenticated')::text, true);
  org_sem := public.create_organization('Imobiliaria Sem Creci Paginas', 'teste-creci-pag-sem');
  update public.organizations set creci = null where id = org_sem;
  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org_sem;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org_sem, u_broker, 'broker', true);

  insert into public.properties (organization_id, title, purpose, type, status, sale_price, living_area, city)
  values (org_sem, 'Casa da Equipe', 'sale', 'house', 'active', 400000, 100, 'Campinas')
  returning code into c_sem;

  -- ---------------------------------------------------------------------------
  -- Leituras como anon
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  v_landing := public.get_public_landing_page('teste-creci-pag-autonomo', 'vitrine-creci');
  v_imovel := public.get_public_property('teste-creci-pag-autonomo', c_solo);
  v_org := public.get_public_organization('teste-creci-pag-autonomo');
  v_landing_j := public.get_public_landing_page('teste-creci-pag-juridica', 'vitrine-creci');
  v_imovel_j := public.get_public_property('teste-creci-pag-juridica', c_j);
  v_imovel_sem := public.get_public_property('teste-creci-pag-sem', c_sem);

  reset role;

  r := r || jsonb_build_object(
    'landing_autonomo_creci_f',
      (v_landing #>> '{organization,owner_creci_number}') || '/'
        || (v_landing #>> '{organization,owner_creci_state}'),
    'imovel_autonomo_creci_f',
      (v_imovel #>> '{organization,owner_creci_number}') || '/'
        || (v_imovel #>> '{organization,owner_creci_state}'),
    'igual_get_public_organization',
      (v_landing #>> '{organization,owner_creci_number}') = (v_org ->> 'owner_creci_number')
      and (v_landing #>> '{organization,owner_creci_state}') = (v_org ->> 'owner_creci_state')
      and (v_imovel #>> '{organization,owner_creci_number}') = (v_org ->> 'owner_creci_number')
      and (v_imovel #>> '{organization,owner_creci_state}') = (v_org ->> 'owner_creci_state'),
    'so_chaves_publicas',
      (select array_agg(k) from jsonb_object_keys(v_landing -> 'organization') k) <@ allowed_landing
      and (select array_agg(k) from jsonb_object_keys(v_imovel -> 'organization') k) <@ allowed_imovel
      and (select array_agg(k) from jsonb_object_keys(v_landing_j -> 'organization') k) <@ allowed_landing
      and (select array_agg(k) from jsonb_object_keys(v_imovel_j -> 'organization') k) <@ allowed_imovel,
    'sem_outros_dados_do_perfil',
      position('Sigiloso' in v_landing::text) = 0
      and position('11977776666' in v_landing::text) = 0
      and position('teste-creci-paginas-autonomo@' in v_landing::text) = 0
      and position('perfil.jpg' in v_landing::text) = 0
      and position('Sigiloso' in v_imovel::text) = 0
      and position('11977776666' in v_imovel::text) = 0
      and position('teste-creci-paginas-autonomo@' in v_imovel::text) = 0
      and position('perfil.jpg' in v_imovel::text) = 0,
    'landing_com_creci_j',
      (v_landing_j #>> '{organization,creci}') || '|'
        || coalesce(v_landing_j #>> '{organization,owner_creci_number}', 'null') || '|'
        || coalesce(v_landing_j #>> '{organization,owner_creci_state}', 'null'),
    'imovel_com_creci_j',
      (v_imovel_j #>> '{organization,creci}') || '|'
        || coalesce(v_imovel_j #>> '{organization,owner_creci_number}', 'null') || '|'
        || coalesce(v_imovel_j #>> '{organization,owner_creci_state}', 'null'),
    'imovel_da_equipe_publicado', v_imovel_sem is not null,
    'corretor_nao_vira_fallback',
      coalesce(v_imovel_sem #>> '{organization,owner_creci_number}', 'null') || '|'
        || coalesce(v_imovel_sem #>> '{organization,owner_creci_state}', 'null'),
    'grant_landing_anon',
      has_function_privilege('anon', 'public.get_public_landing_page(text, text)', 'execute'),
    'grant_landing_authenticated',
      has_function_privilege('authenticated', 'public.get_public_landing_page(text, text)', 'execute'),
    'grant_imovel_anon',
      has_function_privilege('anon', 'public.get_public_property(text, text)', 'execute'),
    'grant_imovel_authenticated',
      has_function_privilege('authenticated', 'public.get_public_property(text, text)', 'execute'),
    'regra_privada_anon_authenticated',
      has_function_privilege('anon', 'private.public_owner_creci(uuid)', 'execute')
      or has_function_privilege('authenticated', 'private.public_owner_creci(uuid)', 'execute')
  );

  raise exception 'TESTE CRECI NAS PAGINAS PUBLICAS (rollback): %', jsonb_pretty(r);
end;
$$;
