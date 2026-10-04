-- =============================================================================
-- 0200 - Base: organizations, profiles, memberships, invitations, audit_events
-- =============================================================================

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    constraint organizations_slug_format
      check (char_length(slug) between 3 and 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  legal_name text check (char_length(legal_name) <= 200),
  -- CNPJ com 14 caracteres; aceita o formato alfanumérico da Receita (jul/2026):
  -- 12 posições [0-9A-Z] + 2 dígitos verificadores numéricos.
  cnpj text constraint organizations_cnpj_format check (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  creci text check (char_length(creci) <= 30),
  city text check (char_length(city) <= 120),
  state text constraint organizations_state_format check (state ~ '^[A-Z]{2}$'),
  phone text check (char_length(phone) <= 30),
  email text check (char_length(email) <= 254),
  plan public.organization_plan not null default 'small',
  brand jsonb not null default '{}'::jsonb check (jsonb_typeof(brand) = 'object'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organizations_created_by_idx on public.organizations (created_by);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

alter table public.organizations enable row level security;

-- -----------------------------------------------------------------------------
-- profiles (1:1 com auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) <= 160),
  -- Cópia do e-mail de auth.users (mantida por trigger) para a tela de equipe.
  email text,
  phone text check (char_length(phone) <= 30),
  avatar_url text check (char_length(avatar_url) <= 2048),
  creci_number text check (char_length(creci_number) <= 30),
  creci_state text constraint profiles_creci_state_format check (creci_state ~ '^[A-Z]{2}$'),
  creci_valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;

-- Cria o profile quando um usuário se cadastra no Supabase Auth.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Mantém profiles.email sincronizado com auth.users.email.
create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;
revoke all on function private.handle_user_email_change() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- memberships
-- -----------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_user_organization_key unique (user_id, organization_id)
);
create index memberships_organization_id_idx on public.memberships (organization_id);
create index memberships_created_by_idx on public.memberships (created_by);

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function private.set_updated_at();
create trigger memberships_lock_organization_id
  before update on public.memberships
  for each row execute function private.lock_organization_id();

alter table public.memberships enable row level security;

-- Garante que a imobiliária nunca fique sem um owner ativo.
create or replace function private.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'owner' or not old.active then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and new.role = 'owner' and new.active then
    return new;
  end if;

  -- Exclusão em cascata da própria organização: permitir.
  if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.organization_id = old.organization_id
      and m.id <> old.id
      and m.role = 'owner'
      and m.active
  ) then
    raise exception 'A imobiliária precisa manter pelo menos um dono ativo.'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;
revoke all on function private.protect_last_owner() from public;

create trigger memberships_protect_last_owner
  before update or delete on public.memberships
  for each row execute function private.protect_last_owner();

-- -----------------------------------------------------------------------------
-- invitations
-- -----------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null
    constraint invitations_email_format
      check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.app_role not null,
  -- 64 caracteres hex vindos de dois uuid v4 (gerador criptográfico).
  token text not null unique
    default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invited_by uuid default auth.uid() references auth.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invitations_organization_id_idx on public.invitations (organization_id);
create index invitations_invited_by_idx on public.invitations (invited_by);
create index invitations_accepted_by_idx on public.invitations (accepted_by);
-- Um convite pendente por e-mail em cada imobiliária.
create unique index invitations_pending_email_key
  on public.invitations (organization_id, email)
  where accepted_at is null;

create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function private.set_updated_at();
create trigger invitations_lock_organization_id
  before update on public.invitations
  for each row execute function private.lock_organization_id();

alter table public.invitations enable row level security;

-- -----------------------------------------------------------------------------
-- audit_events (LGPD) - somente triggers/RPCs security definer escrevem aqui
-- -----------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_organization_id_created_at_idx
  on public.audit_events (organization_id, created_at desc);
create index audit_events_actor_id_idx on public.audit_events (actor_id);
create index audit_events_entity_idx on public.audit_events (entity, entity_id);

alter table public.audit_events enable row level security;

-- -----------------------------------------------------------------------------
-- Funções auxiliares de autorização (schema private)
-- -----------------------------------------------------------------------------
create or replace function private.is_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.active
  );
$$;

create or replace function private.has_role(org uuid, roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = any (roles)
  );
$$;

-- Verdadeiro se o usuário atual e "other_user" estão ativos em alguma imobiliária em comum.
create or replace function private.shares_organization(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.active
      and theirs.user_id = other_user
  );
$$;

revoke all on function private.is_member(uuid) from public;
revoke all on function private.has_role(uuid, public.app_role[]) from public;
revoke all on function private.shares_organization(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, public.app_role[]) to authenticated;
grant execute on function private.shares_organization(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: criar imobiliária (org + membership owner na mesma transação)
-- -----------------------------------------------------------------------------
-- Decisão: a criação é feita SOMENTE por esta RPC. Não há política de INSERT em
-- organizations para "authenticated". Assim o criador sempre vira owner e o
-- problema de "insert ... returning" x política de SELECT (que exige membership)
-- não existe.
create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_legal_name text default null,
  p_cnpj text default null,
  p_creci text default null,
  p_city text default null,
  p_state text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_cnpj text := nullif(upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_state text := nullif(upper(btrim(coalesce(p_state, ''))), '');
  v_org uuid;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado para criar uma imobiliária.'
      using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'Informe o nome da imobiliária (2 a 160 caracteres).'
      using errcode = '22023';
  end if;

  if char_length(v_slug) < 3 or char_length(v_slug) > 60
     or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Endereço inválido: use de 3 a 60 letras minúsculas, números e hífens.'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    raise exception 'O endereço "%" já está em uso. Escolha outro.', v_slug
      using errcode = '23505';
  end if;

  if v_state is not null and v_state !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida: use a sigla com 2 letras.'
      using errcode = '22023';
  end if;

  if v_cnpj is not null and v_cnpj !~ '^[0-9A-Z]{12}[0-9]{2}$' then
    raise exception 'CNPJ inválido: informe os 14 caracteres.'
      using errcode = '22023';
  end if;

  insert into public.organizations (slug, name, legal_name, cnpj, creci, city, state, created_by)
  values (
    v_slug,
    v_name,
    nullif(btrim(p_legal_name), ''),
    v_cnpj,
    nullif(btrim(p_creci), ''),
    nullif(btrim(p_city), ''),
    v_state,
    v_user
  )
  returning id into v_org;

  insert into public.memberships (organization_id, user_id, role, active, created_by)
  values (v_org, v_user, 'owner', true, v_user);

  return v_org;
exception
  when unique_violation then
    raise exception 'O endereço "%" já está em uso. Escolha outro.', v_slug
      using errcode = '23505';
end;
$$;

revoke all on function public.create_organization(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: aceitar convite
-- -----------------------------------------------------------------------------
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_invitation public.invitations%rowtype;
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado para aceitar o convite.'
      using errcode = '42501';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_user;

  select * into v_invitation
  from public.invitations i
  where i.token = p_token
  for update;

  if not found or v_invitation.accepted_at is not null then
    raise exception 'Convite inválido ou já utilizado.' using errcode = 'P0002';
  end if;

  if v_invitation.expires_at < now() then
    raise exception 'Este convite expirou. Peça um novo convite.' using errcode = '22023';
  end if;

  if v_email is null or v_email <> v_invitation.email then
    raise exception 'Este convite foi enviado para outro e-mail.' using errcode = '42501';
  end if;

  insert into public.memberships (organization_id, user_id, role, active, created_by)
  values (v_invitation.organization_id, v_user, v_invitation.role, true, v_invitation.invited_by)
  on conflict (user_id, organization_id)
  do update set active = true,
                -- nunca rebaixa um owner existente por convite
                role = case when public.memberships.role = 'owner'
                            then public.memberships.role
                            else excluded.role end;

  update public.invitations
  set accepted_at = now(), accepted_by = v_user
  where id = v_invitation.id;

  return v_invitation.organization_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
