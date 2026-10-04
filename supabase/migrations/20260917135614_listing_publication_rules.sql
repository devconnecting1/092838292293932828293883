-- =============================================================================
-- Anúncio no ar: autorização vigente, página pública desligável e medição
-- =============================================================================
-- 1. public.listing_publication_settings (por imobiliária): tirar do ar imóvel
--    com autorização vencida (padrão ligado), página pública ligada por padrão
--    e IDs do Meta Pixel e da tag do Google para a página pública do imóvel.
-- 2. properties.public_page_enabled: chave por imóvel (null = padrão da
--    imobiliária).
-- 3. Funções auxiliares em private.
-- 4. Troca de trecho exato nas funções públicas (feed, página, sitemap,
--    landing page) e no filtro "Sem autorização vigente" de search_properties.
--
-- "Autorização vencida" = o imóvel tem autorização cadastrada, mas nenhuma
-- vigente hoje (fuso de São Paulo): todas venceram ou a próxima ainda não
-- começou. Imóvel sem nenhuma autorização cadastrada não é afetado. O imóvel
-- volta sozinho quando a renovação é registrada (nada é gravado ao sair do ar).

-- -----------------------------------------------------------------------------
-- 1. Configuração por imobiliária
-- -----------------------------------------------------------------------------
create table if not exists public.listing_publication_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  hide_without_valid_authorization boolean not null default true,
  public_pages_enabled_by_default boolean not null default true,
  meta_pixel_id text
    constraint listing_publication_settings_meta_pixel_id_format
    check (meta_pixel_id ~ '^[0-9]{5,20}$'),
  google_tag_id text
    constraint listing_publication_settings_google_tag_id_format
    check (google_tag_id ~ '^(G|GT|AW)-[A-Z0-9]{1,30}$'),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listing_publication_settings_updated_by_idx
  on public.listing_publication_settings (updated_by);

comment on table public.listing_publication_settings is
  'Regras de publicação dos anúncios por imobiliária. Sem linha, valem os padrões: tira do ar imóvel com autorização vencida e página pública ligada, sem Pixel nem tag do Google.';
comment on column public.listing_publication_settings.hide_without_valid_authorization is
  'Ligado (padrão): imóvel com autorização cadastrada e nenhuma vigente hoje sai do feed dos portais, da página pública, das landing pages e do sitemap até a renovação.';
comment on column public.listing_publication_settings.public_pages_enabled_by_default is
  'Padrão da página pública para imóveis sem escolha própria (properties.public_page_enabled nulo).';
comment on column public.listing_publication_settings.meta_pixel_id is
  'ID do Meta Pixel da página pública do imóvel (só dígitos). Carregado pelo script oficial e só depois do aceite de cookies.';
comment on column public.listing_publication_settings.google_tag_id is
  'ID da tag do Google (G-, GT- ou AW-) da página pública do imóvel. Carregado pelo gtag.js oficial e só depois do aceite de cookies. Nunca contêiner do Google Tag Manager.';

create or replace function private.listing_publication_settings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.meta_pixel_id := nullif(btrim(coalesce(new.meta_pixel_id, '')), '');
  new.google_tag_id := nullif(upper(btrim(coalesce(new.google_tag_id, ''))), '');
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end;
$$;

comment on function private.listing_publication_settings_before_write() is
  'Apara os IDs de medição (tag do Google em maiúsculas) e registra quem alterou.';

revoke all on function private.listing_publication_settings_before_write() from public, anon, authenticated;

drop trigger if exists a0_billing_writable on public.listing_publication_settings;
create trigger a0_billing_writable
  before insert or update on public.listing_publication_settings
  for each row execute function private.assert_billing_writable();

drop trigger if exists listing_publication_settings_before_write on public.listing_publication_settings;
create trigger listing_publication_settings_before_write
  before insert or update on public.listing_publication_settings
  for each row execute function private.listing_publication_settings_before_write();

drop trigger if exists listing_publication_settings_set_updated_at on public.listing_publication_settings;
create trigger listing_publication_settings_set_updated_at
  before update on public.listing_publication_settings
  for each row execute function private.set_updated_at();

drop trigger if exists listing_publication_settings_lock_organization_id on public.listing_publication_settings;
create trigger listing_publication_settings_lock_organization_id
  before update on public.listing_publication_settings
  for each row execute function private.lock_organization_id();

drop trigger if exists listing_publication_settings_audit on public.listing_publication_settings;
create trigger listing_publication_settings_audit
  after insert or update or delete on public.listing_publication_settings
  for each row execute function private.audit_row_change();

alter table public.listing_publication_settings enable row level security;

drop policy if exists "listing_publication_settings: membros leem" on public.listing_publication_settings;
create policy "listing_publication_settings: membros leem"
  on public.listing_publication_settings for select to authenticated
  using ((select private.is_member(organization_id)));

drop policy if exists "listing_publication_settings: dono e gerente criam" on public.listing_publication_settings;
create policy "listing_publication_settings: dono e gerente criam"
  on public.listing_publication_settings for insert to authenticated
  with check ((select private.has_role(organization_id, array['owner', 'manager']::public.app_role[])));

drop policy if exists "listing_publication_settings: dono e gerente atualizam" on public.listing_publication_settings;
create policy "listing_publication_settings: dono e gerente atualizam"
  on public.listing_publication_settings for update to authenticated
  using ((select private.has_role(organization_id, array['owner', 'manager']::public.app_role[])))
  with check ((select private.has_role(organization_id, array['owner', 'manager']::public.app_role[])));

revoke all on public.listing_publication_settings from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.listing_publication_settings from authenticated;
grant select on public.listing_publication_settings to authenticated;
grant insert (
  organization_id, hide_without_valid_authorization, public_pages_enabled_by_default,
  meta_pixel_id, google_tag_id
) on public.listing_publication_settings to authenticated;
grant update (
  hide_without_valid_authorization, public_pages_enabled_by_default, meta_pixel_id, google_tag_id
) on public.listing_publication_settings to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Chave da página pública por imóvel
-- -----------------------------------------------------------------------------
alter table public.properties
  add column if not exists public_page_enabled boolean;

comment on column public.properties.public_page_enabled is
  'Página pública do imóvel: true liga, false desliga (fora de /imovel e do sitemap, visível para a equipe), null segue listing_publication_settings.public_pages_enabled_by_default. Imóvel restrito nunca tem página.';

-- -----------------------------------------------------------------------------
-- 3. Funções auxiliares
-- -----------------------------------------------------------------------------
create or replace function private.listing_authorization_lapsed(
  p_organization_id uuid,
  p_property_id uuid,
  p_today date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Mesmo critério de private.listing_authorization_state: estado expired ou upcoming.
  select exists (
      select 1
      from public.listing_authorizations a
      where a.organization_id = p_organization_id
        and a.property_id = p_property_id
    )
    and not exists (
      select 1
      from public.listing_authorizations a
      where a.organization_id = p_organization_id
        and a.property_id = p_property_id
        and a.starts_on <= p_today
        and (a.ends_on is null or a.ends_on >= p_today)
    );
$$;

comment on function private.listing_authorization_lapsed(uuid, uuid, date) is
  'Imóvel com autorização cadastrada e nenhuma vigente na data (vencida ou ainda não iniciada). Sem autorização cadastrada: false.';

revoke all on function private.listing_authorization_lapsed(uuid, uuid, date) from public, anon, authenticated;

create or replace function private.listing_blocked_by_authorization(
  p_organization_id uuid,
  p_property_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
      select s.hide_without_valid_authorization
      from public.listing_publication_settings s
      where s.organization_id = p_organization_id
    ), true)
    and private.listing_authorization_lapsed(
      p_organization_id,
      p_property_id,
      (now() at time zone 'America/Sao_Paulo')::date
    );
$$;

comment on function private.listing_blocked_by_authorization(uuid, uuid) is
  'Anúncio fora do ar por autorização vencida (hoje em São Paulo), respeitando a configuração da imobiliária. Usada pelas funções públicas.';

revoke all on function private.listing_blocked_by_authorization(uuid, uuid) from public, anon, authenticated;

create or replace function private.property_public_page_enabled(
  p_organization_id uuid,
  p_value boolean
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_value,
    (
      select s.public_pages_enabled_by_default
      from public.listing_publication_settings s
      where s.organization_id = p_organization_id
    ),
    true
  );
$$;

comment on function private.property_public_page_enabled(uuid, boolean) is
  'Chave efetiva da página pública: a do imóvel ou, sem escolha, o padrão da imobiliária (ligado).';

revoke all on function private.property_public_page_enabled(uuid, boolean) from public, anon, authenticated;

create or replace function private.public_listing_tracking(p_organization_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select jsonb_strip_nulls(jsonb_build_object(
      'meta_pixel_id', s.meta_pixel_id,
      'google_tag_id', s.google_tag_id
    ))
    from public.listing_publication_settings s
    where s.organization_id = p_organization_id
  ), '{}'::jsonb);
$$;

comment on function private.public_listing_tracking(uuid) is
  'IDs de medição (Meta Pixel e tag do Google) da página pública do imóvel; objeto vazio sem configuração.';

revoke all on function private.public_listing_tracking(uuid) from public, anon, authenticated;

create or replace function private.authorization_filter_states(p_filter text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_filter
    when 'not_valid' then array['none', 'expired', 'upcoming']
    else array[p_filter]
  end;
$$;

comment on function private.authorization_filter_states(text) is
  'Estados de private.listing_authorization_state aceitos por um filtro da lista de imóveis: not_valid = sem autorização vigente (nenhuma, vencida ou ainda não iniciada).';

-- search_properties é security invoker: authenticated precisa executar.
revoke all on function private.authorization_filter_states(text) from public, anon;
grant execute on function private.authorization_filter_states(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Funções públicas e busca de imóveis
-- -----------------------------------------------------------------------------
-- Troca de trecho exato na definição atual (pg_get_functiondef), para não
-- sobrescrever filtros recentes (lixeira, importação). Falha se o trecho sumir.
do $patch$
declare
  v_patch record;
  v_def text;
begin
  for v_patch in
    select t.fn, t.from_text, t.to_text
    from (
      values
        (1, 'public.get_public_property(text, text)',
          'and not p.is_restricted and p.deleted_at is null',
          'and not p.is_restricted and p.deleted_at is null'
            || ' and private.property_public_page_enabled(p.organization_id, p.public_page_enabled)'
            || ' and not private.listing_blocked_by_authorization(p.organization_id, p.id)'),
        (2, 'public.get_public_property(text, text)',
          '''organization'', v_org,',
          '''organization'', v_org,'
            || ' ''tracking'', private.public_listing_tracking(v_org_id),'),
        (3, 'public.get_public_sitemap(text)',
          'and not p.is_restricted and p.deleted_at is null',
          'and not p.is_restricted and p.deleted_at is null'
            || ' and private.property_public_page_enabled(p.organization_id, p.public_page_enabled)'
            || ' and not private.listing_blocked_by_authorization(p.organization_id, p.id)'),
        (4, 'public.get_portal_feed(text, text)',
          'and not p.is_restricted and p.deleted_at is null',
          'and not p.is_restricted and p.deleted_at is null'
            || ' and not private.listing_blocked_by_authorization(p.organization_id, p.id)'),
        (5, 'public.get_public_landing_page(text, text)',
          'and not p.is_restricted and p.deleted_at is null',
          'and not p.is_restricted and p.deleted_at is null'
            || ' and not private.listing_blocked_by_authorization(p.organization_id, p.id)'),
        (6, 'public.search_properties(uuid, text, public.property_status, public.listing_purpose, public.property_type, numeric, numeric, integer, integer, integer, text)',
          '-- Só os dois filtros da tela; qualquer outro valor é ignorado.',
          '-- Só os três filtros da tela; qualquer outro valor é ignorado.'),
        (7, 'public.search_properties(uuid, text, public.property_status, public.listing_purpose, public.property_type, numeric, numeric, integer, integer, integer, text)',
          'when p_authorization in (''expiring'', ''expired'') then p_authorization',
          'when p_authorization in (''expiring'', ''expired'', ''not_valid'') then p_authorization'),
        (8, 'public.search_properties(uuid, text, public.property_status, public.listing_purpose, public.property_type, numeric, numeric, integer, integer, integer, text)',
          ') = a.auth_filter',
          ') = any (private.authorization_filter_states(a.auth_filter))')
    ) as t(ord, fn, from_text, to_text)
    order by t.ord
  loop
    v_def := pg_get_functiondef(v_patch.fn::regprocedure);

    if strpos(v_def, v_patch.from_text) = 0 then
      raise exception 'Trecho não encontrado em %: %', v_patch.fn, v_patch.from_text;
    end if;

    if strpos(v_def, v_patch.to_text) > 0 then
      raise exception 'Função % já tem a troca: %', v_patch.fn, v_patch.to_text;
    end if;

    execute replace(v_def, v_patch.from_text, v_patch.to_text);
  end loop;
end
$patch$;
