-- =============================================================================
-- Imóvel restrito (sigilo): só quem tem acesso vê o imóvel e o que pende dele
-- =============================================================================
-- Alto padrão e off-market: o proprietário não aceita que a equipe inteira veja
-- endereço, fotos, proprietários, chaves e propostas. Esta migração cria a opção
-- "Restrito" no imóvel. Um imóvel restrito só é visto por:
--
--   - dono e gerente da imobiliária;
--   - captador (captured_by) e corretor responsável (broker_id);
--   - pessoas escolhidas, uma a uma (property_shares).
--
-- A regra vale no banco, em toda leitura:
--
--  1. properties.is_restricted + CHECK: imóvel restrito nunca fica publicado nos
--     portais (o gatilho desliga a publicação e o CHECK garante).
--  2. property_shares: compartilhamento por pessoa (membro ativo).
--  3. Funções de acesso: private.can_view_property_row / can_view_property,
--     private.can_manage_property_row / can_manage_property (quem muda o sigilo,
--     compartilha e cuida do dossiê) e private.hidden_property_ids() — a lista
--     de imóveis restritos que a pessoa NÃO vê, calculada uma vez por consulta
--     (initPlan) nas políticas das tabelas filhas.
--  4. RLS: properties, property_media, property_owners, keys, key_movements,
--     listing_authorizations, proposals, proposal_shares,
--     proposal_discount_requests, activities, appointments, tasks e a listagem
--     do bucket property-media. Busca global (search_crm), lista de imóveis
--     (search_properties), exportações, painel, relatórios e a view
--     client_property_matches são security invoker: herdam o RLS.
--  5. Edição (can_edit_property e storage_can_edit_property) passa a exigir
--     também ver o imóvel: assistente sem compartilhamento não mexe em imóvel
--     restrito.
--  6. Funções security definer que leem imóveis sem RLS: página pública,
--     sitemap, landing page, feed dos portais e formulário de contato do imóvel
--     ignoram restritos; documento da proposta, link da proposta e pedidos de
--     desconto conferem o acesso ao imóvel.
--  7. Gatilho: só dono, gerente, captador e corretor responsável marcam ou
--     desmarcam o sigilo.
--
-- O acesso de quem já existia não muda: nenhum imóvel nasce restrito.

-- -----------------------------------------------------------------------------
-- 1. Coluna e garantia de que restrito não vai para os portais
-- -----------------------------------------------------------------------------
alter table public.properties
  add column is_restricted boolean not null default false,
  add constraint properties_restricted_not_published
    check (not (is_restricted and published_to_portals));

comment on column public.properties.is_restricted is
  'Imóvel restrito (sigilo): só dono, gerente, captador, corretor responsável e as pessoas de property_shares veem. Nunca vai para portais, página pública ou landing page.';

-- Poucos imóveis são restritos: índice parcial para montar a lista de ocultos.
create index properties_restricted_idx
  on public.properties (organization_id)
  where is_restricted;

-- -----------------------------------------------------------------------------
-- 2. property_shares: pessoas escolhidas para ver o imóvel restrito
-- -----------------------------------------------------------------------------
create table public.property_shares (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint property_shares_pkey primary key (property_id, user_id),
  constraint property_shares_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade
);

create index property_shares_organization_property_idx
  on public.property_shares (organization_id, property_id);
create index property_shares_user_idx on public.property_shares (user_id);
create index property_shares_created_by_idx on public.property_shares (created_by);

comment on table public.property_shares is
  'Pessoas da equipe que podem ver um imóvel restrito (além de dono, gerente, captador e corretor responsável). Sem UPDATE: concede ou revoga.';

create trigger a0_billing_writable
  before insert on public.property_shares
  for each row execute function private.assert_billing_writable();
create trigger property_shares_enforce_author
  before insert on public.property_shares
  for each row execute function private.enforce_author_column('created_by');
create trigger property_shares_validate_members
  before insert on public.property_shares
  for each row execute function private.validate_member_columns('user_id', 'A pessoa escolhida');

-- -----------------------------------------------------------------------------
-- 3. Funções de acesso
-- -----------------------------------------------------------------------------
-- Vê o imóvel: membro ativo e, se restrito, dono/gerente, captador, corretor
-- responsável ou pessoa escolhida.
create or replace function private.can_view_property_row(
  p_organization_id uuid,
  p_property_id uuid,
  p_is_restricted boolean,
  p_captured_by uuid,
  p_broker_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.active
      and (
        not coalesce(p_is_restricted, false)
        or m.role in ('owner', 'manager')
        or m.user_id = p_captured_by
        or m.user_id = p_broker_id
        or exists (
          select 1
          from public.property_shares s
          where s.property_id = p_property_id
            and s.user_id = m.user_id
        )
      )
  );
$$;

create or replace function private.can_view_property(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_view_property_row(
      p.organization_id, p.id, p.is_restricted, p.captured_by, p.broker_id
    )
    from public.properties p
    where p.id = p_property_id
  ), false);
$$;

-- Gerencia o sigilo e o dossiê: dono, gerente, captador e corretor responsável.
create or replace function private.can_manage_property_row(
  p_organization_id uuid,
  p_captured_by uuid,
  p_broker_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.active
      and (
        m.role in ('owner', 'manager')
        or m.user_id = p_captured_by
        or m.user_id = p_broker_id
      )
  );
$$;

create or replace function private.can_manage_property(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_manage_property_row(p.organization_id, p.captured_by, p.broker_id)
    from public.properties p
    where p.id = p_property_id
  ), false);
$$;

-- Imóveis restritos que a pessoa atual NÃO vê, em todas as imobiliárias dela.
-- Nas políticas entra como `(select private.hidden_property_ids())`: o Postgres
-- calcula a lista uma vez por consulta, e não uma vez por linha.
create or replace function private.hidden_property_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}'::uuid[])
  from public.memberships m
  join public.properties p
    on p.organization_id = m.organization_id
   and p.is_restricted
  where m.user_id = (select auth.uid())
    and m.active
    and m.role not in ('owner', 'manager')
    and p.captured_by is distinct from m.user_id
    and p.broker_id is distinct from m.user_id
    and not exists (
      select 1
      from public.property_shares s
      where s.property_id = p.id
        and s.user_id = m.user_id
    );
$$;

-- Caminho {organization_id}/properties/{property_id}/... de um imóvel visível
-- ou gerenciável pela pessoa atual (políticas do Storage).
create or replace function private.storage_can_view_property(folders text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(folders) = 3
    and folders[2] = 'properties'
    and exists (
      select 1
      from public.properties p
      where p.organization_id = private.try_uuid(folders[1])
        and p.id = private.try_uuid(folders[3])
        and private.can_view_property_row(
          p.organization_id, p.id, p.is_restricted, p.captured_by, p.broker_id
        )
    ),
    false
  );
$$;

create or replace function private.storage_can_manage_property(folders text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(folders) = 3
    and folders[2] = 'properties'
    and exists (
      select 1
      from public.properties p
      where p.organization_id = private.try_uuid(folders[1])
        and p.id = private.try_uuid(folders[3])
        and private.can_manage_property_row(p.organization_id, p.captured_by, p.broker_id)
    ),
    false
  );
$$;

revoke all on function private.can_view_property_row(uuid, uuid, boolean, uuid, uuid)
  from public, anon;
revoke all on function private.can_view_property(uuid) from public, anon;
revoke all on function private.can_manage_property_row(uuid, uuid, uuid) from public, anon;
revoke all on function private.can_manage_property(uuid) from public, anon;
revoke all on function private.hidden_property_ids() from public, anon;
revoke all on function private.storage_can_view_property(text[]) from public, anon;
revoke all on function private.storage_can_manage_property(text[]) from public, anon;
grant execute on function private.can_view_property_row(uuid, uuid, boolean, uuid, uuid)
  to authenticated;
grant execute on function private.can_view_property(uuid) to authenticated;
grant execute on function private.can_manage_property_row(uuid, uuid, uuid) to authenticated;
grant execute on function private.can_manage_property(uuid) to authenticated;
grant execute on function private.hidden_property_ids() to authenticated;
grant execute on function private.storage_can_view_property(text[]) to authenticated;
grant execute on function private.storage_can_manage_property(text[]) to authenticated;

comment on function private.can_view_property_row(uuid, uuid, boolean, uuid, uuid) is
  'Membro ativo vê o imóvel; se restrito, só dono, gerente, captador, corretor responsável ou pessoa de property_shares.';
comment on function private.can_manage_property_row(uuid, uuid, uuid) is
  'Dono, gerente, captador ou corretor responsável: muda o sigilo, compartilha e cuida do dossiê do imóvel.';
comment on function private.hidden_property_ids() is
  'Imóveis restritos que a pessoa atual não vê. Use como (select private.hidden_property_ids()) nas políticas.';

-- Quem edita o imóvel precisa também poder vê-lo (assistente não mexe em
-- imóvel restrito sem compartilhamento).
create or replace function private.can_edit_property(property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_edit_property_row(p.organization_id, p.captured_by, p.broker_id)
      and private.can_view_property_row(
        p.organization_id, p.id, p.is_restricted, p.captured_by, p.broker_id
      )
    from public.properties p
    where p.id = property
  ), false);
$$;

create or replace function private.storage_can_edit_property(folders text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    cardinality(folders) = 3
    and folders[2] = 'properties'
    and exists (
      select 1
      from public.properties p
      where p.organization_id = private.try_uuid(folders[1])
        and p.id = private.try_uuid(folders[3])
        and private.can_edit_property_row(p.organization_id, p.captured_by, p.broker_id)
        and private.can_view_property_row(
          p.organization_id, p.id, p.is_restricted, p.captured_by, p.broker_id
        )
    ),
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. Gatilho do sigilo
-- -----------------------------------------------------------------------------
-- Roda depois de properties_before_insert (que define o captador de quem
-- cadastra). Sem sessão (servidor, importação por RPC de servidor), só desliga
-- a publicação.
create or replace function private.properties_guard_restricted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_restricted and new.published_to_portals then
    new.published_to_portals := false;
    if tg_op = 'INSERT' then
      new.published_at := null;
    elsif not old.published_to_portals then
      new.published_at := old.published_at;
    end if;
  end if;

  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.is_restricted
       and not private.can_manage_property_row(new.organization_id, new.captured_by, new.broker_id) then
      raise exception 'Só o dono, o gerente, o captador ou o corretor responsável podem cadastrar um imóvel como restrito.'
        using errcode = '42501';
    end if;
  elsif new.is_restricted is distinct from old.is_restricted
     and not private.can_manage_property_row(old.organization_id, old.captured_by, old.broker_id) then
    raise exception 'Só o dono, o gerente, o captador ou o corretor responsável podem mudar o sigilo deste imóvel.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.properties_guard_restricted() from public, anon, authenticated;

create trigger properties_guard_restricted
  before insert or update on public.properties
  for each row execute function private.properties_guard_restricted();

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
alter table public.property_shares enable row level security;

revoke all on public.property_shares from anon;
revoke update, truncate, references, trigger on public.property_shares from authenticated;
grant select, insert, delete on public.property_shares to authenticated;

create policy "property_shares: quem vê o imóvel lê"
  on public.property_shares for select to authenticated
  using (
    private.is_member(organization_id)
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  );

create policy "property_shares: quem gerencia o sigilo concede"
  on public.property_shares for insert to authenticated
  with check (private.can_manage_property(property_id));

create policy "property_shares: quem gerencia o sigilo revoga"
  on public.property_shares for delete to authenticated
  using (private.can_manage_property(property_id));

alter policy "properties: membros leem" on public.properties
  using (
    private.is_member(organization_id)
    and (not is_restricted or not (id = any ((select private.hidden_property_ids())::uuid[])))
  );

alter policy "properties: gestão ou captador/corretor do imóvel atualiza" on public.properties
  using (
    private.can_edit_property_row(organization_id, captured_by, broker_id)
    and (not is_restricted or not (id = any ((select private.hidden_property_ids())::uuid[])))
  )
  with check (
    private.can_edit_property_row(organization_id, captured_by, broker_id)
    and (not is_restricted or not (id = any ((select private.hidden_property_ids())::uuid[])))
  );

alter policy "property_media: membros leem" on public.property_media
  using (
    private.is_member(organization_id)
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  );

alter policy "property_owners: membros leem" on public.property_owners
  using (
    private.is_member(organization_id)
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  );

alter policy "keys: membros leem" on public.keys
  using (
    private.is_member(organization_id)
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  );

-- Movimentação de chave: vale o RLS da chave.
alter policy "key_movements: membros leem" on public.key_movements
  using (
    private.is_member(organization_id)
    and exists (
      select 1
      from public.keys k
      where k.organization_id = key_movements.organization_id
        and k.id = key_movements.key_id
    )
  );

alter policy "key_movements: equipe comercial registra retirada" on public.key_movements
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and created_by = (select auth.uid())
    and (taken_by_client_id is null or private.can_access_client(taken_by_client_id))
    and exists (
      select 1
      from public.keys k
      where k.organization_id = key_movements.organization_id
        and k.id = key_movements.key_id
    )
  );

alter policy "listing_authorizations: membros leem" on public.listing_authorizations
  using (
    private.is_member(organization_id)
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  );

alter policy "proposals: membros leem" on public.proposals
  using (
    private.is_member(organization_id)
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  );

alter policy "proposals: corretor ou editor do imóvel atualiza" on public.proposals
  using (
    (
      private.can_edit_property(property_id)
      or (
        private.has_role(organization_id, '{broker,capturer}')
        and broker_id = (select auth.uid())
      )
    )
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  )
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and private.can_access_client(client_id)
    and (
      private.has_role(organization_id, '{owner,manager}')
      or broker_id = (select auth.uid())
      or private.can_edit_property(property_id)
    )
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  );

alter policy "proposals: equipe comercial cria para cliente acessível" on public.proposals
  with check (
    private.has_role(organization_id, '{owner,manager,broker,capturer,assistant}')
    and private.can_access_client(client_id)
    and (
      private.has_role(organization_id, '{owner,manager}')
      or broker_id = (select auth.uid())
      or private.can_edit_property(property_id)
    )
    and not (property_id = any ((select private.hidden_property_ids())::uuid[]))
  );

-- Link público e pedidos de desconto: valem o RLS da proposta.
alter policy "proposal_shares: membros leem" on public.proposal_shares
  using (
    (select private.is_member(organization_id))
    and exists (
      select 1
      from public.proposals pr
      where pr.organization_id = proposal_shares.organization_id
        and pr.id = proposal_shares.proposal_id
    )
  );

alter policy "proposal_discount_requests: gestão e autor leem" on public.proposal_discount_requests
  using (
    (
      (select private.commission_auditor(organization_id))
      or (
        requested_by = (select auth.uid())
        and (select private.is_member(organization_id))
      )
    )
    and exists (
      select 1
      from public.proposals pr
      where pr.id = proposal_discount_requests.proposal_id
    )
  );

-- Atividade, visita e tarefa ligadas a imóvel restrito: somem para quem não vê
-- o imóvel. O corretor da visita e o responsável pela tarefa continuam vendo o
-- que foi atribuído a eles.
alter policy "activities: cliente acessível ou atividade só de imóvel" on public.activities
  using (
    case
      when client_id is not null then private.can_access_client(client_id)
      else private.is_member(organization_id)
    end
    and (
      property_id is null
      or not (property_id = any ((select private.hidden_property_ids())::uuid[]))
    )
  );

do $$
declare
  v_policy text;
begin
  select p.policyname into strict v_policy
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'appointments' and p.cmd = 'SELECT';

  execute format(
    $sql$
      alter policy %I on public.appointments
        using (
          (
            private.has_role(organization_id, '{owner,manager,assistant,finance}')
            or (
              private.is_member(organization_id)
              and (
                broker_id = (select auth.uid())
                or created_by = (select auth.uid())
                or (client_id is not null and private.can_access_client(client_id))
              )
            )
          )
          and (
            property_id is null
            or broker_id = (select auth.uid())
            or not (property_id = any ((select private.hidden_property_ids())::uuid[]))
          )
        )
    $sql$,
    v_policy
  );

  select p.policyname into strict v_policy
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'tasks' and p.cmd = 'SELECT';

  execute format(
    $sql$
      alter policy %I on public.tasks
        using (
          (
            private.has_role(organization_id, '{owner,manager,assistant,finance}')
            or (
              private.is_member(organization_id)
              and (
                assignee_id = (select auth.uid())
                or created_by = (select auth.uid())
                or (client_id is not null and private.can_access_client(client_id))
              )
            )
          )
          and (
            property_id is null
            or assignee_id = (select auth.uid())
            or not (property_id = any ((select private.hidden_property_ids())::uuid[]))
          )
        )
    $sql$,
    v_policy
  );
end;
$$;

-- Listagem do bucket de fotos: pasta de imóvel restrito some para quem não vê.
-- (O download das fotos continua pela URL pública do bucket, com nome
-- aleatório; imóvel restrito não sai em feed, página pública nem landing.)
alter policy "property-media: membros listam" on storage.objects
  using (
    bucket_id = 'property-media'
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and (
      (storage.foldername(name))[2] is distinct from 'properties'
      or private.storage_can_view_property(storage.foldername(name))
    )
  );

-- -----------------------------------------------------------------------------
-- 6. Funções security definer (leem imóveis sem RLS)
-- -----------------------------------------------------------------------------
-- Públicas: imóvel restrito não existe para portais, página pública, sitemap,
-- landing page nem formulário de contato.
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
        and not p.is_restricted
        and p.published_to_portals
    ), '[]'::jsonb)
  );
end;
$$;

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
      'brand', o.brand
    )
    into v_org_id, v_org
  from public.organizations o
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

create or replace function public.get_public_sitemap(p_org_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select o.id into v_org_id
  from public.organizations o
  where o.slug = lower(btrim(coalesce(p_org_slug, '')));

  if v_org_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object('code', x.code, 'updated_at', x.updated_at)
        order by x.updated_at desc, x.code
      )
      from (
        select p.code, p.updated_at
        from public.properties p
        where p.organization_id = v_org_id
          and p.status = 'active'
          and not p.is_restricted
        order by p.updated_at desc, p.code
        limit 5000
      ) as x
    ), '[]'::jsonb),
    'landing_pages', coalesce((
      select jsonb_agg(
        jsonb_build_object('slug', y.slug, 'updated_at', y.updated_at)
        order by y.updated_at desc, y.slug
      )
      from (
        select lp.slug, lp.updated_at
        from public.landing_pages lp
        where lp.organization_id = v_org_id
          and lp.status = 'published'
        order by lp.updated_at desc, lp.slug
        limit 50
      ) as y
    ), '[]'::jsonb)
  );
end;
$$;

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
      'brand', o.brand
    )
    into v_org_id, v_org
  from public.organizations o
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

create or replace function public.submit_property_lead(
  p_org_slug text,
  p_property_code text,
  p_payload jsonb,
  p_server_key text default null,
  p_nonce text default null,
  p_client_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_client_key text := nullif(btrim(coalesce(p_client_key, '')), '');
  v_org uuid;
  v_property_id uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_message text;
  v_interest text;
  v_text text;
  v_event_id uuid;
  v_landing_url text;
  v_referrer text;
  v_utm jsonb := '{}'::jsonb;
  v_click_ids jsonb := '{}'::jsonb;
begin
  -- Chave do servidor e nonce: sempre o mesmo erro, sem indicar o motivo.
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'lead_server_key'
  limit 1;

  if v_secret is null
     or p_server_key is null
     or extensions.digest(p_server_key, 'sha256') <> extensions.digest(v_secret, 'sha256')
     or p_nonce is null
     or char_length(p_nonce) not between 16 and 512
     or p_nonce !~ '^[[:graph:]]+$' then
    raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Dados do formulário inválidos.' using errcode = '22023';
  end if;

  if octet_length(p_payload::text) > 16384 then
    raise exception 'Formulário grande demais.' using errcode = '22023';
  end if;

  if v_client_key is not null and v_client_key !~ '^[A-Za-z0-9_=+/-]{32,128}$' then
    raise exception 'Identificação do visitante inválida.' using errcode = '22023';
  end if;

  -- Só imóvel ATIVO e não restrito da imobiliária do slug.
  select p.organization_id, p.id
    into v_org, v_property_id
  from public.properties p
  join public.organizations o
    on o.id = p.organization_id
  where o.slug = lower(btrim(coalesce(p_org_slug, '')))
    and p.code = upper(btrim(coalesce(p_property_code, '')))
    and p.status = 'active'
    and not p.is_restricted;

  if v_property_id is null then
    raise exception 'Imóvel não encontrado.' using errcode = 'P0002';
  end if;

  -- Validação (erros não gastam o nonce)
  v_name := btrim(coalesce(p_payload ->> 'name', ''));
  v_email := nullif(lower(btrim(coalesce(p_payload ->> 'email', ''))), '');
  v_phone := nullif(regexp_replace(coalesce(p_payload ->> 'phone', ''), '[^0-9]', '', 'g'), '');
  v_message := nullif(btrim(coalesce(p_payload ->> 'message', '')), '');
  v_interest := nullif(lower(btrim(coalesce(p_payload ->> 'interest', ''))), '');

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Informe seu nome (2 a 120 caracteres).' using errcode = '22023';
  end if;

  if v_email is null and v_phone is null then
    raise exception 'Informe um e-mail ou telefone para contato.' using errcode = '22023';
  end if;

  -- E-mail estrito: sem espaços, quebras de linha, "?", "&" ou pontos seguidos.
  if v_email is not null and (
    char_length(v_email) > 254
    or v_email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
    or position('..' in v_email) > 0
  ) then
    raise exception 'E-mail inválido.' using errcode = '22023';
  end if;

  if v_phone is not null and v_phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido: informe DDD e número.' using errcode = '22023';
  end if;

  if char_length(v_message) > 2000 then
    raise exception 'Mensagem longa demais (máximo 2.000 caracteres).' using errcode = '22023';
  end if;

  if v_interest is not null and v_interest not in ('buy', 'rent', 'invest', 'sell', 'info') then
    raise exception 'Interesse inválido.' using errcode = '22023';
  end if;

  v_text := nullif(btrim(coalesce(p_payload ->> 'event_id', '')), '');
  if v_text is not null then
    v_event_id := private.try_uuid(v_text);
    if v_event_id is null then
      raise exception 'Identificador do evento inválido.' using errcode = '22023';
    end if;
  end if;

  if lower(coalesce(p_payload ->> 'consent', '')) <> 'true' then
    raise exception 'É necessário aceitar o uso dos dados para contato (LGPD).'
      using errcode = '22023';
  end if;

  -- Atribuição de campanha: só chaves conhecidas, texto aparado e cortado no limite.
  if jsonb_typeof(p_payload -> 'utm') = 'object' then
    select coalesce(jsonb_object_agg(e.key, left(btrim(e.value #>> '{}'), 150)), '{}'::jsonb)
      into v_utm
    from jsonb_each(p_payload -> 'utm') as e
    where e.key in ('source', 'medium', 'campaign', 'content', 'term')
      and jsonb_typeof(e.value) in ('string', 'number')
      and btrim(e.value #>> '{}') <> '';
  end if;

  if jsonb_typeof(p_payload -> 'click_ids') = 'object' then
    select coalesce(jsonb_object_agg(e.key, left(btrim(e.value #>> '{}'), 255)), '{}'::jsonb)
      into v_click_ids
    from jsonb_each(p_payload -> 'click_ids') as e
    where e.key in ('gclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'fbp')
      and jsonb_typeof(e.value) in ('string', 'number')
      and btrim(e.value #>> '{}') <> '';
  end if;

  -- URLs: só http/https, sem espaços ou caracteres de controle; senão, ignoradas.
  v_landing_url := left(btrim(coalesce(p_payload ->> 'landing_url', '')), 500);
  if v_landing_url !~* '^https?://' or v_landing_url ~ '[[:space:][:cntrl:]]' then
    v_landing_url := null;
  end if;

  v_referrer := left(btrim(coalesce(p_payload ->> 'referrer', '')), 500);
  if v_referrer !~* '^https?://' or v_referrer ~ '[[:space:][:cntrl:]]' then
    v_referrer := null;
  end if;

  -- Mesma trava de submit_landing_lead: os limites abaixo valem somados para
  -- landing page e página do imóvel, mesmo com envios simultâneos.
  perform pg_advisory_xact_lock(hashtextextended('submit_landing_lead:' || v_org::text, 0));

  -- event_id repetido: ignora (o nonce é consumido normalmente).
  if v_event_id is not null and exists (
    select 1 from public.leads l
    where l.organization_id = v_org
      and l.event_id = v_event_id
  ) then
    insert into private.capture_request_nonces (nonce_hash)
    values (encode(extensions.digest(p_nonce, 'sha256'), 'hex'))
    on conflict (nonce_hash) do nothing;

    if not found then
      raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
    end if;

    return;
  end if;

  if (
    select count(*)
    from private.landing_lead_attempts a
    where a.organization_id = v_org
      and a.created_at > now() - interval '1 minute'
  ) >= 60 then
    raise exception 'Muitas solicitações em pouco tempo. Tente novamente em instantes.'
      using errcode = '54000', detail = 'organization';
  end if;

  if v_client_key is not null and (
    select count(*)
    from private.landing_lead_attempts a
    where a.organization_id = v_org
      and a.client_key = v_client_key
      and a.created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Você enviou muitos contatos em pouco tempo. Aguarde alguns minutos e tente de novo.'
      using errcode = '54000', detail = 'client_key';
  end if;

  -- Nonce consumido só quando o envio é aceito.
  insert into private.capture_request_nonces (nonce_hash)
  values (encode(extensions.digest(p_nonce, 'sha256'), 'hex'))
  on conflict (nonce_hash) do nothing;

  if not found then
    raise exception 'Não foi possível enviar o formulário.' using errcode = '42501';
  end if;

  insert into public.leads (
    organization_id, name, email, phone, message, interest, source, property_id, stage,
    utm, click_ids, landing_url, referrer, event_id, consent_at
  )
  values (
    v_org, v_name, v_email, v_phone, v_message, v_interest, 'website', v_property_id, 'new',
    v_utm, v_click_ids, v_landing_url, v_referrer, v_event_id, now()
  )
  on conflict (organization_id, event_id) where event_id is not null do nothing;

  insert into private.landing_lead_attempts (organization_id, client_key)
  values (v_org, v_client_key);

  -- Limpeza em lotes, sem esperar travas de outras transações.
  delete from private.landing_lead_attempts a
  where a.id in (
    select b.id
    from private.landing_lead_attempts b
    where b.created_at < now() - interval '1 day'
    order by b.created_at
    limit 1000
    for update skip locked
  );

  delete from private.capture_request_nonces n
  where n.nonce_hash in (
    select c.nonce_hash
    from private.capture_request_nonces c
    where c.created_at < now() - interval '12 hours'
    order by c.created_at
    limit 1000
    for update skip locked
  );
end;
$$;

-- Equipe: documento, link e pedidos de desconto conferem o acesso ao imóvel.
create or replace function public.get_proposal_document(p_proposal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_property uuid;
begin
  if (select auth.uid()) is null or p_proposal_id is null then
    return null;
  end if;

  select pr.organization_id, pr.property_id into v_org, v_property
  from public.proposals pr
  where pr.id = p_proposal_id;

  if v_org is null
     or not private.is_member(v_org)
     or not private.can_view_property(v_property) then
    return null;
  end if;

  return private.proposal_document(p_proposal_id, false);
end;
$$;

create or replace function private.can_share_proposal(p_proposal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (
        private.can_edit_property(pr.property_id)
        or (
          private.has_role(pr.organization_id, '{broker,capturer}')
          and pr.broker_id = (select auth.uid())
        )
      )
      and private.can_view_property(pr.property_id)
    from public.proposals pr
    where pr.id = p_proposal_id
  ), false);
$$;

create or replace function public.list_proposal_discount_requests(
  p_organization_id uuid,
  p_proposal_ids uuid[]
)
returns table (
  id uuid,
  proposal_id uuid,
  status public.discount_request_status,
  amount_cents bigint,
  reference_cents bigint,
  discount_percent numeric,
  requested_by_me boolean,
  reason text,
  review_note text,
  created_at timestamptz,
  updated_at timestamptz,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select
      (select auth.uid()) as user_id,
      private.commission_auditor(p_organization_id) as auditor,
      private.has_role(p_organization_id, '{broker,capturer}') as self_broker
    where private.is_member(p_organization_id)
  )
  select
    r.id,
    r.proposal_id,
    r.status,
    r.amount_cents,
    r.reference_cents,
    r.discount_percent,
    coalesce(r.requested_by = v.user_id, false),
    case when v.auditor or r.requested_by = v.user_id then r.reason end,
    case when v.auditor or r.requested_by = v.user_id then r.review_note end,
    r.created_at,
    r.updated_at,
    r.reviewed_at
  from viewer v
  join public.proposals pr
    on pr.organization_id = p_organization_id
   and pr.id = any (p_proposal_ids)
  join public.proposal_discount_requests r
    on r.proposal_id = pr.id
  where (
      v.auditor
      or (v.self_broker and pr.broker_id = v.user_id)
      or private.can_edit_property(pr.property_id)
    )
    and private.can_view_property(pr.property_id)
  order by r.created_at desc, r.id;
$$;

create or replace function public.request_proposal_discount(
  p_proposal_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := (select auth.uid());
  v_proposal public.proposals;
  v_enabled boolean;
  v_limit_percent numeric;
  v_reference bigint;
  v_amount bigint;
  v_discount bigint;
  v_limit bigint;
  v_pending public.proposal_discount_requests;
  v_request public.proposal_discount_requests;
begin
  -- A trava da linha vale até o fim da chamada: dois pedidos ao mesmo tempo para
  -- a mesma proposta não passam juntos pelas checagens de aprovação e de pedido
  -- em aberto. NO KEY UPDATE não bloqueia quem só referencia a proposta.
  select * into v_proposal
  from public.proposals p
  where p.id = p_proposal_id
    and private.is_member(p.organization_id)
    and private.can_view_property(p.property_id)
  for no key update;

  if not found then
    raise exception 'Proposta não encontrada.' using errcode = 'P0001';
  end if;

  if not (
    private.has_role(v_proposal.organization_id, '{owner,manager}')
    or v_proposal.broker_id = v_user
    or private.can_edit_property(v_proposal.property_id)
  ) then
    raise exception 'Só o corretor da proposta ou quem edita o imóvel pode pedir aprovação de desconto.'
      using errcode = '42501';
  end if;

  if v_proposal.status in ('accepted', 'rejected', 'withdrawn') then
    raise exception 'Esta proposta já foi encerrada.' using errcode = 'P0001';
  end if;

  select s.discount_approval_enabled, s.max_discount_percent
    into v_enabled, v_limit_percent
  from public.commission_settings s
  where s.organization_id = v_proposal.organization_id;

  if not coalesce(v_enabled, false) then
    raise exception 'A aprovação de desconto está desligada nesta imobiliária.'
      using errcode = 'P0001';
  end if;

  v_reference := private.property_reference_cents(v_proposal.property_id, v_proposal.purpose);

  if coalesce(v_reference, 0) <= 0 then
    raise exception 'Este imóvel não tem preço anunciado para comparar com a proposta.'
      using errcode = 'P0001';
  end if;

  v_amount := round(v_proposal.amount * 100)::bigint;
  v_discount := private.discount_milli(v_reference, v_amount);
  v_limit := round(coalesce(v_limit_percent, 0) * 1000)::bigint;

  if v_discount <= v_limit then
    raise exception 'Esta proposta está dentro do limite de % e não precisa de aprovação.',
      private.milli_percent_text(v_limit)
      using errcode = 'P0001';
  end if;

  if private.proposal_discount_approved(p_proposal_id, v_amount, v_reference) then
    raise exception 'O gerente já aprovou este desconto: a proposta pode ser enviada e aceita sem pedido novo.'
      using errcode = 'P0001';
  end if;

  select * into v_pending
  from public.proposal_discount_requests r
  where r.proposal_id = p_proposal_id
    and r.status = 'pending';

  if found then
    -- Pedido de outra pessoa (ou de quem saiu da conta) fica como está: trocar o
    -- autor apagaria a justificativa dela e, se quem reenviou for o gerente,
    -- ele deixaria de poder aprovar o pedido.
    if v_pending.requested_by is distinct from v_user then
      raise exception 'Outra pessoa da equipe já pediu a aprovação deste desconto e o gerente ainda não respondeu.'
        using errcode = 'P0001';
    end if;

    -- Pedido próprio em aberto: atualiza o valor e a justificativa.
    update public.proposal_discount_requests r
    set amount_cents = v_amount,
        reference_cents = v_reference,
        discount_percent = v_discount / 1000.0,
        reason = nullif(btrim(coalesce(p_reason, '')), ''),
        updated_at = now()
    where r.id = v_pending.id
    returning r.* into v_request;
  else
    insert into public.proposal_discount_requests (
      organization_id, proposal_id, amount_cents, reference_cents, discount_percent,
      reason, requested_by
    )
    values (
      v_proposal.organization_id, p_proposal_id, v_amount, v_reference, v_discount / 1000.0,
      nullif(btrim(coalesce(p_reason, '')), ''), v_user
    )
    returning * into v_request;
  end if;

  return to_jsonb(v_request);
end;
$$;
