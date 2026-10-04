-- =============================================================================
-- 0400 - Imóveis: condominiums, properties, property_media, property_owners,
--        keys, key_movements, proposals, listing_authorizations, capture_requests
-- =============================================================================

-- -----------------------------------------------------------------------------
-- condominiums
-- -----------------------------------------------------------------------------
create table public.condominiums (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  postal_code text constraint condominiums_postal_code_format check (postal_code ~ '^[0-9]{8}$'),
  street text check (char_length(street) <= 200),
  street_number text check (char_length(street_number) <= 20),
  complement text check (char_length(complement) <= 120),
  neighborhood text check (char_length(neighborhood) <= 120),
  city text check (char_length(city) <= 120),
  state text constraint condominiums_state_format check (state ~ '^[A-Z]{2}$'),
  amenities text[] not null default '{}',
  avg_condo_fee numeric(12, 2) check (avg_condo_fee >= 0),
  notes text check (char_length(notes) <= 5000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint condominiums_organization_id_id_key unique (organization_id, id)
);
create index condominiums_created_by_idx on public.condominiums (created_by);

create trigger condominiums_set_updated_at
  before update on public.condominiums
  for each row execute function private.set_updated_at();
create trigger condominiums_lock_organization_id
  before update on public.condominiums
  for each row execute function private.lock_organization_id();

alter table public.condominiums enable row level security;

-- -----------------------------------------------------------------------------
-- Contadores por imobiliária (código IMV-000001 sequencial POR organização)
-- -----------------------------------------------------------------------------
-- Uma sequence global geraria códigos esparsos por imobiliária; aqui o
-- "insert ... on conflict do update ... returning" trava a linha do contador e
-- garante numeração crescente e sem colisão mesmo com inserts concorrentes.
create table private.organization_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  counter text not null,
  last_value bigint not null default 0,
  primary key (organization_id, counter)
);
revoke all on table private.organization_counters from public;

create or replace function private.next_counter(org uuid, counter_name text)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.organization_counters as c (organization_id, counter, last_value)
  values (org, counter_name, 1)
  on conflict (organization_id, counter)
  do update set last_value = c.last_value + 1
  returning c.last_value;
$$;
revoke all on function private.next_counter(uuid, text) from public;

-- -----------------------------------------------------------------------------
-- properties
-- -----------------------------------------------------------------------------
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Gerado no insert (IMV-000001) e imutável: vira o ListingID do feed VRSync
  -- e volta nos leads dos portais. O default '' só existe para o campo ser
  -- opcional no insert (e nos tipos gerados); o trigger sempre o substitui.
  code text not null default ''
    constraint properties_code_format check (code ~ '^IMV-[0-9]{6,}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 10000),
  purpose public.listing_purpose not null,
  usage public.property_usage not null default 'residential',
  type public.property_type not null,
  status public.property_status not null default 'draft',
  sale_price numeric(14, 2) check (sale_price > 0),
  rent_price numeric(14, 2) check (rent_price > 0),
  condo_fee numeric(12, 2) check (condo_fee >= 0),
  iptu_yearly numeric(12, 2) check (iptu_yearly >= 0),
  living_area numeric(12, 2) check (living_area > 0),
  lot_area numeric(14, 2) check (lot_area > 0),
  bedrooms smallint check (bedrooms >= 0),
  suites smallint check (suites >= 0),
  bathrooms smallint check (bathrooms >= 0),
  parking_spaces smallint check (parking_spaces >= 0),
  floor smallint,
  total_floors smallint check (total_floors >= 0),
  year_built smallint check (year_built between 1500 and 2200),
  features text[] not null default '{}',
  furnished boolean not null default false,
  accepts_pets boolean not null default false,
  accepts_exchange boolean not null default false,
  postal_code text constraint properties_postal_code_format check (postal_code ~ '^[0-9]{8}$'),
  street text check (char_length(street) <= 200),
  street_number text check (char_length(street_number) <= 20),
  complement text check (char_length(complement) <= 120),
  neighborhood text check (char_length(neighborhood) <= 120),
  city text check (char_length(city) <= 120),
  state text constraint properties_state_format check (state ~ '^[A-Z]{2}$'),
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  address_display public.address_display not null default 'neighborhood',
  condominium_id uuid,
  captured_by uuid references auth.users (id) on delete set null,
  broker_id uuid references auth.users (id) on delete set null,
  imob_score smallint check (imob_score between 0 and 100),
  published_to_portals boolean not null default false,
  published_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_organization_code_key unique (organization_id, code),
  constraint properties_organization_id_id_key unique (organization_id, id),
  constraint properties_condominium_fkey foreign key (organization_id, condominium_id)
    references public.condominiums (organization_id, id) on delete set null (condominium_id),
  constraint properties_suites_lte_bedrooms check (
    suites is null or bedrooms is null or suites <= bedrooms
  ),
  -- Regras de publicação (VRSync): valem fora do rascunho.
  constraint properties_price_required check (
    status = 'draft'
    or case purpose
         when 'sale' then sale_price is not null
         when 'rent' then rent_price is not null
         else sale_price is not null and rent_price is not null
       end
  ),
  constraint properties_area_required check (
    status = 'draft'
    or case
         when type in ('land', 'farm', 'ranch', 'warehouse') then lot_area is not null
         else living_area is not null
       end
  )
);
create index properties_organization_status_idx on public.properties (organization_id, status);
create index properties_organization_condominium_idx on public.properties (organization_id, condominium_id);
create index properties_captured_by_idx on public.properties (captured_by);
create index properties_broker_id_idx on public.properties (broker_id);
create index properties_created_by_idx on public.properties (created_by);

create or replace function private.properties_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- O código é sempre gerado pelo banco (valor enviado pelo cliente é ignorado).
  new.code := 'IMV-' || lpad(private.next_counter(new.organization_id, 'property_code')::text, 6, '0');

  -- Corretor/captador que cadastra sem indicar captador vira o captador,
  -- para conseguir continuar editando o imóvel que criou.
  if new.captured_by is null and new.broker_id is null
     and exists (
       select 1 from public.memberships m
       where m.organization_id = new.organization_id
         and m.user_id = (select auth.uid())
         and m.active
         and m.role in ('broker', 'capturer')
     ) then
    new.captured_by := (select auth.uid());
  end if;

  if new.published_to_portals and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

create or replace function private.properties_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'O código do imóvel (%) não pode ser alterado.', old.code
      using errcode = '42501';
  end if;

  if new.published_to_portals and not old.published_to_portals and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end;
$$;

revoke all on function private.properties_before_insert() from public;
revoke all on function private.properties_before_update() from public;

create trigger properties_before_insert
  before insert on public.properties
  for each row execute function private.properties_before_insert();
create trigger properties_before_update
  before update on public.properties
  for each row execute function private.properties_before_update();
create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function private.set_updated_at();
create trigger properties_lock_organization_id
  before update on public.properties
  for each row execute function private.lock_organization_id();

alter table public.properties enable row level security;

-- -----------------------------------------------------------------------------
-- property_media
-- -----------------------------------------------------------------------------
create table public.property_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  kind public.media_kind not null,
  storage_path text unique,
  external_url text check (char_length(external_url) <= 2048),
  position integer not null default 0 check (position >= 0),
  is_cover boolean not null default false,
  caption text check (char_length(caption) <= 300),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_media_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  -- Imagem: arquivo no bucket property-media. Vídeo/tour: URL https externa.
  constraint property_media_source check (
    (kind = 'image' and storage_path is not null and external_url is null)
    or (kind in ('video', 'tour') and storage_path is null and external_url ~ '^https://')
  ),
  -- Caminho no Storage: {organization_id}/properties/{property_id}/{arquivo}
  constraint property_media_storage_path_format check (
    storage_path is null
    or storage_path like organization_id::text || '/properties/' || property_id::text || '/_%'
  ),
  constraint property_media_cover_is_image check (not is_cover or kind = 'image')
);
create index property_media_organization_property_idx
  on public.property_media (organization_id, property_id, position);
create index property_media_created_by_idx on public.property_media (created_by);
-- No máximo uma capa por imóvel.
create unique index property_media_one_cover_per_property
  on public.property_media (property_id)
  where is_cover;

create trigger property_media_set_updated_at
  before update on public.property_media
  for each row execute function private.set_updated_at();
create trigger property_media_lock_organization_id
  before update on public.property_media
  for each row execute function private.lock_organization_id();

alter table public.property_media enable row level security;

-- -----------------------------------------------------------------------------
-- property_owners (proprietários = clientes)
-- -----------------------------------------------------------------------------
create table public.property_owners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  client_id uuid not null,
  share_percent numeric(5, 2) check (share_percent > 0 and share_percent <= 100),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_owners_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  constraint property_owners_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade,
  constraint property_owners_property_client_key unique (property_id, client_id)
);
create index property_owners_organization_property_idx on public.property_owners (organization_id, property_id);
create index property_owners_organization_client_idx on public.property_owners (organization_id, client_id);
create index property_owners_client_id_idx on public.property_owners (client_id);
create index property_owners_created_by_idx on public.property_owners (created_by);

create trigger property_owners_set_updated_at
  before update on public.property_owners
  for each row execute function private.set_updated_at();
create trigger property_owners_lock_organization_id
  before update on public.property_owners
  for each row execute function private.lock_organization_id();

alter table public.property_owners enable row level security;

-- -----------------------------------------------------------------------------
-- keys e key_movements
-- -----------------------------------------------------------------------------
create table public.keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  location text check (char_length(location) <= 200),
  status public.key_status not null default 'available',
  notes text check (char_length(notes) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint keys_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  constraint keys_organization_id_id_key unique (organization_id, id)
);
create index keys_organization_property_idx on public.keys (organization_id, property_id);
create index keys_created_by_idx on public.keys (created_by);

create trigger keys_set_updated_at
  before update on public.keys
  for each row execute function private.set_updated_at();
create trigger keys_lock_organization_id
  before update on public.keys
  for each row execute function private.lock_organization_id();

alter table public.keys enable row level security;

create table public.key_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key_id uuid not null,
  taken_by_user uuid references auth.users (id) on delete set null,
  taken_by_client_id uuid,
  taken_at timestamptz not null default now(),
  due_at timestamptz,
  returned_at timestamptz,
  notes text check (char_length(notes) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint key_movements_key_fkey foreign key (organization_id, key_id)
    references public.keys (organization_id, id) on delete cascade,
  constraint key_movements_client_fkey foreign key (organization_id, taken_by_client_id)
    references public.clients (organization_id, id) on delete set null (taken_by_client_id),
  constraint key_movements_taker check (taken_by_user is not null or taken_by_client_id is not null),
  constraint key_movements_due_after_taken check (due_at is null or due_at >= taken_at),
  constraint key_movements_returned_after_taken check (returned_at is null or returned_at >= taken_at)
);
create index key_movements_organization_key_idx on public.key_movements (organization_id, key_id);
create index key_movements_organization_client_idx on public.key_movements (organization_id, taken_by_client_id);
create index key_movements_taken_by_user_idx on public.key_movements (taken_by_user);
create index key_movements_created_by_idx on public.key_movements (created_by);
-- Uma retirada em aberto por chave.
create unique index key_movements_one_open_per_key
  on public.key_movements (key_id)
  where returned_at is null;

create trigger key_movements_set_updated_at
  before update on public.key_movements
  for each row execute function private.set_updated_at();
create trigger key_movements_lock_organization_id
  before update on public.key_movements
  for each row execute function private.lock_organization_id();

-- Mantém keys.status coerente com as retiradas/devoluções.
create or replace function private.sync_key_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.keys k
  set status = case
    when exists (
      select 1 from public.key_movements km
      where km.key_id = k.id and km.returned_at is null
    ) then 'checked_out'::public.key_status
    else 'available'::public.key_status
  end
  where k.id = coalesce(new.key_id, old.key_id)
    and k.status <> 'lost';
  return null;
end;
$$;
revoke all on function private.sync_key_status() from public;

create trigger key_movements_sync_key_status
  after insert or update of returned_at or delete on public.key_movements
  for each row execute function private.sync_key_status();

alter table public.key_movements enable row level security;

-- -----------------------------------------------------------------------------
-- proposals
-- -----------------------------------------------------------------------------
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  client_id uuid not null,
  broker_id uuid default auth.uid() references auth.users (id) on delete set null,
  purpose public.listing_purpose not null
    constraint proposals_purpose_single check (purpose in ('sale', 'rent')),
  amount numeric(14, 2) not null check (amount > 0),
  payment_terms text check (char_length(payment_terms) <= 5000),
  conditions text check (char_length(conditions) <= 5000),
  valid_until date,
  status public.proposal_status not null default 'draft',
  decided_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposals_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  constraint proposals_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade
);
create index proposals_organization_property_idx on public.proposals (organization_id, property_id);
create index proposals_organization_client_idx on public.proposals (organization_id, client_id);
create index proposals_organization_status_idx on public.proposals (organization_id, status);
create index proposals_broker_id_idx on public.proposals (broker_id);
create index proposals_created_by_idx on public.proposals (created_by);

create trigger proposals_set_updated_at
  before update on public.proposals
  for each row execute function private.set_updated_at();
create trigger proposals_lock_organization_id
  before update on public.proposals
  for each row execute function private.lock_organization_id();

alter table public.proposals enable row level security;

-- -----------------------------------------------------------------------------
-- listing_authorizations (autorização de venda/locação e exclusividade)
-- -----------------------------------------------------------------------------
create table public.listing_authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid not null,
  owner_client_id uuid not null,
  exclusive boolean not null default false,
  starts_on date not null default current_date,
  ends_on date,
  commission_percent numeric(5, 2) check (commission_percent >= 0 and commission_percent <= 100),
  document_path text check (char_length(document_path) <= 1024),
  signed_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listing_authorizations_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  constraint listing_authorizations_owner_client_fkey foreign key (organization_id, owner_client_id)
    references public.clients (organization_id, id) on delete cascade,
  constraint listing_authorizations_period check (ends_on is null or ends_on >= starts_on)
);
create index listing_authorizations_organization_property_idx
  on public.listing_authorizations (organization_id, property_id);
create index listing_authorizations_organization_owner_idx
  on public.listing_authorizations (organization_id, owner_client_id);
create index listing_authorizations_created_by_idx on public.listing_authorizations (created_by);

create trigger listing_authorizations_set_updated_at
  before update on public.listing_authorizations
  for each row execute function private.set_updated_at();
create trigger listing_authorizations_lock_organization_id
  before update on public.listing_authorizations
  for each row execute function private.lock_organization_id();

alter table public.listing_authorizations enable row level security;

-- -----------------------------------------------------------------------------
-- capture_requests (formulário público de captação)
-- -----------------------------------------------------------------------------
create table public.capture_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_name text not null check (char_length(owner_name) between 2 and 120),
  owner_email text check (char_length(owner_email) <= 254),
  owner_phone text check (owner_phone ~ '^[0-9]{10,13}$'),
  purpose public.listing_purpose not null,
  type public.property_type,
  postal_code text constraint capture_requests_postal_code_format check (postal_code ~ '^[0-9]{8}$'),
  neighborhood text check (char_length(neighborhood) <= 120),
  city text check (char_length(city) <= 120),
  state text constraint capture_requests_state_format check (state ~ '^[A-Z]{2}$'),
  expected_price numeric(14, 2) check (expected_price >= 0),
  message text check (char_length(message) <= 2000),
  consent_at timestamptz not null,
  status public.capture_request_status not null default 'new',
  converted_property_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capture_requests_contact check (owner_email is not null or owner_phone is not null),
  constraint capture_requests_converted_property_fkey foreign key (organization_id, converted_property_id)
    references public.properties (organization_id, id) on delete set null (converted_property_id)
);
create index capture_requests_organization_status_idx
  on public.capture_requests (organization_id, status, created_at desc);
create index capture_requests_organization_property_idx
  on public.capture_requests (organization_id, converted_property_id);

create trigger capture_requests_set_updated_at
  before update on public.capture_requests
  for each row execute function private.set_updated_at();
create trigger capture_requests_lock_organization_id
  before update on public.capture_requests
  for each row execute function private.lock_organization_id();

alter table public.capture_requests enable row level security;
