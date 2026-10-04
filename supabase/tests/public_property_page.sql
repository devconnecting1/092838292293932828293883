-- =============================================================================
-- Teste da página pública do imóvel (get_public_property, get_public_sitemap e
-- submit_property_lead)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- As chamadas às RPCs rodam com `set local role anon` (o mesmo papel do
-- servidor Next com a chave publishable).
--
-- O que está sendo garantido:
--   * `anon` lê o imóvel ATIVO pelo slug + código (em qualquer caixa);
--   * a resposta só tem as chaves da allowlist (organização, imóvel e mídia) e
--     nenhum dado privado: rua/número/complemento/CEP/coordenadas no modo
--     "neighborhood", número no modo "street", complemento/CEP em "full", nem
--     rótulo/local/nota das chaves;
--   * imóvel inativo, rascunho, inexistente, de outra imobiliária ou slug
--     inexistente devolvem null (mesma resposta: não revela se existe), e o
--     slug decide a imobiliária (códigos se repetem entre imobiliárias);
--   * só `anon` tem EXECUTE nas três funções (`authenticated` não);
--   * o sitemap lista só imóveis ativos e landing pages publicadas;
--   * o formulário cria lead com property_id, source "website", consentimento
--     e UTM; imóvel inativo recusa com P0002; chave errada recusa com 42501;
--   * quando o imóvel sai de ativo, a página e o sitemap deixam de mostrá-lo.
--
-- Resultado esperado: todas as chaves com valor true.

do $$
declare
  r jsonb := '{}'::jsonb;
  lead_key text;
  u_owner uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  org uuid;
  org2 uuid;
  imv_ativo uuid;
  c_ativo text;
  c_rua text;
  c_full text;
  c_inativo text;
  c_rascunho text;
  c_outra text;
  v jsonb;
  v_rua jsonb;
  v_full jsonb;
  v_sitemap jsonb;
  v_state text;
  v_lead record;
  property_keys constant text[] := array[
    'code', 'title', 'description', 'purpose', 'usage', 'type', 'sale_price', 'rent_price',
    'condo_fee', 'iptu_yearly', 'living_area', 'lot_area', 'bedrooms', 'suites', 'bathrooms',
    'parking_spaces', 'year_built', 'features', 'furnished', 'accepts_pets', 'address_display',
    'street', 'street_number', 'neighborhood', 'city', 'state', 'listed_at', 'updated_at'
  ];
  -- owner_creci_*: CRECI F do dono, só sem CRECI J (migração public_pages_owner_creci).
  organization_keys constant text[] := array[
    'slug', 'name', 'city', 'state', 'phone', 'email', 'creci', 'brand',
    'owner_creci_number', 'owner_creci_state'
  ];
  media_keys constant text[] := array['kind', 'storage_path', 'external_url', 'caption', 'is_cover'];
begin
  select ds.decrypted_secret into lead_key
  from vault.decrypted_secrets ds
  where ds.name = 'lead_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-pagina-imovel@exemplo.invalid', now(), now(), now()),
    (u_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-pagina-imovel-outra@exemplo.invalid', now(), now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  org2 := public.create_organization('Outra Imobiliaria Teste', 'teste-pagina-imovel-outra');

  insert into public.properties (organization_id, title, purpose, type, status, sale_price, living_area)
  values (org2, 'Imovel da outra', 'sale', 'apartment', 'active', 400000, 70)
  returning code into c_outra;

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  org := public.create_organization('Imobiliaria Teste Pagina Imovel', 'teste-pagina-imovel');

  -- Ativo, endereço só com bairro (padrão), com todos os campos sigilosos preenchidos.
  insert into public.properties (
    organization_id, title, description, purpose, type, status, sale_price, living_area, bedrooms,
    street, street_number, complement, postal_code, neighborhood, city, state, latitude, longitude,
    address_display
  )
  values (
    org, 'Apartamento Teste', 'Descricao publica do anuncio', 'sale', 'apartment', 'active',
    500000, 80, 2, 'Rua Sigilosa', '4321', 'Apto 71 SEGREDO', '01310100', 'Bela Vista',
    'Sao Paulo', 'SP', -23.5611, -46.6559, 'neighborhood'
  )
  returning id, code into imv_ativo, c_ativo;

  insert into public.properties (
    organization_id, title, purpose, type, status, rent_price, living_area,
    street, street_number, complement, postal_code, neighborhood, city, state, address_display
  )
  values (
    org, 'Casa modo rua', 'rent', 'house', 'active', 3000, 120,
    'Rua Visivel', '4321', 'Fundos SEGREDO', '01310100', 'Centro', 'Campinas', 'SP', 'street'
  )
  returning code into c_rua;

  insert into public.properties (
    organization_id, title, purpose, type, status, sale_price, living_area,
    street, street_number, complement, postal_code, neighborhood, city, state, address_display
  )
  values (
    org, 'Sala modo completo', 'sale', 'office', 'active', 250000, 40,
    'Avenida Completa', '1500', 'Sala 12 SEGREDO', '01310100', 'Centro', 'Campinas', 'SP', 'full'
  )
  returning code into c_full;

  insert into public.properties (organization_id, title, purpose, type, status, sale_price, living_area)
  values (org, 'Imovel inativo', 'sale', 'apartment', 'inactive', 300000, 60)
  returning code into c_inativo;

  insert into public.properties (organization_id, title, purpose, type, status)
  values (org, 'Imovel rascunho', 'sale', 'apartment', 'draft')
  returning code into c_rascunho;

  insert into public.keys (organization_id, property_id, label, location, notes)
  values (org, imv_ativo, 'CHAVE SEGREDO', 'Gaveta SEGREDO', 'Nota interna SEGREDO');

  insert into public.property_media (organization_id, property_id, kind, external_url, position, is_cover, caption)
  values
    (org, imv_ativo, 'image', 'https://fotos.exemplo.invalid/capa.jpg', 1, true, 'Sala'),
    (org, imv_ativo, 'video', 'https://www.youtube.com/watch?v=teste', 2, false, null);

  insert into public.landing_pages (organization_id, template, name, slug, status, published_at, content)
  values (
    org, 'campaign_valuation', 'Campanha publicada', 'campanha-publicada', 'published', now(),
    jsonb_build_object('headline', 'Avalie seu imovel')
  );

  -- ---------------------------------------------------------------------------
  -- 1. Permissões: só anon executa
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'somente_anon_executa',
    has_function_privilege('anon', 'public.get_public_property(text, text)', 'execute')
    and has_function_privilege('anon', 'public.get_public_sitemap(text)', 'execute')
    and has_function_privilege('anon',
      'public.submit_property_lead(text, text, jsonb, text, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.get_public_property(text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.get_public_sitemap(text)', 'execute')
    and not has_function_privilege('authenticated',
      'public.submit_property_lead(text, text, jsonb, text, text, text)', 'execute')
  );

  -- ---------------------------------------------------------------------------
  -- 2. Leitura como anon
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';

  v := public.get_public_property('Teste-Pagina-Imovel', lower(c_ativo));
  v_rua := public.get_public_property('teste-pagina-imovel', c_rua);
  v_full := public.get_public_property('teste-pagina-imovel', c_full);

  r := r || jsonb_build_object(
    'anon_le_imovel_ativo', v is not null and v -> 'property' ->> 'code' = c_ativo,
    'foto_externa_e_video', jsonb_array_length(v -> 'media') = 2
      and v -> 'media' -> 0 ->> 'external_url' = 'https://fotos.exemplo.invalid/capa.jpg',
    'so_chaves_publicas',
      -- tracking: IDs de medição da imobiliária (migração listing_publication_rules).
      (select coalesce(array_agg(k), '{}') from jsonb_object_keys(v) k) <@ array['organization', 'tracking', 'property', 'media']
      and (select coalesce(array_agg(k), '{}') from jsonb_object_keys(v -> 'tracking') k) <@ array['meta_pixel_id', 'google_tag_id']
      and (select coalesce(array_agg(k), '{}') from jsonb_object_keys(v -> 'property') k) <@ property_keys
      and (select coalesce(array_agg(k), '{}') from jsonb_object_keys(v -> 'organization') k) <@ organization_keys
      and not exists (
        select 1
        from jsonb_array_elements(v -> 'media') m
        where not ((select array_agg(k) from jsonb_object_keys(m) k) <@ media_keys)
      ),
    'bairro_sem_rua_numero_cep',
      v -> 'property' ->> 'street' is null
      and v -> 'property' ->> 'street_number' is null
      and v -> 'property' ->> 'neighborhood' = 'Bela Vista'
      and position('Sigilosa' in v::text) = 0
      and position('4321' in v::text) = 0
      and position('01310100' in v::text) = 0
      and position('-23.5611' in v::text) = 0,
    'sem_complemento_nem_chaves',
      position('SEGREDO' in v::text) = 0
      and position('SEGREDO' in v_rua::text) = 0
      and position('SEGREDO' in v_full::text) = 0,
    'modo_rua_sem_numero',
      v_rua -> 'property' ->> 'street' = 'Rua Visivel'
      and v_rua -> 'property' ->> 'street_number' is null
      and position('4321' in v_rua::text) = 0,
    'modo_completo_com_numero_sem_cep',
      v_full -> 'property' ->> 'street' = 'Avenida Completa'
      and v_full -> 'property' ->> 'street_number' = '1500'
      and position('01310100' in v_full::text) = 0,
    'inativo_rascunho_outra_inexistente_null',
      public.get_public_property('teste-pagina-imovel', c_inativo) is null
      and public.get_public_property('teste-pagina-imovel', c_rascunho) is null
      and public.get_public_property('teste-pagina-imovel-outra', c_rua) is null
      and public.get_public_property('teste-pagina-imovel', 'IMV-999999') is null
      and public.get_public_property('slug-que-nao-existe', c_ativo) is null
      and public.get_public_property('teste-pagina-imovel', '') is null
      and public.get_public_property(null, c_ativo) is null,
    -- O código é sequencial por imobiliária (as duas têm IMV-000001): o slug decide.
    'slug_escolhe_a_imobiliaria',
      public.get_public_property('teste-pagina-imovel-outra', c_outra) -> 'property' ->> 'title'
        = 'Imovel da outra'
      and public.get_public_property('teste-pagina-imovel', c_outra) -> 'property' ->> 'title'
        = 'Apartamento Teste'
  );

  v_sitemap := public.get_public_sitemap('teste-pagina-imovel');

  r := r || jsonb_build_object(
    'sitemap_so_ativos_e_publicadas',
      (select array_agg(e ->> 'code' order by e ->> 'code') from jsonb_array_elements(v_sitemap -> 'properties') e)
        = (select array_agg(x order by x) from unnest(array[c_ativo, c_rua, c_full]) x)
      and (select array_agg(e ->> 'slug') from jsonb_array_elements(v_sitemap -> 'landing_pages') e)
        = array['campanha-publicada']
      and public.get_public_sitemap('slug-que-nao-existe') is null
  );

  -- ---------------------------------------------------------------------------
  -- 3. Formulário de interesse
  -- ---------------------------------------------------------------------------
  perform public.submit_property_lead('teste-pagina-imovel', lower(c_ativo),
    jsonb_build_object(
      'name', 'Visitante Pagina', 'phone', '(11) 98888-0001', 'consent', true,
      'interest', 'buy', 'message', 'Quero visitar',
      'utm', jsonb_build_object('source', 'whatsapp', 'medium', 'social'),
      'event_id', '5b0f3a8e-5d1c-4b4e-9a53-0c8f7d0f2a11',
      'landing_url', 'https://teste-pagina-imovel.exemplo.invalid/imovel/' || c_ativo
    ),
    lead_key, repeat('i', 32), null);

  begin
    perform public.submit_property_lead('teste-pagina-imovel', c_inativo,
      jsonb_build_object('name', 'Visitante Dois', 'phone', '11988880002', 'consent', true),
      lead_key, repeat('j', 32), null);
    v_state := 'aceitou';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  r := r || jsonb_build_object('inativo_recusa_p0002', v_state = 'P0002');

  begin
    perform public.submit_property_lead('teste-pagina-imovel', c_ativo,
      jsonb_build_object('name', 'Visitante Tres', 'phone', '11988880003', 'consent', true),
      'chave-errada', repeat('k', 32), null);
    v_state := 'aceitou';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  r := r || jsonb_build_object('chave_errada_recusa_42501', v_state = '42501');

  begin
    perform public.submit_property_lead('teste-pagina-imovel', c_ativo,
      jsonb_build_object('name', 'Visitante Quatro', 'phone', '11988880004'),
      lead_key, repeat('l', 32), null);
    v_state := 'aceitou';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  r := r || jsonb_build_object('sem_consentimento_recusa_22023', v_state = '22023');

  execute 'reset role';

  select l.property_id, l.source, l.consent_at, l.utm, l.landing_page_id, l.stage, l.interest
    into v_lead
  from public.leads l
  where l.organization_id = org and l.name = 'Visitante Pagina';

  r := r || jsonb_build_object(
    'lead_ligado_ao_imovel',
      v_lead.property_id = imv_ativo
      and v_lead.source = 'website'
      and v_lead.landing_page_id is null
      and v_lead.consent_at is not null
      and v_lead.stage = 'new'
      and v_lead.interest = 'buy'
      and v_lead.utm = jsonb_build_object('source', 'whatsapp', 'medium', 'social'),
    'so_um_lead_criado',
      (select count(*) from public.leads l where l.organization_id = org) = 1
  );

  -- ---------------------------------------------------------------------------
  -- 4. Imóvel sai de ativo: some da página e do sitemap
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);
  update public.properties set status = 'inactive' where id = imv_ativo;

  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';

  r := r || jsonb_build_object(
    'inativado_some_da_pagina',
      public.get_public_property('teste-pagina-imovel', c_ativo) is null,
    'inativado_some_do_sitemap',
      not exists (
        select 1
        from jsonb_array_elements(public.get_public_sitemap('teste-pagina-imovel') -> 'properties') e
        where e ->> 'code' = c_ativo
      )
  );

  execute 'reset role';

  raise exception 'TESTE public_property_page (rollback): %', jsonb_pretty(r);
end;
$$;
