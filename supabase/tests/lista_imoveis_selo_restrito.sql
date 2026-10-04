-- =============================================================================
-- Teste do selo "Restrito" na lista de imóveis (search_properties.is_restricted)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado (migração property_list_restricted_flag):
--   1. O dono recebe os dois imóveis, com is_restricted true só no restrito.
--   2. O corretor sem compartilhamento continua sem receber o restrito (o RLS
--      decide, como antes) e o imóvel aberto vem com is_restricted false.
--   3. O corretor escolhido (property_shares) recebe o restrito com o selo.
--   4. A busca por texto e o filtro de autorização continuam funcionando.
--   5. Grants iguais aos de antes: authenticated executa, anon não.
--
-- Resultado esperado (a ordem das chaves pode variar):
--   dono_lista             : "Apartamento Aberto:false|Cobertura Sigilosa:true"
--   corretor_lista         : "Apartamento Aberto:false"
--   escolhido_ve_restrito  : true
--   busca_por_texto        : "Cobertura Sigilosa:true"
--   filtro_autorizacao     : 1
--   retorno_termina_com_is_restricted : true
--   grant_authenticated    : true
--   grant_anon             : false

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  u_broker uuid := gen_random_uuid();
  u_shared uuid := gen_random_uuid();
  org uuid;
  imv_restrito uuid;
  cli_dono uuid;
  v_text text;
  v_bool boolean;
  v_int integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'teste-selo-restrito-' || u.nome || '@exemplo.invalid', now(), now(), now()
  from (values (u_owner, 'dono'), (u_broker, 'corretor'), (u_shared, 'escolhido')) as u (id, nome);

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Selo Restrito', 'teste-selo-restrito');

  update public.billing_accounts
  set limits = limits || '{"owned_listings": 100, "users": 20}'::jsonb
  where organization_id = org;

  insert into public.memberships (organization_id, user_id, role, active)
  values (org, u_broker, 'broker', true), (org, u_shared, 'broker', true);

  insert into public.clients (organization_id, kind, name)
  values (org, 'pf', 'Proprietario Selo Restrito')
  returning id into cli_dono;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, neighborhood, city, is_restricted
  )
  values (org, 'Cobertura Sigilosa', 'sale', 'apartment', 'active', 9000000, 400, 'Jardins', 'Sao Paulo', true)
  returning id into imv_restrito;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, neighborhood, city
  )
  values (org, 'Apartamento Aberto', 'sale', 'apartment', 'active', 800000, 90, 'Jardins', 'Sao Paulo');

  -- Autorização vencida só no restrito: o filtro "expired" acha um imóvel.
  insert into public.listing_authorizations (organization_id, property_id, owner_client_id, starts_on, ends_on)
  values (org, imv_restrito, cli_dono, (now() at time zone 'America/Sao_Paulo')::date - 60, (now() at time zone 'America/Sao_Paulo')::date - 1);

  insert into public.property_shares (organization_id, property_id, user_id)
  values (org, imv_restrito, u_shared);

  -- ---------------------------------------------------------------------------
  -- 1. Dono
  -- ---------------------------------------------------------------------------
  set local role authenticated;

  execute $q$
    select string_agg(s.title || ':' || s.is_restricted, '|' order by s.title)
    from public.search_properties($1, p_limit => 100) s
  $q$ into v_text using org;
  r := r || jsonb_build_object('dono_lista', v_text);

  execute $q$
    select string_agg(s.title || ':' || s.is_restricted, '|' order by s.title)
    from public.search_properties($1, 'sigilosa') s
  $q$ into v_text using org;
  r := r || jsonb_build_object('busca_por_texto', v_text);

  execute $q$
    select count(*)::integer
    from public.search_properties($1, p_authorization => 'expired') s
    where s.is_restricted
  $q$ into v_int using org;
  r := r || jsonb_build_object('filtro_autorizacao', v_int);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 2. Corretor sem compartilhamento
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_broker, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute $q$
    select string_agg(s.title || ':' || s.is_restricted, '|' order by s.title)
    from public.search_properties($1, p_limit => 100) s
  $q$ into v_text using org;
  r := r || jsonb_build_object('corretor_lista', v_text);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 3. Corretor escolhido
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_shared, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute $q$
    select coalesce(bool_or(s.id = $2 and s.is_restricted), false)
    from public.search_properties($1, p_limit => 100) s
  $q$ into v_bool using org, imv_restrito;
  r := r || jsonb_build_object('escolhido_ve_restrito', v_bool);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 4. Contrato e grants
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'retorno_termina_com_is_restricted',
      pg_get_function_result(
        'public.search_properties(uuid, text, public.property_status, public.listing_purpose, public.property_type, numeric, numeric, integer, integer, integer, text)'::regprocedure
      ) like '%authorization_ends_on date, is_restricted boolean)',
    'grant_authenticated',
      has_function_privilege(
        'authenticated',
        'public.search_properties(uuid, text, public.property_status, public.listing_purpose, public.property_type, numeric, numeric, integer, integer, integer, text)',
        'execute'
      ),
    'grant_anon',
      has_function_privilege(
        'anon',
        'public.search_properties(uuid, text, public.property_status, public.listing_purpose, public.property_type, numeric, numeric, integer, integer, integer, text)',
        'execute'
      )
  );

  raise exception 'TESTE selo restrito na lista de imoveis (rollback): %', jsonb_pretty(r);
end;
$$;
