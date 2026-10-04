-- =============================================================================
-- Teste do anúncio no ar: autorização vencida, página pública desligável e
-- medição da página pública do imóvel
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- Cenário (todos ativos e publicados nos portais, salvo o restrito):
--   vigente   autorização vigente hoje
--   vencida   autorização que acabou ontem
--   futura    só autorização que começa amanhã
--   sem       nenhuma autorização cadastrada
--   desligada página pública desligada no imóvel
--   restrito  imóvel restrito com a página ligada no imóvel
--
-- O que está sendo provado:
--   1. Autorização vencida (ou só futura) tira o imóvel do feed, da página, do
--      sitemap e da landing page; imóvel sem autorização cadastrada fica no ar.
--   2. Registrar a renovação traz o imóvel de volta.
--   3. Desligar a regra na imobiliária devolve o imóvel sem autorização vigente.
--   4. Página desligada: página nula e fora do sitemap, mas continua no feed e
--      visível para a equipe. Restrito continua fora de tudo.
--   5. Padrão da imobiliária desligado: imóvel sem escolha própria sai da
--      página; imóvel com a chave ligada fica.
--   6. IDs de medição normalizados e devolvidos pela página; ID inválido é
--      recusado; anon não lê a configuração.
--   7. Filtro "Sem autorização vigente" (not_valid) da lista de imóveis.
--
-- Resultado esperado: todas as chaves com valor true.

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  org uuid;
  cliente uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  p_vigente uuid;
  p_vencida uuid;
  p_futura uuid;
  p_sem uuid;
  p_desligada uuid;
  p_restrito uuid;
  c_vigente text;
  c_vencida text;
  c_futura text;
  c_sem text;
  c_desligada text;
  c_restrito text;
  v_feed jsonb;
  v_sitemap jsonb;
  v_landing jsonb;
  v_page jsonb;
  v_codes text[];
  v_state text;
  v_int integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values (
    u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'teste-anuncio-autorizacao@exemplo.invalid', now(), now(), now()
  );

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Anuncio', 'teste-anuncio-autorizacao');

  update public.organizations
  set feed_token = repeat('cd', 24)
  where id = org;

  insert into public.clients (organization_id, kind, name)
  values (org, 'pf', 'Proprietario do Teste')
  returning id into cliente;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, published_to_portals
  )
  values (org, 'Imovel Vigente', 'sale', 'apartment', 'active', 500000, 80, true)
  returning id, code into p_vigente, c_vigente;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, published_to_portals
  )
  values (org, 'Imovel Vencida', 'sale', 'apartment', 'active', 500000, 80, true)
  returning id, code into p_vencida, c_vencida;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, published_to_portals
  )
  values (org, 'Imovel Futura', 'sale', 'apartment', 'active', 500000, 80, true)
  returning id, code into p_futura, c_futura;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, published_to_portals
  )
  values (org, 'Imovel Sem Autorizacao', 'sale', 'apartment', 'active', 500000, 80, true)
  returning id, code into p_sem, c_sem;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, published_to_portals,
    public_page_enabled
  )
  values (org, 'Imovel Pagina Desligada', 'sale', 'apartment', 'active', 500000, 80, true, false)
  returning id, code into p_desligada, c_desligada;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area, is_restricted,
    public_page_enabled
  )
  values (org, 'Imovel Restrito', 'sale', 'apartment', 'active', 500000, 80, true, true)
  returning id, code into p_restrito, c_restrito;

  insert into public.listing_authorizations (organization_id, property_id, owner_client_id, starts_on, ends_on)
  values
    (org, p_vigente, cliente, v_today - 60, v_today + 60),
    (org, p_vencida, cliente, v_today - 90, v_today - 1),
    (org, p_futura, cliente, v_today + 1, v_today + 180);

  insert into public.landing_pages (organization_id, template, name, slug, status, published_at, content, property_ids)
  values (
    org, 'portfolio_grid', 'Vitrine', 'vitrine-anuncio', 'published', now(),
    jsonb_build_object('headline', 'Nossos imoveis'), array[p_vigente, p_vencida, p_futura, p_sem]
  );

  -- ---------------------------------------------------------------------------
  -- 1. Autorização vencida sai de tudo; sem autorização fica
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  v_feed := public.get_portal_feed('teste-anuncio-autorizacao', repeat('cd', 24));
  v_sitemap := public.get_public_sitemap('teste-anuncio-autorizacao');
  v_landing := public.get_public_landing_page('teste-anuncio-autorizacao', 'vitrine-anuncio');

  select coalesce(array_agg(e ->> 'code' order by e ->> 'code'), '{}') into v_codes
  from jsonb_array_elements(v_feed -> 'properties') e;
  r := r || jsonb_build_object(
    'feed_sem_vencida_nem_futura',
      v_codes = (select array_agg(x order by x) from unnest(array[c_vigente, c_sem, c_desligada]) x)
  );

  select coalesce(array_agg(e ->> 'code' order by e ->> 'code'), '{}') into v_codes
  from jsonb_array_elements(v_sitemap -> 'properties') e;
  r := r || jsonb_build_object(
    'sitemap_sem_vencida_futura_desligada_restrito',
      v_codes = (select array_agg(x order by x) from unnest(array[c_vigente, c_sem]) x)
  );

  select coalesce(array_agg(e ->> 'code' order by e ->> 'code'), '{}') into v_codes
  from jsonb_array_elements(v_landing -> 'properties') e;
  r := r || jsonb_build_object(
    'landing_sem_vencida_nem_futura',
      v_codes = (select array_agg(x order by x) from unnest(array[c_vigente, c_sem]) x),
    'pagina_vigente_e_sem_no_ar',
      public.get_public_property('teste-anuncio-autorizacao', c_vigente) is not null
      and public.get_public_property('teste-anuncio-autorizacao', c_sem) is not null,
    'pagina_vencida_e_futura_404',
      public.get_public_property('teste-anuncio-autorizacao', c_vencida) is null
      and public.get_public_property('teste-anuncio-autorizacao', c_futura) is null,
    'pagina_desligada_404',
      public.get_public_property('teste-anuncio-autorizacao', c_desligada) is null,
    'restrito_continua_fora',
      public.get_public_property('teste-anuncio-autorizacao', c_restrito) is null
      and position(c_restrito in v_feed::text) = 0,
    'pagina_sem_medicao_configurada',
      public.get_public_property('teste-anuncio-autorizacao', c_vigente) -> 'tracking' = '{}'::jsonb
  );

  reset role;

  -- A equipe continua vendo o imóvel com a página desligada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  execute 'select count(*)::integer from public.properties where id = $1' into v_int using p_desligada;
  r := r || jsonb_build_object('equipe_ve_pagina_desligada', v_int = 1);

  -- ---------------------------------------------------------------------------
  -- 7. Filtro "Sem autorização vigente" (security invoker, como a tela)
  -- ---------------------------------------------------------------------------
  select coalesce(array_agg(s.code order by s.code), '{}') into v_codes
  from public.search_properties(org, p_authorization => 'not_valid', p_limit => 100) s;
  r := r || jsonb_build_object(
    'filtro_sem_autorizacao_vigente',
      v_codes = (
        select array_agg(x order by x)
        from unnest(array[c_vencida, c_futura, c_sem, c_desligada, c_restrito]) x
      ),
    'filtro_vencida_continua',
      (
        select coalesce(array_agg(s.code), '{}')
        from public.search_properties(org, p_authorization => 'expired', p_limit => 100) s
      ) = array[c_vencida]
  );

  -- ---------------------------------------------------------------------------
  -- 2. Renovação traz o imóvel de volta
  -- ---------------------------------------------------------------------------
  insert into public.listing_authorizations (organization_id, property_id, owner_client_id, starts_on, ends_on)
  values (org, p_vencida, cliente, v_today, v_today + 365);

  -- ---------------------------------------------------------------------------
  -- 6. Medição: normaliza, recusa inválido
  -- ---------------------------------------------------------------------------
  insert into public.listing_publication_settings (organization_id, meta_pixel_id, google_tag_id)
  values (org, ' 1234567890 ', ' g-abc123 ');

  begin
    update public.listing_publication_settings set meta_pixel_id = 'abc' where organization_id = org;
    v_state := 'aceitou';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  r := r || jsonb_build_object('pixel_invalido_recusado_23514', v_state = '23514');

  begin
    update public.listing_publication_settings set google_tag_id = 'GTM-ABC123' where organization_id = org;
    v_state := 'aceitou';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  r := r || jsonb_build_object('gtm_recusado_23514', v_state = '23514');

  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  v_page := public.get_public_property('teste-anuncio-autorizacao', c_vencida);
  r := r || jsonb_build_object(
    'renovada_volta_na_pagina', v_page is not null,
    'renovada_volta_no_feed',
      position(c_vencida in public.get_portal_feed('teste-anuncio-autorizacao', repeat('cd', 24))::text) > 0,
    'renovada_volta_no_sitemap',
      exists (
        select 1
        from jsonb_array_elements(public.get_public_sitemap('teste-anuncio-autorizacao') -> 'properties') e
        where e ->> 'code' = c_vencida
      ),
    'pagina_devolve_medicao_normalizada',
      v_page -> 'tracking' = jsonb_build_object('meta_pixel_id', '1234567890', 'google_tag_id', 'G-ABC123'),
    'anon_nao_le_configuracao',
      not has_table_privilege('anon', 'public.listing_publication_settings', 'select')
  );

  reset role;

  -- ---------------------------------------------------------------------------
  -- 3 e 5. Regra desligada na imobiliária e padrão da página desligado
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;

  update public.listing_publication_settings
  set hide_without_valid_authorization = false,
      public_pages_enabled_by_default = false
  where organization_id = org;

  update public.properties set public_page_enabled = true where id = p_vigente;

  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  r := r || jsonb_build_object(
    'regra_desligada_futura_volta_no_feed',
      position(c_futura in public.get_portal_feed('teste-anuncio-autorizacao', repeat('cd', 24))::text) > 0,
    'padrao_desligado_tira_quem_segue_padrao',
      public.get_public_property('teste-anuncio-autorizacao', c_sem) is null
      and public.get_public_property('teste-anuncio-autorizacao', c_futura) is null,
    'chave_ligada_no_imovel_fica',
      public.get_public_property('teste-anuncio-autorizacao', c_vigente) is not null,
    'sitemap_so_chave_ligada',
      (
        select coalesce(array_agg(e ->> 'code'), '{}')
        from jsonb_array_elements(public.get_public_sitemap('teste-anuncio-autorizacao') -> 'properties') e
      ) = array[c_vigente]
  );

  reset role;

  raise exception 'TESTE anuncio_autorizacao_pagina_publica (rollback): %', jsonb_pretty(r);
end;
$$;
