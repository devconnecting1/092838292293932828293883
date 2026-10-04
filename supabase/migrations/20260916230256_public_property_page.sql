-- =============================================================================
-- Página pública do imóvel ativo ({slug}.raiz/imovel/{codigo})
-- =============================================================================
-- Decisão de produto (16/09/2026): cada imóvel ATIVO ganha uma página pública
-- simples e grátis, que NÃO conta no limite de 1 landing page por assinatura
-- (nada aqui lê ou grava limites de plano).
--
-- 1. get_public_property(p_org_slug, p_code): leitura pública de UM imóvel
--    ativo da imobiliária do slug, só com campos de anúncio. Sem proprietário,
--    chaves, CEP, complemento, coordenadas nem notas; rua e número conforme
--    `address_display` (neighborhood: só bairro/cidade; street: + rua;
--    full: + número). Imóvel inexistente, de outra imobiliária ou fora de
--    `active` devolve null (a página responde 404 sem revelar o motivo).
-- 2. get_public_sitemap(p_org_slug): códigos dos imóveis ativos e slugs das
--    landing pages publicadas, para o sitemap.xml do subdomínio.
-- 3. submit_property_lead(...): formulário de interesse da página do imóvel.
--    Mesmo contrato de submit_landing_lead (chave do servidor no Vault
--    `lead_server_key`, nonce de uso único, consentimento LGPD, UTM/click ids,
--    event_id idempotente) e o MESMO limite de envios por imobiliária e por
--    visitante (private.landing_lead_attempts, mesma trava). O lead nasce com
--    source = 'website' e property_id do imóvel; o rodízio decide o responsável.
--
-- EXECUTE só para `anon`: o servidor Next chama com a chave publishable, sem
-- sessão.

-- -----------------------------------------------------------------------------
-- 1. Leitura pública do imóvel
-- -----------------------------------------------------------------------------
create or replace function public.get_public_property(p_org_slug text, p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code constant text := upper(btrim(coalesce(p_code, '')));
  v_org_id uuid;
  v_org jsonb;
  v_property public.properties%rowtype;
begin
  if p_org_slug is null or v_code = '' or char_length(v_code) > 40 then
    return null;
  end if;

  select
    o.id,
    jsonb_build_object(
      'slug', o.slug,
      'name', o.name,
      'city', o.city,
      'state', o.state,
      'phone', o.phone,
      'email', o.email,
      'creci', o.creci,
      'brand', o.brand
    )
    into v_org_id, v_org
  from public.organizations o
  where o.slug = lower(btrim(p_org_slug));

  if v_org_id is null then
    return null;
  end if;

  select p.* into v_property
  from public.properties p
  where p.organization_id = v_org_id
    and p.code = v_code
    and p.status = 'active';

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'organization', v_org,
    'property', jsonb_build_object(
      'code', v_property.code,
      'title', v_property.title,
      'description', v_property.description,
      'purpose', v_property.purpose,
      'usage', v_property.usage,
      'type', v_property.type,
      'sale_price', v_property.sale_price,
      'rent_price', v_property.rent_price,
      'condo_fee', v_property.condo_fee,
      'iptu_yearly', v_property.iptu_yearly,
      'living_area', v_property.living_area,
      'lot_area', v_property.lot_area,
      'bedrooms', v_property.bedrooms,
      'suites', v_property.suites,
      'bathrooms', v_property.bathrooms,
      'parking_spaces', v_property.parking_spaces,
      'year_built', v_property.year_built,
      'features', v_property.features,
      'furnished', v_property.furnished,
      'accepts_pets', v_property.accepts_pets,
      'address_display', v_property.address_display,
      'street', case
        when v_property.address_display in ('full', 'street') then v_property.street
      end,
      'street_number', case
        when v_property.address_display = 'full' then v_property.street_number
      end,
      'neighborhood', v_property.neighborhood,
      'city', v_property.city,
      'state', v_property.state,
      'listed_at', coalesce(v_property.published_at, v_property.created_at),
      'updated_at', v_property.updated_at
    ),
    'media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'kind', m.kind,
          'storage_path', m.storage_path,
          'external_url', m.external_url,
          'caption', m.caption,
          'is_cover', m.is_cover
        )
        order by m.is_cover desc, m.position, m.created_at, m.id
      )
      from (
        select pm.kind, pm.storage_path, pm.external_url, pm.caption, pm.is_cover,
               pm.position, pm.created_at, pm.id
        from public.property_media pm
        where pm.organization_id = v_org_id
          and pm.property_id = v_property.id
        order by pm.is_cover desc, pm.position, pm.created_at, pm.id
        limit 60
      ) as m
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.get_public_property(text, text) is
  'Página pública do imóvel: um imóvel ATIVO da imobiliária do slug, só com campos de anúncio '
  '(sem proprietário, chaves, CEP, complemento, coordenadas; rua/número conforme address_display). '
  'null para inexistente, inativo ou de outra imobiliária. EXECUTE só para anon.';

revoke all on function public.get_public_property(text, text) from public, anon, authenticated;
grant execute on function public.get_public_property(text, text) to anon;

-- -----------------------------------------------------------------------------
-- 2. Sitemap do subdomínio
-- -----------------------------------------------------------------------------
create or replace function public.get_public_sitemap(p_org_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select o.id into v_org_id
  from public.organizations o
  where o.slug = lower(btrim(coalesce(p_org_slug, '')));

  if v_org_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object('code', x.code, 'updated_at', x.updated_at)
        order by x.updated_at desc, x.code
      )
      from (
        select p.code, p.updated_at
        from public.properties p
        where p.organization_id = v_org_id
          and p.status = 'active'
        order by p.updated_at desc, p.code
        limit 5000
      ) as x
    ), '[]'::jsonb),
    'landing_pages', coalesce((
      select jsonb_agg(
        jsonb_build_object('slug', y.slug, 'updated_at', y.updated_at)
        order by y.updated_at desc, y.slug
      )
      from (
        select lp.slug, lp.updated_at
        from public.landing_pages lp
        where lp.organization_id = v_org_id
          and lp.status = 'published'
        order by lp.updated_at desc, lp.slug
        limit 50
      ) as y
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.get_public_sitemap(text) is
  'sitemap.xml do subdomínio: códigos dos imóveis ativos (até 5.000) e slugs das landing pages '
  'publicadas, com a data da última alteração. null para imobiliária inexistente. EXECUTE só para anon.';

revoke all on function public.get_public_sitemap(text) from public, anon, authenticated;
grant execute on function public.get_public_sitemap(text) to anon;

-- -----------------------------------------------------------------------------
-- 3. Lead da página do imóvel
-- -----------------------------------------------------------------------------
create or replace function public.submit_property_lead(
  p_org_slug text,
  p_property_code text,
  p_payload jsonb,
  p_server_key text default null,
  p_nonce text default null,
  p_client_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_client_key text := nullif(btrim(coalesce(p_client_key, '')), '');
  v_org uuid;
  v_property_id uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_message text;
  v_interest text;
  v_text text;
  v_event_id uuid;
  v_landing_url text;
  v_referrer text;
  v_utm jsonb := '{}'::jsonb;
  v_click_ids jsonb := '{}'::jsonb;
begin
  -- Chave do servidor e nonce: sempre o mesmo erro, sem indicar o motivo.
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'lead_server_key'
  limit 1;

  if v_secret is null
     or p_server_key is null
     or extensions.digest(p_server_key, 'sha256') <> extensions.digest(v_secret, 'sha256')
     or p_nonce is null
     or char_length(p_nonce) not between 16 and 512
     or p_nonce !~ '^[[:graph:]]+$' then
    raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Dados do formulário inválidos.' using errcode = '22023';
  end if;

  if octet_length(p_payload::text) > 16384 then
    raise exception 'Formulário grande demais.' using errcode = '22023';
  end if;

  if v_client_key is not null and v_client_key !~ '^[A-Za-z0-9_=+/-]{32,128}$' then
    raise exception 'Identificação do visitante inválida.' using errcode = '22023';
  end if;

  -- Só imóvel ATIVO da imobiliária do slug.
  select p.organization_id, p.id
    into v_org, v_property_id
  from public.properties p
  join public.organizations o
    on o.id = p.organization_id
  where o.slug = lower(btrim(coalesce(p_org_slug, '')))
    and p.code = upper(btrim(coalesce(p_property_code, '')))
    and p.status = 'active';

  if v_property_id is null then
    raise exception 'Imóvel não encontrado.' using errcode = 'P0002';
  end if;

  -- Validação (erros não gastam o nonce)
  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  v_email := nullif(lower(btrim(coalesce(p_payload ->> 'email', ''))), '');
  v_phone := nullif(regexp_replace(coalesce(p_payload ->> 'phone', ''), '[^0-9]', '', 'g'), '');
  v_message := nullif(btrim(coalesce(p_payload ->> 'message', '')), '');
  v_interest := nullif(lower(btrim(coalesce(p_payload ->> 'interest', ''))), '');

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Informe seu nome (2 a 120 caracteres).' using errcode = '22023';
  end if;

  if v_email is null and v_phone is null then
    raise exception 'Informe um e-mail ou telefone para contato.' using errcode = '22023';
  end if;

  -- E-mail estrito: sem espaços, quebras de linha, "?", "&" ou pontos seguidos.
  if v_email is not null and (
    char_length(v_email) > 254
    or v_email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
    or position('..' in v_email) > 0
  ) then
    raise exception 'E-mail inválido.' using errcode = '22023';
  end if;

  if v_phone is not null and v_phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido: informe DDD e número.' using errcode = '22023';
  end if;

  if char_length(v_message) > 2000 then
    raise exception 'Mensagem longa demais (máximo 2.000 caracteres).' using errcode = '22023';
  end if;

  if v_interest is not null and v_interest not in ('buy', 'rent', 'invest', 'sell', 'info') then
    raise exception 'Interesse inválido.' using errcode = '22023';
  end if;

  v_text := nullif(btrim(coalesce(p_payload ->> 'event_id', '')), '');
  if v_text is not null then
    v_event_id := private.try_uuid(v_text);
    if v_event_id is null then
      raise exception 'Identificador do evento inválido.' using errcode = '22023';
    end if;
  end if;

  if lower(coalesce(p_payload ->> 'consent', '')) <> 'true' then
    raise exception 'É necessário aceitar o uso dos dados para contato (LGPD).'
      using errcode = '22023';
  end if;

  -- Atribuição de campanha: só chaves conhecidas, texto aparado e cortado no limite.
  if jsonb_typeof(p_payload -> 'utm') = 'object' then
    select coalesce(jsonb_object_agg(e.key, left(btrim(e.value #>> '{}'), 150)), '{}'::jsonb)
      into v_utm
    from jsonb_each(p_payload -> 'utm') as e
    where e.key in ('source', 'medium', 'campaign', 'content', 'term')
      and jsonb_typeof(e.value) in ('string', 'number')
      and btrim(e.value #>> '{}') <> '';
  end if;

  if jsonb_typeof(p_payload -> 'click_ids') = 'object' then
    select coalesce(jsonb_object_agg(e.key, left(btrim(e.value #>> '{}'), 255)), '{}'::jsonb)
      into v_click_ids
    from jsonb_each(p_payload -> 'click_ids') as e
    where e.key in ('gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp')
      and jsonb_typeof(e.value) in ('string', 'number')
      and btrim(e.value #>> '{}') <> '';
  end if;

  -- URLs: só http/https, sem espaços ou caracteres de controle; senão, ignoradas.
  v_landing_url := left(btrim(coalesce(p_payload ->> 'landing_url', '')), 500);
  if v_landing_url !~* '^https?://' or v_landing_url ~ '[[:space:][:cntrl:]]' then
    v_landing_url := null;
  end if;

  v_referrer := left(btrim(coalesce(p_payload ->> 'referrer', '')), 500);
  if v_referrer !~* '^https?://' or v_referrer ~ '[[:space:][:cntrl:]]' then
    v_referrer := null;
  end if;

  -- Mesma trava de submit_landing_lead: os limites abaixo valem somados para
  -- landing page e página do imóvel, mesmo com envios simultâneos.
  perform pg_advisory_xact_lock(hashtextextended('submit_landing_lead:' || v_org::text, 0));

  -- event_id repetido: ignora (o nonce é consumido normalmente).
  if v_event_id is not null and exists (
    select 1 from public.leads l
    where l.organization_id = v_org
      and l.event_id = v_event_id
  ) then
    insert into private.capture_request_nonces (nonce_hash)
    values (encode(extensions.digest(p_nonce, 'sha256'), 'hex'))
    on conflict (nonce_hash) do nothing;

    if not found then
      raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
    end if;

    return;
  end if;

  if (
    select count(*)
    from private.landing_lead_attempts a
    where a.organization_id = v_org
      and a.created_at > now() - interval '1 minute'
  ) >= 60 then
    raise exception 'Muitas solicitações em pouco tempo. Tente novamente em instantes.'
      using errcode = '54000', detail = 'organization';
  end if;

  if v_client_key is not null and (
    select count(*)
    from private.landing_lead_attempts a
    where a.organization_id = v_org
      and a.client_key = v_client_key
      and a.created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Você enviou muitos contatos em pouco tempo. Aguarde alguns minutos e tente de novo.'
      using errcode = '54000', detail = 'client_key';
  end if;

  -- Nonce consumido só quando o envio é aceito.
  insert into private.capture_request_nonces (nonce_hash)
  values (encode(extensions.digest(p_nonce, 'sha256'), 'hex'))
  on conflict (nonce_hash) do nothing;

  if not found then
    raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
  end if;

  insert into public.leads (
    organization_id, name, email, phone, message, interest, source, property_id, stage,
    utm, click_ids, landing_url, referrer, event_id, consent_at
  )
  values (
    v_org, v_name, v_email, v_phone, v_message, v_interest, 'website', v_property_id, 'new',
    v_utm, v_click_ids, v_landing_url, v_referrer, v_event_id, now()
  )
  on conflict (organization_id, event_id) where event_id is not null do nothing;

  insert into private.landing_lead_attempts (organization_id, client_key)
  values (v_org, v_client_key);

  -- Limpeza em lotes, sem esperar travas de outras transações.
  delete from private.landing_lead_attempts a
  where a.id in (
    select b.id
    from private.landing_lead_attempts b
    where b.created_at < now() - interval '1 day'
    order by b.created_at
    limit 1000
    for update skip locked
  );

  delete from private.capture_request_nonces n
  where n.nonce_hash in (
    select c.nonce_hash
    from private.capture_request_nonces c
    where c.created_at < now() - interval '12 hours'
    order by c.created_at
    limit 1000
    for update skip locked
  );
end;
$$;

comment on function public.submit_property_lead(text, text, jsonb, text, text, text) is
  'Formulário de interesse da página pública do imóvel: cria lead (source website, property_id do '
  'imóvel ATIVO) com a chave do servidor (Vault lead_server_key), nonce, consentimento LGPD e os '
  'mesmos limites de envio das landing pages. EXECUTE só para anon.';

revoke all on function public.submit_property_lead(text, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_property_lead(text, text, jsonb, text, text, text) to anon;
