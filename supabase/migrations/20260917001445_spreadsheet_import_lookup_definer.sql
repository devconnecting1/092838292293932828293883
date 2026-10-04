-- =============================================================================
-- Importação de planilhas: busca de duplicados usando os índices
-- =============================================================================
-- Com RLS, o Postgres não usa os índices de expressão
-- (right(regexp_replace(phone)), lower(btrim(email))) antes da policy, porque
-- essas funções não são leakproof: cada busca virava varredura da tabela com
-- private.can_access_client_row() por linha (~120 ms com 2.000 clientes), e um
-- lote de 200 linhas passava do statement_timeout de 8 s do PostgREST.
--
-- As três buscas passam a rodar como SECURITY DEFINER, presas à imobiliária e
-- só para dono e gerente (os mesmos papéis que enxergam tudo pela RLS). Elas
-- devolvem apenas o id do registro existente; a gravação (INSERT/UPDATE)
-- continua com a sessão e a RLS de quem importa.
create or replace function private.import_find_client(
  p_organization_id uuid,
  p_document text,
  p_email text,
  p_phone_keys text[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_organization_id is null or not private.has_role(p_organization_id, '{owner,manager}') then
    return null;
  end if;

  if p_document is not null then
    select c.id into v_id
    from public.clients c
    where c.organization_id = p_organization_id
      and c.document = p_document;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  if p_email is not null then
    select c.id into v_id
    from public.clients c
    where c.organization_id = p_organization_id
      and lower(btrim(c.email)) = p_email
    order by c.created_at
    limit 1;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  if coalesce(cardinality(p_phone_keys), 0) > 0 then
    select c.id into v_id
    from public.clients c
    where c.organization_id = p_organization_id
      and (
        right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 11) = any (p_phone_keys)
        or right(regexp_replace(c.whatsapp, '[^0-9]', '', 'g'), 11) = any (p_phone_keys)
      )
    order by c.created_at
    limit 1;
  end if;

  return v_id;
end;
$$;

create or replace function private.import_find_lead(
  p_organization_id uuid,
  p_email text,
  p_phone text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_organization_id is null or not private.has_role(p_organization_id, '{owner,manager}') then
    return null;
  end if;

  if p_phone is not null then
    select l.id into v_id
    from public.leads l
    where l.organization_id = p_organization_id
      and right(l.phone, 11) = right(p_phone, 11)
    order by l.created_at
    limit 1;

    if v_id is not null then
      return v_id;
    end if;
  end if;

  if p_email is not null then
    select l.id into v_id
    from public.leads l
    where l.organization_id = p_organization_id
      and lower(l.email) = p_email
    order by l.created_at
    limit 1;
  end if;

  return v_id;
end;
$$;

create or replace function private.import_find_property(p_organization_id uuid, p_row jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code constant text := private.import_text(p_row, 'external_code');
begin
  if p_organization_id is null or not private.has_role(p_organization_id, '{owner,manager}') then
    return null;
  end if;

  if v_code is not null then
    select p.id into v_id
    from public.properties p
    where p.organization_id = p_organization_id
      and p.external_code = v_code;

    return v_id;
  end if;

  select p.id into v_id
  from public.properties p
  where p.organization_id = p_organization_id
    and p.type::text = private.import_text(p_row, 'type')
    and p.purpose::text = private.import_text(p_row, 'purpose')
    and lower(p.title) = lower(coalesce(private.import_text(p_row, 'title'), ''))
    and lower(coalesce(p.street, '')) = lower(coalesce(private.import_text(p_row, 'street'), ''))
    and lower(coalesce(p.street_number, '')) = lower(coalesce(private.import_text(p_row, 'street_number'), ''))
    and lower(coalesce(p.complement, '')) = lower(coalesce(private.import_text(p_row, 'complement'), ''))
    and lower(coalesce(p.neighborhood, '')) = lower(coalesce(private.import_text(p_row, 'neighborhood'), ''))
    and lower(coalesce(p.city, '')) = lower(coalesce(private.import_text(p_row, 'city'), ''))
  order by p.created_at
  limit 1;

  return v_id;
end;
$$;

revoke all on function private.import_find_client(uuid, text, text, text[]) from public, anon;
revoke all on function private.import_find_lead(uuid, text, text) from public, anon;
revoke all on function private.import_find_property(uuid, jsonb) from public, anon;
grant execute on function private.import_find_client(uuid, text, text, text[]) to authenticated;
grant execute on function private.import_find_lead(uuid, text, text) to authenticated;
grant execute on function private.import_find_property(uuid, jsonb) to authenticated;

comment on function private.import_find_client(uuid, text, text, text[]) is
  'Cliente existente por CPF/CNPJ, depois e-mail, depois telefone ou WhatsApp (últimos 11 dígitos). SECURITY DEFINER para usar os índices de expressão; só dono e gerente da imobiliária; devolve só o id.';
comment on function private.import_find_lead(uuid, text, text) is
  'Lead existente por telefone (últimos 11 dígitos) ou e-mail. SECURITY DEFINER para usar os índices; só dono e gerente da imobiliária; devolve só o id.';
comment on function private.import_find_property(uuid, jsonb) is
  'Imóvel existente pelo código de referência do sistema anterior ou, sem código, por tipo, finalidade, título e endereço. Só dono e gerente da imobiliária; devolve só o id.';
