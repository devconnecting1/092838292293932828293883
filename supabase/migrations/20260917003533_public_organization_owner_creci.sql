-- =============================================================================
-- CRECI F do dono na página pública da imobiliária
-- =============================================================================
-- Corretor autônomo (pessoa física) não tem CRECI J: o registro dele fica em
-- profiles.creci_number/creci_state. A captação pública (/captar/[slug]) e a
-- página de privacidade das landing pages só liam organizations.creci e, para
-- essas contas, saíam sem CRECI nenhum.
--
-- get_public_organization passa a devolver também o CRECI F do dono
-- (owner_creci_number e owner_creci_state), SÓ quando a imobiliária não tem
-- CRECI J preenchido. Nenhum outro dado do perfil (nome, telefone, e-mail,
-- foto, validade) sai. O CRECI é o registro profissional que a lei manda
-- informar na publicidade imobiliária.
--
-- Dono: membro ativo com papel owner e CRECI preenchido; havendo mais de um,
-- vale o mais antigo na imobiliária.

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
    'brand', o.brand,
    'owner_creci_number', dono.creci_number,
    'owner_creci_state', dono.creci_state
  )
  from public.organizations o
  left join lateral (
    select btrim(pr.creci_number) as creci_number, pr.creci_state
    from public.memberships m
    join public.profiles pr on pr.id = m.user_id
    where m.organization_id = o.id
      and m.role = 'owner'
      and m.active
      and nullif(btrim(coalesce(o.creci, '')), '') is null
      and nullif(btrim(coalesce(pr.creci_number, '')), '') is not null
    order by m.created_at, m.user_id
    limit 1
  ) dono on true
  where o.slug = lower(btrim(coalesce(p_slug, '')));
$$;

comment on function public.get_public_organization(text) is
  'Dados de exibição da imobiliária para as páginas públicas (captação e privacidade das landing pages): nome, cidade, UF, telefone, e-mail, CRECI J e marca. Sem CRECI J, devolve o CRECI F do dono (owner_creci_number e owner_creci_state) e nenhum outro dado do perfil. null se o slug não existir.';

revoke all on function public.get_public_organization(text) from public;
grant execute on function public.get_public_organization(text) to anon, authenticated;
