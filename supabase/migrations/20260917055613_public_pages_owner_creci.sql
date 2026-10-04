-- =============================================================================
-- CRECI F do dono na landing page e na página pública do imóvel
-- =============================================================================
-- A migração public_organization_owner_creci resolveu o corretor autônomo
-- (sem CRECI J) na captação e na privacidade das landing pages, via
-- get_public_organization. O rodapé e os selos da landing page
-- (get_public_landing_page) e a página pública do imóvel (get_public_property)
-- continuavam lendo só organizations.creci e saíam sem CRECI nenhum.
--
--  1. private.public_owner_creci(organization_id): a mesma regra de
--     get_public_organization num lugar só — CRECI F (número aparado e UF) do
--     dono ativo mais antigo com CRECI preenchido, e SÓ quando a imobiliária
--     não tem CRECI J. Nenhum outro dado do perfil (nome, telefone, e-mail,
--     foto, validade). Não é exposta: só as funções públicas abaixo a chamam.
--  2. get_public_landing_page e get_public_property: o objeto "organization"
--     ganha owner_creci_number e owner_creci_state (null quando há CRECI J ou
--     não há dono com CRECI). O resto do corpo, os grants e o comportamento
--     não mudam. O CRECI é o registro profissional que a lei manda informar
--     na publicidade imobiliária.

-- -----------------------------------------------------------------------------
-- 1. Regra do CRECI F do dono
-- -----------------------------------------------------------------------------
create or replace function private.public_owner_creci(p_organization_id uuid)
returns table (creci_number text, creci_state text)
language sql
stable
set search_path = ''
as $$
  select btrim(pr.creci_number), pr.creci_state
  from public.organizations o
  join public.memberships m
    on m.organization_id = o.id
   and m.role = 'owner'
   and m.active
  join public.profiles pr on pr.id = m.user_id
  where o.id = p_organization_id
    and nullif(btrim(coalesce(o.creci, '')), '') is null
    and nullif(btrim(coalesce(pr.creci_number, '')), '') is not null
  order by m.created_at, m.user_id
  limit 1;
$$;

comment on function private.public_owner_creci(uuid) is
  'CRECI F (número aparado e UF) do dono ativo mais antigo com CRECI preenchido, só quando a imobiliária não tem CRECI J. Zero linhas caso contrário. Usada por get_public_landing_page e get_public_property; nenhum outro dado do perfil sai.';

revoke all on function private.public_owner_creci(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2.1 Landing page pública
-- -----------------------------------------------------------------------------
create or replace function public.get_public_landing_page(p_org_slug text, p_page_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_org jsonb;
  v_page public.landing_pages%rowtype;
  v_broker jsonb;
begin
  if p_org_slug is null or p_page_slug is null then
    return null;
  end if;

  select
    o.id,
    jsonb_build_object(
      'name', o.name,
      'city', o.city,
      'state', o.state,
      'phone', o.phone,
      'email', o.email,
      'creci', o.creci,
      'brand', o.brand,
      'owner_creci_number', dono.creci_number,
      'owner_creci_state', dono.creci_state
    )
    into v_org_id, v_org
  from public.organizations o
  left join lateral private.public_owner_creci(o.id) dono on true
  where o.slug = lower(btrim(p_org_slug));

  if v_org_id is null then
    return null;
  end if;

  select lp.* into v_page
  from public.landing_pages lp
  where lp.organization_id = v_org_id
    and lp.slug = lower(btrim(p_page_slug))
    and lp.status = 'published';

  if not found then
    return null;
  end if;

  if v_page.template = 'portfolio_broker' and v_page.lead_assignee_id is not null then
    select jsonb_build_object(
      'full_name', pr.full_name,
      'creci_number', pr.creci_number,
      'creci_state', pr.creci_state,
      'avatar_url', pr.avatar_url,
      'phone', pr.phone
    )
      into v_broker
    from public.profiles pr
    join public.memberships m
      on m.user_id = pr.id
     and m.organization_id = v_org_id
     and m.active
    where pr.id = v_page.lead_assignee_id;
  end if;

  return jsonb_build_object(
    'page', jsonb_build_object(
      'id', v_page.id,
      'template', v_page.template,
      'slug', v_page.slug,
      'name', v_page.name,
      'theme', v_page.theme,
      'content', v_page.content,
      'tracking', v_page.tracking,
      'seo', v_page.seo,
      'published_at', v_page.published_at
    ),
    'organization', v_org,
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'code', p.code,
          'title', p.title,
          'purpose', p.purpose,
          'type', p.type,
          'sale_price', p.sale_price,
          'rent_price', p.rent_price,
          'condo_fee', p.condo_fee,
          'living_area', p.living_area,
          'lot_area', p.lot_area,
          'bedrooms', p.bedrooms,
          'suites', p.suites,
          'bathrooms', p.bathrooms,
          'parking_spaces', p.parking_spaces,
          'neighborhood', p.neighborhood,
          'city', p.city,
          'state', p.state,
          'features', p.features,
          'cover_path', (
            select m.storage_path
            from public.property_media m
            where m.organization_id = p.organization_id
              and m.property_id = p.id
              and m.kind = 'image'
            order by m.is_cover desc, m.position, m.created_at, m.id
            limit 1
          ),
          'media_paths', coalesce((
            select jsonb_agg(x.storage_path order by x.position, x.created_at, x.id)
            from (
              select m.storage_path, m.position, m.created_at, m.id
              from public.property_media m
              where m.organization_id = p.organization_id
                and m.property_id = p.id
                and m.kind = 'image'
              order by m.position, m.created_at, m.id
              limit 6
            ) as x
          ), '[]'::jsonb)
        )
        order by u.ord
      )
      from unnest(v_page.property_ids) with ordinality as u (property_id, ord)
      join public.properties p
        on p.organization_id = v_page.organization_id
       and p.id = u.property_id
      where p.status = 'active'
        and not p.is_restricted
    ), '[]'::jsonb),
    'broker', v_broker
  );
end;
$$;

comment on function public.get_public_landing_page(text, text) is
  'Landing page publicada pelo par de slugs: página, imobiliária (nome, cidade, UF, telefone, e-mail, CRECI J, marca e, sem CRECI J, o CRECI F do dono em owner_creci_number/owner_creci_state), imóveis ativos e não restritos da página e o corretor do modelo portfolio_broker. null se não existir ou não estiver publicada.';

-- -----------------------------------------------------------------------------
-- 2.2 Página pública do imóvel
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
      'brand', o.brand,
      'owner_creci_number', dono.creci_number,
      'owner_creci_state', dono.creci_state
    )
    into v_org_id, v_org
  from public.organizations o
  left join lateral private.public_owner_creci(o.id) dono on true
  where o.slug = lower(btrim(p_org_slug));

  if v_org_id is null then
    return null;
  end if;

  select p.* into v_property
  from public.properties p
  where p.organization_id = v_org_id
    and p.code = v_code
    and p.status = 'active'
    and not p.is_restricted;

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
  'Página pública do imóvel: um imóvel ATIVO da imobiliária do slug, só com campos de anúncio (sem proprietário, chaves, CEP, complemento, coordenadas; rua/número conforme address_display). A imobiliária sai com CRECI J e, sem ele, o CRECI F do dono (owner_creci_number/owner_creci_state), sem nenhum outro dado do perfil. null para inexistente, inativo ou de outra imobiliária. EXECUTE só para anon.';
