-- =============================================================================
-- 1410 - Assinatura: modo leitura no feed dos portais e nos uploads do Storage
-- =============================================================================
-- Completa o modo leitura de billing_accounts (estado read_only de
-- private.billing_state). Em trialing, active e grace nada muda.
--  1. get_portal_feed: em read_only o feed PAUSA com erro P0001
--     "assinatura_somente_leitura" (detail "portal_feed"), levantado só depois de
--     slug e token conferirem. O app já responde 503 + Retry-After a qualquer erro
--     da RPC. Não devolvemos XML com <Listings> vazio: o VRSync é carga completa
--     e um feed vazio tende a desativar todos os anúncios no portal; com erro
--     temporário o portal mantém a última carga válida.
--  2. Storage: INSERT e UPDATE com sessão bloqueados em read_only nos buckets
--     property-media, client-documents e landing-assets (condição acrescentada
--     às políticas existentes; o 1º segmento do caminho é o organization_id em
--     todos eles). SELECT e DELETE continuam permitidos.
-- Landing pages públicas e captação pública não mudam.

-- -----------------------------------------------------------------------------
-- 1. get_portal_feed (corpo igual ao de security_hardening_2 + pausa em read_only)
-- -----------------------------------------------------------------------------
create or replace function public.get_portal_feed(p_org_slug text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_org jsonb;
begin
  if p_org_slug is null or p_token is null or char_length(p_token) <> 48 then
    return null;
  end if;

  select
    o.id,
    jsonb_build_object(
      'id', o.id,
      'slug', o.slug,
      'name', o.name,
      'legal_name', o.legal_name,
      'creci', o.creci,
      'email', o.email,
      'phone', o.phone,
      'city', o.city,
      'state', o.state,
      'brand', o.brand
    )
    into v_org_id, v_org
  from public.organizations o
  where o.slug = lower(btrim(p_org_slug))
    and o.feed_token = p_token;

  if v_org_id is null then
    return null;
  end if;

  -- Modo leitura: feed pausado. Só depois de slug e token conferirem, para não
  -- revelar o estado da assinatura a quem não tem o endereço do feed.
  if private.billing_state(v_org_id) = 'read_only' then
    raise exception 'assinatura_somente_leitura'
      using errcode = 'P0001', detail = 'portal_feed';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'organization', v_org,
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'code', p.code,
          'title', p.title,
          'description', p.description,
          'purpose', p.purpose,
          'usage', p.usage,
          'type', p.type,
          'status', p.status,
          'sale_price', p.sale_price,
          'rent_price', p.rent_price,
          'condo_fee', p.condo_fee,
          'iptu_yearly', p.iptu_yearly,
          'living_area', p.living_area,
          'lot_area', p.lot_area,
          'bedrooms', p.bedrooms,
          'bathrooms', p.bathrooms,
          'suites', p.suites,
          'parking_spaces', p.parking_spaces,
          'floor', p.floor,
          'total_floors', p.total_floors,
          'year_built', p.year_built,
          'features', p.features,
          'furnished', p.furnished,
          'accepts_pets', p.accepts_pets,
          'accepts_exchange', p.accepts_exchange,
          'postal_code', p.postal_code,
          'street', p.street,
          'street_number', p.street_number,
          'complement', p.complement,
          'neighborhood', p.neighborhood,
          'city', p.city,
          'state', p.state,
          'latitude', p.latitude,
          'longitude', p.longitude,
          'address_display', p.address_display,
          'condominium_name', cd.name,
          'published_at', p.published_at,
          'updated_at', p.updated_at,
          'media', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'kind', m.kind,
                'storage_path', m.storage_path,
                'external_url', m.external_url,
                'is_cover', m.is_cover,
                'caption', m.caption,
                'position', m.position
              )
              order by m.position, m.created_at, m.id
            )
            from public.property_media m
            where m.organization_id = p.organization_id
              and m.property_id = p.id
          ), '[]'::jsonb)
        )
        - (
          case p.address_display
            when 'full' then '{}'::text[]
            when 'street' then array['street_number', 'complement', 'latitude', 'longitude']
            else array['street', 'street_number', 'complement', 'latitude', 'longitude']
          end
        )
        order by p.code
      )
      from public.properties p
      left join public.condominiums cd
        on cd.organization_id = p.organization_id
       and cd.id = p.condominium_id
      where p.organization_id = v_org_id
        and p.status = 'active'
        and p.published_to_portals
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_portal_feed(text, text) from public;
grant execute on function public.get_portal_feed(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Storage: uploads bloqueados em read_only
-- -----------------------------------------------------------------------------
-- As políticas rodam com o papel authenticated, que não executa
-- private.billing_state (nem deve). Este helper precisa de EXECUTE para
-- authenticated e só responde true para membro ativo da imobiliária fora do
-- modo leitura: não membro recebe false sem consultar a assinatura, então ele
-- não revela nada além do que o membro já lê em get_billing_overview.
-- Organização nula (caminho sem uuid no 1º segmento) = false.
create or replace function private.storage_org_writable(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_org is not null
    and private.is_member(p_org)
    and private.billing_state(p_org) <> 'read_only',
    false
  );
$$;

revoke all on function private.storage_org_writable(uuid) from public, anon, authenticated;
grant execute on function private.storage_org_writable(uuid) to authenticated;

-- property-media: {organization_id}/properties/{property_id}/{arquivo}
alter policy "property-media: quem edita o imóvel envia"
  on storage.objects
  with check (
    bucket_id = 'property-media'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_edit_property(storage.foldername(name))
    and private.storage_org_writable(private.try_uuid((storage.foldername(name))[1]))
  );

alter policy "property-media: quem edita o imóvel substitui"
  on storage.objects
  using (
    bucket_id = 'property-media'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_edit_property(storage.foldername(name))
    and private.storage_org_writable(private.try_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'property-media'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_edit_property(storage.foldername(name))
    and private.storage_org_writable(private.try_uuid((storage.foldername(name))[1]))
  );

-- client-documents: {organization_id}/clients/{client_id}/{arquivo} (sem política de UPDATE)
alter policy "client-documents: quem edita o cliente envia"
  on storage.objects
  with check (
    bucket_id = 'client-documents'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and private.storage_can_access_client(storage.foldername(name), true)
    and private.storage_org_writable(private.try_uuid((storage.foldername(name))[1]))
  );

-- landing-assets: {organization_id}/landing/{page_id}/{uuid}.{ext}
alter policy "landing-assets: dono, gerente e assistente enviam"
  on storage.objects
  with check (
    bucket_id = 'landing-assets'
    and private.storage_can_manage_landing_asset(name)
    and private.storage_org_writable(private.try_uuid((storage.foldername(name))[1]))
  );

alter policy "landing-assets: dono, gerente e assistente substituem"
  on storage.objects
  using (
    bucket_id = 'landing-assets'
    and private.storage_can_manage_landing_asset(name)
    and private.storage_org_writable(private.try_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'landing-assets'
    and private.storage_can_manage_landing_asset(name)
    and private.storage_org_writable(private.try_uuid((storage.foldername(name))[1]))
  );
