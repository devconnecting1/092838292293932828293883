-- =============================================================================
-- Medidor de imóveis com foto na tela de assinatura
-- =============================================================================
-- Configurações > Assinatura passa a mostrar "Imóveis com foto: X de N". O
-- número precisa ser EXATAMENTE o que o gatilho a0_billing_owned_listings usa
-- para barrar: por isso esta RPC não reconta nada e só devolve
-- private.owned_listing_count(). Se a regra da contagem mudar (por exemplo,
-- imóvel vendido, alugado ou inativo deixar de contar), a tela acompanha sem
-- mudar código.
--
-- Duas camadas, para não expor função security definer no schema da API:
--   · private.owned_listing_usage(uuid)    security definer. Exige sessão e
--     vínculo ativo com a imobiliária e devolve só o número dela;
--   · public.get_owned_listing_usage(uuid) security invoker. É a RPC que o app
--     chama; só repassa para a função privada.

create or replace function private.owned_listing_usage(p_organization_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.is_member(p_organization_id) then
    raise exception 'Você não tem acesso a esta imobiliária.' using errcode = '42501';
  end if;

  return coalesce(private.owned_listing_count(p_organization_id), 0);
end;
$$;

revoke all on function private.owned_listing_usage(uuid) from public, anon, authenticated;
grant execute on function private.owned_listing_usage(uuid) to authenticated;

comment on function private.owned_listing_usage(uuid) is
  'Imóveis com foto hospedada por nós que contam no limite owned_listings da imobiliária. Só para membro ativo (senão 42501). Usa private.owned_listing_count, a mesma contagem do gatilho a0_billing_owned_listings.';

create or replace function public.get_owned_listing_usage(p_organization_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select private.owned_listing_usage(p_organization_id);
$$;

revoke all on function public.get_owned_listing_usage(uuid) from public, anon, authenticated;
grant execute on function public.get_owned_listing_usage(uuid) to authenticated;

comment on function public.get_owned_listing_usage(uuid) is
  'RPC do medidor "Imóveis com foto" em Configurações > Assinatura. Security invoker: repassa para private.owned_listing_usage, que confere a sessão e o vínculo.';
