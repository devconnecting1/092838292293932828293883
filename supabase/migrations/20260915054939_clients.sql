-- =============================================================================
-- 0300 - Clientes: clients, client_shares, client_interests, client_documents
-- =============================================================================
-- As referências internas usam FK composta (organization_id, <id>) para
-- garantir no banco que filhas e pais pertencem à MESMA imobiliária.

-- -----------------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.client_kind not null default 'pf',
  name text not null check (char_length(btrim(name)) between 1 and 200),
  trade_name text check (char_length(trade_name) <= 200),
  -- CPF: 11 dígitos. CNPJ: 14 caracteres (numérico ou alfanumérico da Receita).
  document text,
  rg text check (char_length(rg) <= 30),
  birth_date date,
  email text check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 30),
  whatsapp text check (char_length(whatsapp) <= 30),
  postal_code text constraint clients_postal_code_format check (postal_code ~ '^[0-9]{8}$'),
  street text check (char_length(street) <= 200),
  street_number text check (char_length(street_number) <= 20),
  complement text check (char_length(complement) <= 120),
  neighborhood text check (char_length(neighborhood) <= 120),
  city text check (char_length(city) <= 120),
  state text constraint clients_state_format check (state ~ '^[A-Z]{2}$'),
  source text check (char_length(source) <= 60),
  tags text[] not null default '{}',
  assigned_to uuid references auth.users (id) on delete set null,
  lgpd_consent_at timestamptz,
  lgpd_legal_basis text check (char_length(lgpd_legal_basis) <= 120),
  notes text check (char_length(notes) <= 10000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_document_format check (
    document is null
    or (kind = 'pf' and document ~ '^[0-9]{11}$')
    or (kind = 'pj' and document ~ '^[0-9A-Z]{12}[0-9]{2}$')
  ),
  constraint clients_organization_document_key unique (organization_id, document),
  constraint clients_organization_id_id_key unique (organization_id, id)
);
create index clients_organization_id_name_idx on public.clients (organization_id, name);
create index clients_assigned_to_idx on public.clients (assigned_to);
create index clients_created_by_idx on public.clients (created_by);
create index clients_tags_idx on public.clients using gin (tags);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function private.set_updated_at();
create trigger clients_lock_organization_id
  before update on public.clients
  for each row execute function private.lock_organization_id();

-- Corretor que cadastra um cliente sem responsável vira o responsável
-- (senão ele perderia o acesso à própria ficha logo após o insert).
create or replace function private.clients_default_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is null
     and exists (
       select 1 from public.memberships m
       where m.organization_id = new.organization_id
         and m.user_id = (select auth.uid())
         and m.active
         and m.role = 'broker'
     ) then
    new.assigned_to := (select auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function private.clients_default_assignee() from public;

create trigger clients_default_assignee
  before insert on public.clients
  for each row execute function private.clients_default_assignee();

alter table public.clients enable row level security;

-- -----------------------------------------------------------------------------
-- client_shares (compartilhamento entre corretores)
-- -----------------------------------------------------------------------------
create table public.client_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  shared_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_shares_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade,
  constraint client_shares_client_user_key unique (client_id, user_id)
);
create index client_shares_organization_client_idx on public.client_shares (organization_id, client_id);
create index client_shares_user_id_idx on public.client_shares (user_id);
create index client_shares_shared_by_idx on public.client_shares (shared_by);

create trigger client_shares_set_updated_at
  before update on public.client_shares
  for each row execute function private.set_updated_at();
create trigger client_shares_lock_organization_id
  before update on public.client_shares
  for each row execute function private.lock_organization_id();

alter table public.client_shares enable row level security;

-- -----------------------------------------------------------------------------
-- client_interests (perfil de busca; alimenta o match)
-- -----------------------------------------------------------------------------
create table public.client_interests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  purpose public.listing_purpose not null,
  types public.property_type[] not null default '{}',
  neighborhoods text[] not null default '{}',
  city text check (char_length(city) <= 120),
  min_price numeric(14, 2) check (min_price >= 0),
  max_price numeric(14, 2) check (max_price >= 0),
  min_bedrooms smallint check (min_bedrooms >= 0),
  min_parking smallint check (min_parking >= 0),
  notes text check (char_length(notes) <= 5000),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_interests_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade,
  constraint client_interests_price_range check (
    min_price is null or max_price is null or max_price >= min_price
  )
);
create index client_interests_organization_client_idx on public.client_interests (organization_id, client_id);
create index client_interests_active_idx on public.client_interests (organization_id) where active;
create index client_interests_created_by_idx on public.client_interests (created_by);

create trigger client_interests_set_updated_at
  before update on public.client_interests
  for each row execute function private.set_updated_at();
create trigger client_interests_lock_organization_id
  before update on public.client_interests
  for each row execute function private.lock_organization_id();

alter table public.client_interests enable row level security;

-- -----------------------------------------------------------------------------
-- client_documents (arquivos no bucket privado client-documents)
-- -----------------------------------------------------------------------------
create table public.client_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  storage_path text not null unique,
  mime_type text check (char_length(mime_type) <= 120),
  size_bytes bigint check (size_bytes >= 0),
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_documents_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade,
  -- Caminho no Storage: {organization_id}/clients/{client_id}/{arquivo}
  constraint client_documents_storage_path_format check (
    storage_path like organization_id::text || '/clients/' || client_id::text || '/_%'
  )
);
create index client_documents_organization_client_idx on public.client_documents (organization_id, client_id);
create index client_documents_uploaded_by_idx on public.client_documents (uploaded_by);

create trigger client_documents_set_updated_at
  before update on public.client_documents
  for each row execute function private.set_updated_at();
create trigger client_documents_lock_organization_id
  before update on public.client_documents
  for each row execute function private.lock_organization_id();

alter table public.client_documents enable row level security;
