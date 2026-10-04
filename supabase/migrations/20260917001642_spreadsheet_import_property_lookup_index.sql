-- =============================================================================
-- Importação de planilhas: busca de imóvel sem código de referência por índice
-- =============================================================================
-- Medido: a prévia de 500 imóveis sem código contra 1.000 imóveis da
-- imobiliária levava ~8,3 s (varredura por linha, extraindo o jsonb a cada
-- imóvel comparado), no limite do statement_timeout do PostgREST.
--
-- 1. Índice por título em minúsculas dentro da imobiliária: o título é o campo
--    mais seletivo da "impressão digital" (tipo, finalidade, título, endereço).
-- 2. A função extrai os valores da linha uma vez só e compara com variáveis.
create index if not exists properties_organization_title_lower_idx
  on public.properties (organization_id, lower(title));

comment on index public.properties_organization_title_lower_idx is
  'Busca de imóvel já existente na importação de planilha (sem código de referência).';

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
  v_type constant text := private.import_text(p_row, 'type');
  v_purpose constant text := private.import_text(p_row, 'purpose');
  v_title constant text := lower(coalesce(private.import_text(p_row, 'title'), ''));
  v_street constant text := lower(coalesce(private.import_text(p_row, 'street'), ''));
  v_number constant text := lower(coalesce(private.import_text(p_row, 'street_number'), ''));
  v_complement constant text := lower(coalesce(private.import_text(p_row, 'complement'), ''));
  v_neighborhood constant text := lower(coalesce(private.import_text(p_row, 'neighborhood'), ''));
  v_city constant text := lower(coalesce(private.import_text(p_row, 'city'), ''));
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
    and lower(p.title) = v_title
    and p.type::text = v_type
    and p.purpose::text = v_purpose
    and lower(coalesce(p.street, '')) = v_street
    and lower(coalesce(p.street_number, '')) = v_number
    and lower(coalesce(p.complement, '')) = v_complement
    and lower(coalesce(p.neighborhood, '')) = v_neighborhood
    and lower(coalesce(p.city, '')) = v_city
  order by p.created_at
  limit 1;

  return v_id;
end;
$$;

revoke all on function private.import_find_property(uuid, jsonb) from public, anon;
grant execute on function private.import_find_property(uuid, jsonb) to authenticated;

comment on function private.import_find_property(uuid, jsonb) is
  'Imóvel existente pelo código de referência do sistema anterior ou, sem código, por tipo, finalidade, título e endereço (índice properties_organization_title_lower_idx). Só dono e gerente da imobiliária; devolve só o id.';
