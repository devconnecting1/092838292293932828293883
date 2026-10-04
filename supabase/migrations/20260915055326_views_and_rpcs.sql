-- =============================================================================
-- 0700 - View de match cliente x imóvel e RPCs públicas
-- =============================================================================

-- -----------------------------------------------------------------------------
-- client_property_matches
-- -----------------------------------------------------------------------------
-- security_invoker = true: a view respeita o RLS de quem consulta (um corretor
-- só vê matches de clientes a que tem acesso).
create view public.client_property_matches
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
  and (ci.city is null or lower(btrim(p.city)) = lower(btrim(ci.city)))
  and (
    cardinality(ci.neighborhoods) = 0
    or lower(btrim(p.neighborhood)) in (select lower(btrim(n)) from unnest(ci.neighborhoods) as n)
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
-- RPC pública: formulário de captação (anon)
-- -----------------------------------------------------------------------------
-- payload esperado (jsonb):
--   owner_name (obrigatório), owner_email e/ou owner_phone (ao menos um),
--   purpose (sale|rent|sale_rent, obrigatório), type, postal_code, neighborhood,
--   city, state, expected_price, message, consent (true, obrigatório - LGPD)
create or replace function public.submit_capture_request(org_slug text, payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_purpose text;
  v_type text;
  v_postal text;
  v_neighborhood text;
  v_city text;
  v_state text;
  v_price_text text;
  v_price numeric(14, 2);
  v_message text;
  v_id uuid;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Dados do formulário inválidos.' using errcode = '22023';
  end if;

  if octet_length(payload::text) > 16384 then
    raise exception 'Formulário grande demais.' using errcode = '22023';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.slug = lower(btrim(coalesce(org_slug, '')));

  if v_org is null then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  -- Proteção simples contra abuso (a interface deve usar captcha também).
  if (
    select count(*)
    from public.capture_requests cr
    where cr.organization_id = v_org
      and cr.created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'Muitas solicitações em pouco tempo. Tente novamente em instantes.'
      using errcode = '54000';
  end if;

  v_name := btrim(coalesce(payload ->> 'owner_name', ''));
  v_email := nullif(lower(btrim(coalesce(payload ->> 'owner_email', ''))), '');
  v_phone := nullif(regexp_replace(coalesce(payload ->> 'owner_phone', ''), '[^0-9]', '', 'g'), '');
  v_purpose := nullif(btrim(coalesce(payload ->> 'purpose', '')), '');
  v_type := nullif(btrim(coalesce(payload ->> 'type', '')), '');
  v_postal := nullif(regexp_replace(coalesce(payload ->> 'postal_code', ''), '[^0-9]', '', 'g'), '');
  v_neighborhood := nullif(btrim(coalesce(payload ->> 'neighborhood', '')), '');
  v_city := nullif(btrim(coalesce(payload ->> 'city', '')), '');
  v_state := nullif(upper(btrim(coalesce(payload ->> 'state', ''))), '');
  v_price_text := nullif(btrim(coalesce(payload ->> 'expected_price', '')), '');
  v_message := nullif(btrim(coalesce(payload ->> 'message', '')), '');

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Informe seu nome (2 a 120 caracteres).' using errcode = '22023';
  end if;

  if v_email is null and v_phone is null then
    raise exception 'Informe um e-mail ou telefone para contato.' using errcode = '22023';
  end if;

  if v_email is not null
     and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'E-mail inválido.' using errcode = '22023';
  end if;

  if v_phone is not null and v_phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido: informe DDD e número.' using errcode = '22023';
  end if;

  if v_purpose is null
     or not (v_purpose = any (enum_range(null::public.listing_purpose)::text[])) then
    raise exception 'Finalidade inválida.' using errcode = '22023';
  end if;

  if v_type is not null
     and not (v_type = any (enum_range(null::public.property_type)::text[])) then
    raise exception 'Tipo de imóvel inválido.' using errcode = '22023';
  end if;

  if v_postal is not null and v_postal !~ '^[0-9]{8}$' then
    raise exception 'CEP inválido.' using errcode = '22023';
  end if;

  if char_length(v_neighborhood) > 120 or char_length(v_city) > 120 then
    raise exception 'Bairro ou cidade longos demais.' using errcode = '22023';
  end if;

  if v_state is not null and v_state !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida.' using errcode = '22023';
  end if;

  if v_price_text is not null then
    if v_price_text !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
      raise exception 'Valor pretendido inválido.' using errcode = '22023';
    end if;
    v_price := v_price_text::numeric(14, 2);
  end if;

  if char_length(v_message) > 2000 then
    raise exception 'Mensagem longa demais (máximo 2.000 caracteres).' using errcode = '22023';
  end if;

  if lower(coalesce(payload ->> 'consent', '')) <> 'true' then
    raise exception 'É necessário aceitar o uso dos dados para contato (LGPD).'
      using errcode = '22023';
  end if;

  insert into public.capture_requests (
    organization_id, owner_name, owner_email, owner_phone, purpose, type,
    postal_code, neighborhood, city, state, expected_price, message, consent_at
  )
  values (
    v_org, v_name, v_email, v_phone, v_purpose::public.listing_purpose,
    v_type::public.property_type, v_postal, v_neighborhood, v_city, v_state,
    v_price, v_message, now()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_capture_request(text, jsonb) from public;
grant execute on function public.submit_capture_request(text, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- RPC: registrar acesso a dado sensível (LGPD - "quem viu o quê")
-- -----------------------------------------------------------------------------
-- Alterações já são registradas por trigger; leituras precisam ser registradas
-- pelo app ao abrir a ficha do cliente, baixar documento ou exportar dados.
create or replace function public.log_access_event(
  p_entity text,
  p_entity_id uuid,
  p_action text default 'view'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_allowed boolean := false;
begin
  if v_user is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('view', 'download', 'export', 'print') then
    raise exception 'Ação inválida.' using errcode = '22023';
  end if;

  case p_entity
    when 'clients' then
      select c.organization_id, private.can_access_client(c.id)
        into v_org, v_allowed
      from public.clients c where c.id = p_entity_id;
    when 'client_documents' then
      select d.organization_id, private.can_access_client(d.client_id)
        into v_org, v_allowed
      from public.client_documents d where d.id = p_entity_id;
    when 'properties' then
      select p.organization_id, private.is_member(p.organization_id)
        into v_org, v_allowed
      from public.properties p where p.id = p_entity_id;
    else
      raise exception 'Entidade inválida.' using errcode = '22023';
  end case;

  if v_org is null or not coalesce(v_allowed, false) then
    raise exception 'Registro não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id)
  values (v_org, v_user, p_action, p_entity, p_entity_id);
end;
$$;

revoke all on function public.log_access_event(text, uuid, text) from public, anon;
grant execute on function public.log_access_event(text, uuid, text) to authenticated;
