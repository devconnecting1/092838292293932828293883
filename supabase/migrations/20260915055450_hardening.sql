-- =============================================================================
-- 1000 - Endurecimento: convites, validação de membros, unaccent no match e
--        feed dos portais sem service_role
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. invitations: só dono e gerente leem (o token não fica visível à equipe)
-- -----------------------------------------------------------------------------
drop policy if exists "invitations: membros leem" on public.invitations;

create policy "invitations: dono e gerente leem"
  on public.invitations for select to authenticated
  using (private.has_role(organization_id, '{owner,manager}'));

-- -----------------------------------------------------------------------------
-- 2. Usuários referenciados precisam ser membros ATIVOS da mesma imobiliária
-- -----------------------------------------------------------------------------
-- Argumentos do trigger em pares: (coluna, rótulo usado na mensagem de erro).
-- No UPDATE, só valida as colunas que mudaram (desativar um membro não trava
-- a edição de registros antigos que apontam para ele).
create or replace function private.validate_member_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_org uuid := (to_jsonb(new) ->> 'organization_id')::uuid;
  v_user uuid;
  i integer := 0;
begin
  while i < tg_nargs loop
    v_user := (v_new ->> tg_argv[i])::uuid;

    if v_user is not null
       and (tg_op = 'INSERT' or (v_old ->> tg_argv[i]) is distinct from (v_new ->> tg_argv[i]))
       and not exists (
         select 1
         from public.memberships m
         where m.organization_id = v_org
           and m.user_id = v_user
           and m.active
       ) then
      raise exception '% precisa ser um membro ativo desta imobiliária.', tg_argv[i + 1]
        using errcode = '23514',
              detail = format('%s.%s', tg_table_name, tg_argv[i]);
    end if;

    i := i + 2;
  end loop;

  return new;
end;
$$;

revoke all on function private.validate_member_columns() from public;

-- Os nomes "*_validate_members" ordenam depois dos triggers que preenchem
-- captured_by/assigned_to automaticamente (triggers BEFORE rodam em ordem alfabética).
create trigger properties_validate_members
  before insert or update of broker_id, captured_by on public.properties
  for each row execute function private.validate_member_columns(
    'broker_id', 'O corretor responsável',
    'captured_by', 'O captador'
  );

create trigger clients_validate_members
  before insert or update of assigned_to on public.clients
  for each row execute function private.validate_member_columns(
    'assigned_to', 'O corretor responsável'
  );

create trigger appointments_validate_members
  before insert or update of broker_id on public.appointments
  for each row execute function private.validate_member_columns(
    'broker_id', 'O corretor da visita'
  );

create trigger tasks_validate_members
  before insert or update of assignee_id on public.tasks
  for each row execute function private.validate_member_columns(
    'assignee_id', 'O responsável pela tarefa'
  );

create trigger proposals_validate_members
  before insert or update of broker_id on public.proposals
  for each row execute function private.validate_member_columns(
    'broker_id', 'O corretor da proposta'
  );

create trigger client_shares_validate_members
  before insert or update of user_id on public.client_shares
  for each row execute function private.validate_member_columns(
    'user_id', 'O colega que recebe o compartilhamento'
  );

-- -----------------------------------------------------------------------------
-- 3. Match sem diferenciar acentos (Cambuí = cambui)
-- -----------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

create or replace view public.client_property_matches
with (security_invoker = true)
as
select
  ci.organization_id,
  ci.id as client_interest_id,
  ci.client_id,
  c.name as client_name,
  c.assigned_to as client_assigned_to,
  ci.purpose as interest_purpose,
  p.id as property_id,
  p.code as property_code,
  p.title as property_title,
  p.type as property_type,
  p.purpose as property_purpose,
  p.sale_price,
  p.rent_price,
  p.bedrooms,
  p.parking_spaces,
  p.neighborhood,
  p.city,
  p.imob_score
from public.client_interests ci
join public.clients c
  on c.organization_id = ci.organization_id
 and c.id = ci.client_id
join public.properties p
  on p.organization_id = ci.organization_id
where ci.active
  and p.status = 'active'
  -- finalidade compatível (sale_rent casa com venda e com locação)
  and (ci.purpose = 'sale_rent' or p.purpose = 'sale_rent' or p.purpose = ci.purpose)
  -- tipo (lista vazia = qualquer tipo)
  and (cardinality(ci.types) = 0 or p.type = any (ci.types))
  and (ci.min_bedrooms is null or coalesce(p.bedrooms, 0) >= ci.min_bedrooms)
  and (ci.min_parking is null or coalesce(p.parking_spaces, 0) >= ci.min_parking)
  and (
    ci.city is null
    or extensions.unaccent(lower(btrim(p.city))) = extensions.unaccent(lower(btrim(ci.city)))
  )
  and (
    cardinality(ci.neighborhoods) = 0
    or extensions.unaccent(lower(btrim(p.neighborhood))) in (
      select extensions.unaccent(lower(btrim(n)))
      from unnest(ci.neighborhoods) as n
    )
  )
  -- preço na faixa, usando o preço da finalidade buscada
  and (
    (ci.min_price is null and ci.max_price is null)
    or exists (
      select 1
      from (
        values
          (case when ci.purpose in ('sale', 'sale_rent') and p.purpose in ('sale', 'sale_rent') then p.sale_price end),
          (case when ci.purpose in ('rent', 'sale_rent') and p.purpose in ('rent', 'sale_rent') then p.rent_price end)
      ) as v (price)
      where v.price is not null
        and (ci.min_price is null or v.price >= ci.min_price)
        and (ci.max_price is null or v.price <= ci.max_price)
    )
  );

revoke all on public.client_property_matches from anon, authenticated;
grant select on public.client_property_matches to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Feed dos portais (VRSync) sem service_role
-- -----------------------------------------------------------------------------
-- O token vai na URL do feed cadastrada nos portais. Membros conseguem lê-lo
-- (a tela de configurações mostra a URL), mas só o dono troca, via RPC.
create extension if not exists pgcrypto with schema extensions;

alter table public.organizations
  add column feed_token text not null
    default encode(extensions.gen_random_bytes(24), 'hex')
    constraint organizations_feed_token_format check (feed_token ~ '^[0-9a-f]{48}$')
    constraint organizations_feed_token_key unique;

-- (A permissão de UPDATE por coluna dada em 0600 não inclui feed_token.)

create or replace function public.rotate_feed_token(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if not private.has_role(p_organization_id, '{owner}') then
    raise exception 'Só o dono da imobiliária pode gerar um novo endereço de feed.'
      using errcode = '42501';
  end if;

  update public.organizations
  set feed_token = encode(extensions.gen_random_bytes(24), 'hex')
  where id = p_organization_id
  returning feed_token into v_token;

  return v_token;
end;
$$;

revoke all on function public.rotate_feed_token(uuid) from public, anon;
grant execute on function public.rotate_feed_token(uuid) to authenticated;

-- Retorna null para slug inexistente OU token errado (sem distinguir os casos).
create or replace function public.get_portal_feed(p_org_slug text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
begin
  if p_org_slug is null or p_token is null or char_length(p_token) <> 48 then
    return null;
  end if;

  select o.* into v_org
  from public.organizations o
  where o.slug = lower(btrim(p_org_slug))
    and o.feed_token = p_token;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'organization', jsonb_build_object(
      'id', v_org.id,
      'slug', v_org.slug,
      'name', v_org.name,
      'legal_name', v_org.legal_name,
      'creci', v_org.creci,
      'email', v_org.email,
      'phone', v_org.phone,
      'city', v_org.city,
      'state', v_org.state,
      'brand', v_org.brand
    ),
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
        order by p.code
      )
      from public.properties p
      left join public.condominiums cd
        on cd.organization_id = p.organization_id
       and cd.id = p.condominium_id
      where p.organization_id = v_org.id
        and p.status = 'active'
        and p.published_to_portals
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_portal_feed(text, text) from public;
grant execute on function public.get_portal_feed(text, text) to anon, authenticated;
