-- =============================================================================
-- Perfil público da imobiliária (formulário de captação /captar/[slug])
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RPC pública: dados de exibição da imobiliária para visitantes anônimos
-- -----------------------------------------------------------------------------
-- Usada pelo formulário público de captação. Retorna só os campos de exibição
-- (sem id, cnpj, feed_token ou created_by); null se o slug não existir.
create or replace function public.get_public_organization(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', o.name,
    'city', o.city,
    'state', o.state,
    'phone', o.phone,
    'email', o.email,
    'creci', o.creci,
    'brand', o.brand
  )
  from public.organizations o
  where o.slug = lower(btrim(coalesce(p_slug, '')));
$$;

revoke all on function public.get_public_organization(text) from public;
grant execute on function public.get_public_organization(text) to anon, authenticated;
