-- =============================================================================
-- 0500 - Atendimento e agenda: activities, appointments, tasks
-- =============================================================================

-- -----------------------------------------------------------------------------
-- activities (linha do tempo de cliente e/ou imóvel)
-- -----------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid,
  property_id uuid,
  type public.activity_type not null,
  body text check (char_length(body) <= 10000),
  occurred_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade,
  constraint activities_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  constraint activities_target check (client_id is not null or property_id is not null)
);
create index activities_organization_client_idx on public.activities (organization_id, client_id, occurred_at desc);
create index activities_organization_property_idx on public.activities (organization_id, property_id, occurred_at desc);
create index activities_created_by_idx on public.activities (created_by);

create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function private.set_updated_at();
create trigger activities_lock_organization_id
  before update on public.activities
  for each row execute function private.lock_organization_id();

alter table public.activities enable row level security;

-- -----------------------------------------------------------------------------
-- appointments (visitas e compromissos)
-- -----------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  property_id uuid,
  client_id uuid,
  broker_id uuid default auth.uid() references auth.users (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status public.appointment_status not null default 'scheduled',
  meeting_point text check (char_length(meeting_point) <= 300),
  feedback text check (char_length(feedback) <= 5000),
  rating smallint check (rating between 1 and 5),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade,
  constraint appointments_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade,
  constraint appointments_period check (ends_at is null or ends_at > starts_at)
);
create index appointments_organization_starts_at_idx on public.appointments (organization_id, starts_at);
create index appointments_organization_property_idx on public.appointments (organization_id, property_id);
create index appointments_organization_client_idx on public.appointments (organization_id, client_id);
create index appointments_broker_starts_at_idx on public.appointments (broker_id, starts_at);
create index appointments_created_by_idx on public.appointments (created_by);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function private.set_updated_at();
create trigger appointments_lock_organization_id
  before update on public.appointments
  for each row execute function private.lock_organization_id();

alter table public.appointments enable row level security;

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  assignee_id uuid default auth.uid() references auth.users (id) on delete set null,
  due_at timestamptz,
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'open',
  client_id uuid,
  property_id uuid,
  completed_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade,
  constraint tasks_property_fkey foreign key (organization_id, property_id)
    references public.properties (organization_id, id) on delete cascade
);
create index tasks_organization_status_due_idx on public.tasks (organization_id, status, due_at);
create index tasks_organization_client_idx on public.tasks (organization_id, client_id);
create index tasks_organization_property_idx on public.tasks (organization_id, property_id);
create index tasks_assignee_status_idx on public.tasks (assignee_id, status);
create index tasks_created_by_idx on public.tasks (created_by);

-- completed_at acompanha o status.
create or replace function private.tasks_sync_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.tasks_sync_completed_at() from public;

create trigger tasks_sync_completed_at
  before insert or update of status, completed_at on public.tasks
  for each row execute function private.tasks_sync_completed_at();
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function private.set_updated_at();
create trigger tasks_lock_organization_id
  before update on public.tasks
  for each row execute function private.lock_organization_id();

alter table public.tasks enable row level security;
