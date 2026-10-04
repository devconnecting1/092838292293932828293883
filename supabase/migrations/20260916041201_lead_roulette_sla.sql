-- =============================================================================
-- 2400 - Rodízio (roleta) de leads, plantão, SLA de primeiro contato e histórico
-- =============================================================================
--  1. Colunas de atribuição e SLA em public.leads
--  2. public.lead_routing_settings (configuração por imobiliária)
--  3. public.lead_routing_members (fila do rodízio) e lead_routing_shifts (escala)
--  4. public.lead_stage_events e public.lead_assignment_events (histórico)
--  5. private.lead_notifications (fila de avisos por e-mail)
--  6. Funções do rodízio (janela, sorteio, entrega) e do SLA
--  7. Passada agendada (pg_cron a cada minuto) e webhook opcional (pg_net)
--  8. RPCs da sessão: roleta manual, reatribuição em massa, painel e métricas
--  9. RPCs do servidor Next: fila de avisos (chave do Vault)
-- 10. Lead novo entra pela roleta (trigger BEFORE INSERT em leads)
-- 11. Políticas RLS e grants por coluna
--
-- Regra do rodízio (espelhada em packages/core/src/leads/routing.ts):
--   1. menor cota do dia = leads recebidos hoje ÷ peso;
--   2. desempate: quem está há mais tempo sem receber (nunca recebeu vem antes);
--   3. desempate final: user_id (resultado determinístico).
-- Fora do horário de plantão o lead não é entregue: fica com routing_due_at na
-- próxima janela e a passada agendada o distribui quando ela chega.

-- -----------------------------------------------------------------------------
-- 1. Colunas de atribuição e SLA em public.leads
-- -----------------------------------------------------------------------------
alter table public.leads
  add column if not exists assigned_at timestamptz,
  add column if not exists first_response_due_at timestamptz,
  add column if not exists sla_warned_at timestamptz,
  add column if not exists sla_reassignments smallint not null default 0,
  add column if not exists routing_due_at timestamptz;

alter table public.leads
  drop constraint if exists leads_sla_reassignments_range;
alter table public.leads
  add constraint leads_sla_reassignments_range
  check (sla_reassignments between 0 and 100);

comment on column public.leads.assigned_at is
  'Quando o responsável atual recebeu o lead. Preenchido pelo trigger leads_before_write; o app não escreve.';
comment on column public.leads.first_response_due_at is
  'Prazo do primeiro contato (assigned_at + lead_routing_settings.sla_minutes). Nulo quando não há prazo correndo: sem responsável, fora da etapa "Novo" ou já contatado.';
comment on column public.leads.sla_warned_at is
  'Quando saiu o aviso "o prazo vai estourar" (um por atribuição).';
comment on column public.leads.sla_reassignments is
  'Quantas vezes o lead voltou para a roleta por estouro do prazo.';
comment on column public.leads.routing_due_at is
  'Lead esperando a próxima janela de plantão: a passada agendada tenta distribuí-lo a partir deste instante.';

-- Índices das varreduras da passada agendada (parciais: só o que está em jogo).
create index if not exists leads_first_response_due_idx
  on public.leads (first_response_due_at)
  where first_response_due_at is not null;
create index if not exists leads_routing_due_idx
  on public.leads (routing_due_at)
  where routing_due_at is not null;

-- -----------------------------------------------------------------------------
-- 2. public.lead_routing_settings
-- -----------------------------------------------------------------------------
create table if not exists public.lead_routing_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- Desligado por padrão: quem não configurou a fila continua com a regra antiga
  -- (responsável fixo da landing page + corretor assume lead sem dono).
  roulette_enabled boolean not null default false,
  respect_schedule boolean not null default true,
  -- Sem ninguém de plantão, cair no responsável fixo da landing page.
  fallback_to_page_assignee boolean not null default true,
  sla_minutes integer not null default 5
    constraint lead_routing_settings_sla_minutes_range check (sla_minutes between 1 and 1440),
  sla_reassign_enabled boolean not null default true,
  sla_warning_percent smallint not null default 70
    constraint lead_routing_settings_warning_range check (sla_warning_percent between 10 and 95),
  max_reassignments smallint not null default 3
    constraint lead_routing_settings_max_reassignments_range check (max_reassignments between 0 and 10),
  time_zone text not null default 'America/Sao_Paulo'
    constraint lead_routing_settings_time_zone_format check (char_length(time_zone) between 3 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lead_routing_settings is
  'Configuração do rodízio de leads e do SLA de primeiro contato, por imobiliária. Sem linha = rodízio desligado e prazo de 5 min.';

-- -----------------------------------------------------------------------------
-- 3. Fila do rodízio e escala de plantão
-- -----------------------------------------------------------------------------
create table if not exists public.lead_routing_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  active boolean not null default true,
  weight smallint not null default 1
    constraint lead_routing_members_weight_range check (weight between 1 and 10),
  daily_limit integer
    constraint lead_routing_members_daily_limit_range check (daily_limit between 1 and 500),
  away_from timestamptz,
  away_until timestamptz,
  -- Estado de justiça do rodízio: só o banco escreve.
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_routing_members_organization_user_key unique (organization_id, user_id),
  constraint lead_routing_members_organization_id_id_key unique (organization_id, id),
  constraint lead_routing_members_away_range
    check (away_from is null or away_until is null or away_until > away_from)
);
create index if not exists lead_routing_members_organization_active_idx
  on public.lead_routing_members (organization_id, active);
create index if not exists lead_routing_members_user_idx
  on public.lead_routing_members (user_id);

comment on table public.lead_routing_members is
  'Corretores que participam do rodízio, com peso, limite diário e período de férias/ausência. last_assigned_at é mantido pelo trigger de histórico.';

create table if not exists public.lead_routing_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid not null,
  -- 0 = domingo … 6 = sábado (igual a extract(dow)).
  weekday smallint not null
    constraint lead_routing_shifts_weekday_range check (weekday between 0 and 6),
  start_minute smallint not null
    constraint lead_routing_shifts_start_range check (start_minute between 0 and 1439),
  end_minute smallint not null
    constraint lead_routing_shifts_end_range check (end_minute between 1 and 1440),
  created_at timestamptz not null default now(),
  constraint lead_routing_shifts_window check (end_minute > start_minute),
  constraint lead_routing_shifts_member_fkey foreign key (organization_id, member_id)
    references public.lead_routing_members (organization_id, id) on delete cascade,
  constraint lead_routing_shifts_member_weekday_key unique (member_id, weekday, start_minute)
);
create index if not exists lead_routing_shifts_member_weekday_idx
  on public.lead_routing_shifts (member_id, weekday, start_minute);
create index if not exists lead_routing_shifts_organization_idx
  on public.lead_routing_shifts (organization_id);

comment on table public.lead_routing_shifts is
  'Janelas de atendimento (plantão) por corretor, em minutos desde 00:00 no fuso da imobiliária. Corretor sem nenhuma janela atende sempre.';

-- Fuso válido e teto de janelas por corretor.
create or replace function private.lead_routing_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'lead_routing_settings' then
    new.time_zone := btrim(coalesce(new.time_zone, 'America/Sao_Paulo'));

    if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = new.time_zone) then
      raise exception 'Fuso horário inválido: use por exemplo America/Sao_Paulo.'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'lead_routing_shifts' then
    if tg_op = 'INSERT' and (
      select count(*) from public.lead_routing_shifts s where s.member_id = new.member_id
    ) >= 21 then
      raise exception 'Cada corretor pode ter no máximo 21 janelas de plantão.'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'lead_routing_members' then
    if tg_op = 'INSERT' and (
      select count(*) from public.lead_routing_members m
      where m.organization_id = new.organization_id
    ) >= 200 then
      raise exception 'A fila do rodízio aceita no máximo 200 corretores.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.lead_routing_before_write() from public, anon, authenticated;

drop trigger if exists lead_routing_settings_before_write on public.lead_routing_settings;
create trigger lead_routing_settings_before_write
  before insert or update on public.lead_routing_settings
  for each row execute function private.lead_routing_before_write();
drop trigger if exists lead_routing_settings_set_updated_at on public.lead_routing_settings;
create trigger lead_routing_settings_set_updated_at
  before update on public.lead_routing_settings
  for each row execute function private.set_updated_at();

drop trigger if exists lead_routing_members_before_write on public.lead_routing_members;
create trigger lead_routing_members_before_write
  before insert on public.lead_routing_members
  for each row execute function private.lead_routing_before_write();
drop trigger if exists lead_routing_members_lock_organization_id on public.lead_routing_members;
create trigger lead_routing_members_lock_organization_id
  before update on public.lead_routing_members
  for each row execute function private.lock_organization_id();
drop trigger if exists lead_routing_members_set_updated_at on public.lead_routing_members;
create trigger lead_routing_members_set_updated_at
  before update on public.lead_routing_members
  for each row execute function private.set_updated_at();
drop trigger if exists lead_routing_members_validate_members on public.lead_routing_members;
create trigger lead_routing_members_validate_members
  before insert or update of user_id on public.lead_routing_members
  for each row execute function private.validate_member_columns(
    'user_id', 'O corretor do rodízio'
  );

drop trigger if exists lead_routing_shifts_before_write on public.lead_routing_shifts;
create trigger lead_routing_shifts_before_write
  before insert on public.lead_routing_shifts
  for each row execute function private.lead_routing_before_write();

alter table public.lead_routing_settings enable row level security;
alter table public.lead_routing_members enable row level security;
alter table public.lead_routing_shifts enable row level security;

-- -----------------------------------------------------------------------------
-- 4. Histórico de etapa e de responsável
-- -----------------------------------------------------------------------------
create table if not exists public.lead_stage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  from_stage public.lead_stage,
  to_stage public.lead_stage not null,
  changed_by uuid references auth.users (id) on delete set null,
  reason text
    constraint lead_stage_events_reason_format check (char_length(reason) <= 40),
  created_at timestamptz not null default now(),
  constraint lead_stage_events_lead_fkey foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete cascade
);
create index if not exists lead_stage_events_lead_idx
  on public.lead_stage_events (organization_id, lead_id, created_at);
create index if not exists lead_stage_events_stage_idx
  on public.lead_stage_events (organization_id, to_stage, created_at desc);
create index if not exists lead_stage_events_changed_by_idx
  on public.lead_stage_events (changed_by);

comment on table public.lead_stage_events is
  'Histórico de etapa do lead (etapa anterior, nova etapa, quem mudou e quando), alimentado pelo trigger leads_log_events. Base da conversão por etapa e do tempo em cada fase.';

create table if not exists public.lead_assignment_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null,
  from_user_id uuid references auth.users (id) on delete set null,
  to_user_id uuid references auth.users (id) on delete set null,
  changed_by uuid references auth.users (id) on delete set null,
  reason text not null default 'manual'
    constraint lead_assignment_events_reason_check check (
      reason in (
        'created', 'manual', 'claim', 'roulette', 'landing_page', 'sla_reassign',
        'sla_queued', 'bulk_transfer', 'bulk_release', 'member_removed'
      )
    ),
  created_at timestamptz not null default now(),
  constraint lead_assignment_events_lead_fkey foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete cascade
);
create index if not exists lead_assignment_events_lead_idx
  on public.lead_assignment_events (organization_id, lead_id, created_at);
create index if not exists lead_assignment_events_to_user_idx
  on public.lead_assignment_events (organization_id, to_user_id, created_at desc);
create index if not exists lead_assignment_events_from_user_idx
  on public.lead_assignment_events (from_user_id);
create index if not exists lead_assignment_events_changed_by_idx
  on public.lead_assignment_events (changed_by);

comment on table public.lead_assignment_events is
  'Histórico de responsável pelo lead, com o motivo (roleta, estouro de SLA, transferência em massa…). Alimenta o limite diário e a justiça do rodízio.';

alter table public.lead_stage_events enable row level security;
alter table public.lead_assignment_events enable row level security;

-- Motivo do evento: a RPC/passada informa em app.lead_event_reason (transação).
create or replace function private.leads_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := left(nullif(btrim(coalesce(current_setting('app.lead_event_reason', true), '')), ''), 40);
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.lead_stage_events (
      organization_id, lead_id, from_stage, to_stage, changed_by, reason
    )
    values (new.organization_id, new.id, null, new.stage, v_actor, coalesce(v_reason, 'created'));

    if new.assigned_to is not null then
      insert into public.lead_assignment_events (
        organization_id, lead_id, from_user_id, to_user_id, changed_by, reason
      )
      values (
        new.organization_id, new.id, null, new.assigned_to, v_actor,
        case
          when v_reason in (
            'created', 'manual', 'claim', 'roulette', 'landing_page', 'sla_reassign',
            'sla_queued', 'bulk_transfer', 'bulk_release', 'member_removed'
          ) then v_reason
          else 'created'
        end
      );

      update public.lead_routing_members m
      set last_assigned_at = now()
      where m.organization_id = new.organization_id
        and m.user_id = new.assigned_to;
    end if;

    return null;
  end if;

  if new.stage is distinct from old.stage then
    insert into public.lead_stage_events (
      organization_id, lead_id, from_stage, to_stage, changed_by, reason
    )
    values (new.organization_id, new.id, old.stage, new.stage, v_actor, v_reason);
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_assignment_events (
      organization_id, lead_id, from_user_id, to_user_id, changed_by, reason
    )
    values (
      new.organization_id, new.id, old.assigned_to, new.assigned_to, v_actor,
      case
        when v_reason in (
          'created', 'manual', 'claim', 'roulette', 'landing_page', 'sla_reassign',
          'sla_queued', 'bulk_transfer', 'bulk_release', 'member_removed'
        ) then v_reason
        else 'manual'
      end
    );

    if new.assigned_to is not null then
      update public.lead_routing_members m
      set last_assigned_at = now()
      where m.organization_id = new.organization_id
        and m.user_id = new.assigned_to;
    end if;
  end if;

  return null;
end;
$$;

revoke all on function private.leads_log_events() from public, anon, authenticated;

drop trigger if exists leads_log_events on public.leads;
create trigger leads_log_events
  after insert or update of stage, assigned_to on public.leads
  for each row execute function private.leads_log_events();

-- -----------------------------------------------------------------------------
-- 5. Fila de avisos por e-mail (schema private: fora da API)
-- -----------------------------------------------------------------------------
create table if not exists private.lead_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null
    constraint lead_notifications_kind_check
      check (kind in ('assigned', 'sla_warning', 'sla_reassigned', 'sla_lost')),
  -- Número da rodada (leads.sla_reassignments): o mesmo corretor pode receber o
  -- mesmo lead de novo numa rodada seguinte.
  round smallint not null default 0,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts smallint not null default 0,
  constraint lead_notifications_unique unique (lead_id, user_id, kind, round)
);
create index if not exists lead_notifications_pending_idx
  on private.lead_notifications (created_at)
  where sent_at is null;

comment on table private.lead_notifications is
  'Fila de avisos de lead por e-mail (recebeu lead, prazo acabando, lead redistribuído). Drenada por public.claim_lead_notifications; registros enviados com mais de 7 dias são apagados pela passada agendada.';

alter table private.lead_notifications enable row level security;
revoke all on table private.lead_notifications from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Funções do rodízio e do SLA
-- -----------------------------------------------------------------------------

-- Configuração com os padrões de quem ainda não configurou nada.
create or replace function private.lead_routing_config(p_organization_id uuid)
returns public.lead_routing_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.lead_routing_settings;
begin
  select s.* into v
  from public.lead_routing_settings s
  where s.organization_id = p_organization_id;

  if not found then
    v.organization_id := p_organization_id;
    v.roulette_enabled := false;
    v.respect_schedule := true;
    v.fallback_to_page_assignee := true;
    v.sla_minutes := 5;
    v.sla_reassign_enabled := true;
    v.sla_warning_percent := 70;
    v.max_reassignments := 3;
    v.time_zone := 'America/Sao_Paulo';
  end if;

  return v;
end;
$$;

-- Prazo configurado (o trigger de leads chama a cada escrita).
create or replace function private.lead_sla_minutes(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.sla_minutes from public.lead_routing_settings s
      where s.organization_id = p_organization_id),
    5
  );
$$;

revoke all on function private.lead_routing_config(uuid) from public, anon, authenticated;
revoke all on function private.lead_sla_minutes(uuid) from public, anon;
-- leads_before_write roda com o papel de quem escreve o lead.
grant execute on function private.lead_sla_minutes(uuid) to authenticated;

-- Dia da semana e minuto do dia no fuso da imobiliária (fuso inválido = Brasília).
create or replace function private.lead_routing_clock(
  p_at timestamptz,
  p_time_zone text,
  out weekday smallint,
  out minute_of_day integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp;
begin
  begin
    v_local := p_at at time zone coalesce(nullif(btrim(p_time_zone), ''), 'America/Sao_Paulo');
  exception
    when others then
      v_local := p_at at time zone 'America/Sao_Paulo';
  end;

  weekday := extract(dow from v_local)::smallint;
  minute_of_day := (extract(hour from v_local) * 60 + extract(minute from v_local))::integer;
end;
$$;

revoke all on function private.lead_routing_clock(timestamptz, text) from public, anon, authenticated;

-- Corretor sem nenhuma janela cadastrada atende sempre.
create or replace function private.lead_on_shift(
  p_member_id uuid,
  p_weekday smallint,
  p_minute integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
      select 1 from public.lead_routing_shifts s where s.member_id = p_member_id
    )
    or exists (
      select 1
      from public.lead_routing_shifts s
      where s.member_id = p_member_id
        and s.weekday = p_weekday
        and p_minute >= s.start_minute
        and p_minute < s.end_minute
    );
$$;

revoke all on function private.lead_on_shift(uuid, smallint, integer) from public, anon, authenticated;

-- Está de férias/ausente no instante informado (sem período = nunca ausente).
create or replace function private.lead_member_away(
  p_from timestamptz,
  p_until timestamptz,
  p_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from is not null or p_until is not null)
     and (p_from is null or p_at >= p_from)
     and (p_until is null or p_at < p_until);
$$;

revoke all on function private.lead_member_away(timestamptz, timestamptz, timestamptz)
  from public, anon;
grant execute on function private.lead_member_away(timestamptz, timestamptz, timestamptz)
  to authenticated;

-- Início do dia da imobiliária (base do limite diário).
create or replace function private.lead_routing_day_start(p_at timestamptz, p_time_zone text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_zone text := coalesce(nullif(btrim(p_time_zone), ''), 'America/Sao_Paulo');
begin
  return date_trunc('day', p_at at time zone v_zone) at time zone v_zone;
exception
  when others then
    return date_trunc('day', p_at at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
end;
$$;

revoke all on function private.lead_routing_day_start(timestamptz, text) from public, anon, authenticated;

-- SORTEIO: próximo corretor da fila, ou null quando ninguém pode receber agora.
-- Toda a agregação (leads do dia, plantão, ausência, limite) acontece aqui.
create or replace function private.lead_routing_pick(
  p_organization_id uuid,
  p_at timestamptz default now(),
  p_exclude uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.lead_routing_settings;
  v_weekday smallint;
  v_minute integer;
  v_day_start timestamptz;
  v_exclude uuid[] := coalesce(p_exclude, '{}'::uuid[]);
  v_user uuid;
begin
  v_config := private.lead_routing_config(p_organization_id);

  select c.weekday, c.minute_of_day
    into v_weekday, v_minute
  from private.lead_routing_clock(p_at, v_config.time_zone) c;

  v_day_start := private.lead_routing_day_start(p_at, v_config.time_zone);

  select m.user_id
    into v_user
  from public.lead_routing_members m
  join public.memberships ms
    on ms.organization_id = m.organization_id
   and ms.user_id = m.user_id
   and ms.active
  cross join lateral (
    select count(*)::integer as assigned_today
    from public.lead_assignment_events e
    where e.organization_id = m.organization_id
      and e.to_user_id = m.user_id
      and e.created_at >= v_day_start
      and e.reason not in ('bulk_transfer', 'bulk_release')
  ) today
  where m.organization_id = p_organization_id
    and m.active
    and ms.role in ('owner', 'manager', 'assistant', 'broker')
    and not (m.user_id = any (v_exclude))
    and not private.lead_member_away(m.away_from, m.away_until, p_at)
    and (not v_config.respect_schedule or private.lead_on_shift(m.id, v_weekday, v_minute))
    and (m.daily_limit is null or today.assigned_today < m.daily_limit)
  order by
    today.assigned_today::numeric / greatest(m.weight, 1),
    coalesce(m.last_assigned_at, '-infinity'::timestamptz),
    m.user_id
  limit 1;

  return v_user;
end;
$$;

revoke all on function private.lead_routing_pick(uuid, timestamptz, uuid[]) from public, anon, authenticated;

-- Próxima janela de plantão da fila (para enfileirar o lead fora do horário).
create or replace function private.lead_routing_next_window(
  p_organization_id uuid,
  p_at timestamptz default now(),
  p_exclude uuid[] default '{}'::uuid[]
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.lead_routing_settings;
  v_weekday smallint;
  v_minute integer;
  v_exclude uuid[] := coalesce(p_exclude, '{}'::uuid[]);
  v_wait integer;
begin
  v_config := private.lead_routing_config(p_organization_id);

  if not v_config.respect_schedule then
    return null;
  end if;

  select c.weekday, c.minute_of_day
    into v_weekday, v_minute
  from private.lead_routing_clock(p_at, v_config.time_zone) c;

  select min(d.day_offset * 1440 + s.start_minute - v_minute)
    into v_wait
  from public.lead_routing_members m
  join public.memberships ms
    on ms.organization_id = m.organization_id
   and ms.user_id = m.user_id
   and ms.active
  join public.lead_routing_shifts s
    on s.member_id = m.id
  cross join generate_series(0, 7) as d(day_offset)
  where m.organization_id = p_organization_id
    and m.active
    and ms.role in ('owner', 'manager', 'assistant', 'broker')
    and not (m.user_id = any (v_exclude))
    and not private.lead_member_away(m.away_from, m.away_until, p_at)
    and s.weekday = ((v_weekday + d.day_offset) % 7)::smallint
    and (d.day_offset * 1440 + s.start_minute - v_minute) > 0;

  if v_wait is null then
    return null;
  end if;

  return p_at + make_interval(mins => v_wait);
end;
$$;

revoke all on function private.lead_routing_next_window(uuid, timestamptz, uuid[]) from public, anon, authenticated;

-- Existe alguém na fila que poderia receber em alguma hora?
create or replace function private.lead_routing_has_queue(
  p_organization_id uuid,
  p_at timestamptz default now(),
  p_exclude uuid[] default '{}'::uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lead_routing_members m
    join public.memberships ms
      on ms.organization_id = m.organization_id
     and ms.user_id = m.user_id
     and ms.active
    where m.organization_id = p_organization_id
      and m.active
      and ms.role in ('owner', 'manager', 'assistant', 'broker')
      and not (m.user_id = any (coalesce(p_exclude, '{}'::uuid[])))
      and not private.lead_member_away(m.away_from, m.away_until, p_at)
  );
$$;

revoke all on function private.lead_routing_has_queue(uuid, timestamptz, uuid[]) from public, anon, authenticated;

-- Enfileira um aviso por e-mail (só para quem tem e-mail confirmado).
create or replace function private.enqueue_lead_notification(
  p_lead_id uuid,
  p_user_id uuid,
  p_kind text,
  p_round smallint,
  p_due_at timestamptz default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.lead_notifications (
    organization_id, lead_id, user_id, kind, round, due_at
  )
  select l.organization_id, l.id, p_user_id, p_kind, coalesce(p_round, 0), p_due_at
  from public.leads l
  where l.id = p_lead_id
    and p_user_id is not null
    and exists (
      select 1 from auth.users u
      where u.id = p_user_id
        and u.email is not null
        and u.email_confirmed_at is not null
    )
  on conflict (lead_id, user_id, kind, round) do nothing;
$$;

revoke all on function private.enqueue_lead_notification(uuid, uuid, text, smallint, timestamptz)
  from public, anon, authenticated;

-- ENTREGA: sorteia e grava. Sem ninguém agora, o lead espera a próxima janela.
create or replace function private.route_lead(
  p_lead_id uuid,
  p_reason text default 'roulette',
  p_notify boolean default true,
  p_exclude uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_user uuid;
  v_next timestamptz;
  v_now timestamptz := now();
begin
  select l.id, l.organization_id, l.assigned_to, l.sla_reassignments, l.first_response_due_at
    into v_lead
  from public.leads l
  where l.id = p_lead_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_user := private.lead_routing_pick(v_lead.organization_id, v_now, p_exclude);

  perform set_config('app.lead_event_reason', coalesce(p_reason, 'roulette'), true);

  if v_user is not null then
    update public.leads
    set assigned_to = v_user,
        routing_due_at = null
    where id = p_lead_id;

    if p_notify then
      perform private.enqueue_lead_notification(
        p_lead_id,
        v_user,
        case when coalesce(p_reason, '') = 'sla_reassign' then 'sla_reassigned' else 'assigned' end,
        v_lead.sla_reassignments,
        (select l.first_response_due_at from public.leads l where l.id = p_lead_id)
      );
    end if;

    perform set_config('app.lead_event_reason', '', true);

    return jsonb_build_object('ok', true, 'assigned_to', v_user, 'queued_until', null);
  end if;

  -- Ninguém pode receber agora: espera a próxima janela de plantão.
  if not private.lead_routing_has_queue(v_lead.organization_id, v_now, p_exclude) then
    update public.leads
    set assigned_to = null,
        routing_due_at = null
    where id = p_lead_id;

    perform set_config('app.lead_event_reason', '', true);

    return jsonb_build_object('ok', false, 'reason', 'empty_queue', 'assigned_to', null);
  end if;

  v_next := coalesce(
    private.lead_routing_next_window(v_lead.organization_id, v_now, p_exclude),
    v_now + interval '15 minutes'
  );

  update public.leads
  set assigned_to = null,
      routing_due_at = v_next
  where id = p_lead_id;

  perform set_config('app.lead_event_reason', '', true);

  return jsonb_build_object('ok', true, 'assigned_to', null, 'queued_until', v_next);
end;
$$;

revoke all on function private.route_lead(uuid, text, boolean, uuid[]) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Prazo de primeiro contato no próprio trigger de escrita do lead
-- -----------------------------------------------------------------------------
-- Substitui private.leads_before_write da migração landing_pages_and_leads,
-- mantendo tudo o que ela já fazia e acrescentando assigned_at,
-- first_response_due_at e a reinicialização do aviso de SLA.
create or replace function private.leads_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '');
  new.message := nullif(btrim(coalesce(new.message, '')), '');
  new.typology := nullif(btrim(coalesce(new.typology, '')), '');
  new.lost_reason := nullif(btrim(coalesce(new.lost_reason, '')), '');

  if char_length(coalesce(new.name, '')) not between 2 and 120 then
    raise exception 'Informe o nome do lead (2 a 120 caracteres).' using errcode = '23514';
  end if;

  if new.email is not null and (
    char_length(new.email) > 254
    or new.email !~ '^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
    or position('..' in new.email) > 0
  ) then
    raise exception 'E-mail inválido.' using errcode = '23514';
  end if;

  if new.phone is not null and new.phone !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido: informe DDD e número.' using errcode = '23514';
  end if;

  if new.stage = 'lost' and new.lost_reason is null then
    raise exception 'Informe o motivo da perda do lead.' using errcode = '23514';
  end if;

  if new.stage <> 'new'
     and new.last_contact_at is null
     and (tg_op = 'INSERT' or old.stage = 'new') then
    new.last_contact_at := now();
  end if;

  -- Quando o responsável muda, o relógio do primeiro contato recomeça.
  if tg_op = 'INSERT' then
    new.assigned_at := case when new.assigned_to is not null then now() end;
  elsif new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is not null then now() end;
    new.sla_warned_at := null;
  end if;

  -- Prazo de primeiro contato: só com responsável, em "Novo" e sem contato.
  if new.assigned_to is null or new.stage <> 'new' or new.last_contact_at is not null then
    new.first_response_due_at := null;
  elsif tg_op = 'INSERT'
     or new.assigned_to is distinct from old.assigned_to
     or old.first_response_due_at is null then
    new.first_response_due_at := coalesce(new.assigned_at, now())
      + make_interval(mins => private.lead_sla_minutes(new.organization_id));
  end if;

  return new;
end;
$$;

revoke all on function private.leads_before_write() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Passada agendada: fila de espera, aviso e redistribuição
-- -----------------------------------------------------------------------------
create or replace function private.run_lead_routing_pass(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_assigned integer := 0;
  v_queued integer := 0;
  v_warned integer := 0;
  v_reassigned integer := 0;
  v_released integer := 0;
  v_result jsonb;
  rec record;
begin
  -- (a) Leads que estavam esperando a próxima janela de plantão.
  for rec in
    select l.id
    from public.leads l
    join public.lead_routing_settings s on s.organization_id = l.organization_id
    where s.roulette_enabled
      and l.assigned_to is null
      and l.stage = 'new'
      and l.routing_due_at is not null
      and l.routing_due_at <= v_now
    order by l.routing_due_at
    limit v_limit
  loop
    v_result := private.route_lead(rec.id, 'roulette', true, '{}'::uuid[]);

    if (v_result ->> 'assigned_to') is not null then
      v_assigned := v_assigned + 1;
    else
      v_queued := v_queued + 1;
    end if;
  end loop;

  -- (b) Aviso de prazo perto de estourar (um por atribuição).
  for rec in
    select l.id, l.assigned_to, l.first_response_due_at, l.sla_reassignments
    from public.leads l
    join public.lead_routing_settings s on s.organization_id = l.organization_id
    where l.stage = 'new'
      and l.last_contact_at is null
      and l.assigned_to is not null
      and l.sla_warned_at is null
      and l.first_response_due_at is not null
      and l.first_response_due_at > v_now
      and l.assigned_at is not null
      and v_now >= l.assigned_at
        + (l.first_response_due_at - l.assigned_at) * (s.sla_warning_percent::numeric / 100)
    order by l.first_response_due_at
    limit v_limit
  loop
    update public.leads
    set sla_warned_at = v_now
    where id = rec.id
      and sla_warned_at is null;

    if found then
      perform private.enqueue_lead_notification(
        rec.id, rec.assigned_to, 'sla_warning', rec.sla_reassignments, rec.first_response_due_at
      );
      v_warned := v_warned + 1;
    end if;
  end loop;

  -- (c) Prazo estourado: devolve para a roleta e entrega ao próximo corretor.
  for rec in
    select l.id, l.organization_id, l.assigned_to, l.sla_reassignments,
           l.first_response_due_at
    from public.leads l
    join public.lead_routing_settings s on s.organization_id = l.organization_id
    where s.roulette_enabled
      and s.sla_reassign_enabled
      and l.stage = 'new'
      and l.last_contact_at is null
      and l.assigned_to is not null
      and l.first_response_due_at is not null
      and l.first_response_due_at <= v_now
      and l.sla_reassignments < s.max_reassignments
    order by l.first_response_due_at
    limit v_limit
  loop
    -- Avisa quem perdeu o lead antes de trocar o responsável.
    perform private.enqueue_lead_notification(
      rec.id, rec.assigned_to, 'sla_lost', rec.sla_reassignments, rec.first_response_due_at
    );

    update public.leads
    set sla_reassignments = sla_reassignments + 1
    where id = rec.id;

    v_result := private.route_lead(rec.id, 'sla_reassign', true, array[rec.assigned_to]);

    if (v_result ->> 'assigned_to') is not null then
      v_reassigned := v_reassigned + 1;
    else
      v_released := v_released + 1;
    end if;
  end loop;

  -- (d) Limpeza: avisos já enviados há mais de 7 dias.
  delete from private.lead_notifications n
  where n.sent_at is not null
    and n.sent_at < v_now - interval '7 days';

  -- (e) Avisos presos (reivindicados e não confirmados) voltam para a fila.
  update private.lead_notifications n
  set claimed_at = null
  where n.sent_at is null
    and n.claimed_at is not null
    and n.claimed_at < v_now - interval '15 minutes'
    and n.attempts < 5;

  return jsonb_build_object(
    'assigned', v_assigned,
    'queued', v_queued,
    'warned', v_warned,
    'reassigned', v_reassigned,
    'released', v_released
  );
end;
$$;

comment on function private.run_lead_routing_pass(integer) is
  'Rotina agendada (pg_cron, job rodizio-de-leads, a cada minuto): entrega os leads que esperavam a próxima janela de plantão, avisa quem está perto de estourar o prazo de primeiro contato e redistribui os que estouraram. Devolve as contagens da passada.';

revoke all on function private.run_lead_routing_pass(integer) from public, anon, authenticated;

-- Aviso opcional ao servidor Next (pg_net) quando há e-mail na fila. Só dispara
-- com os dois segredos configurados no Vault; ver supabase/README.md.
create or replace function private.ping_lead_alerts_webhook()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from private.lead_notifications n
    where n.sent_at is null and n.claimed_at is null
  ) then
    return false;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'lead_alerts_webhook_url'
  limit 1;

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'lead_alerts_webhook_secret'
  limit 1;

  if v_url is null or v_secret is null or v_url !~* '^https://' then
    return false;
  end if;

  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 5000
  );

  return true;
exception
  when others then
    -- Webhook é conveniência: falha nunca derruba a passada.
    return false;
end;
$$;

revoke all on function private.ping_lead_alerts_webhook() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'rodizio-de-leads') then
    perform cron.unschedule('rodizio-de-leads');
  end if;
end;
$$;

select cron.schedule(
  'rodizio-de-leads',
  '* * * * *',
  $cron$
    select private.run_lead_routing_pass(200);
    select private.ping_lead_alerts_webhook();
  $cron$
);

-- -----------------------------------------------------------------------------
-- 8. RPCs da sessão
-- -----------------------------------------------------------------------------

-- Distribuir um lead pela roleta (botão da tela do lead).
create or replace function public.assign_lead_from_roulette(
  p_organization_id uuid,
  p_lead_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead record;
  v_config public.lead_routing_settings;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    raise exception 'Seu papel não permite distribuir leads pela roleta.' using errcode = '42501';
  end if;

  select l.id, l.assigned_to, l.stage
    into v_lead
  from public.leads l
  where l.id = p_lead_id
    and l.organization_id = p_organization_id;

  if not found then
    raise exception 'Lead não encontrado.' using errcode = 'P0002';
  end if;

  v_config := private.lead_routing_config(p_organization_id);

  if not v_config.roulette_enabled then
    raise exception 'Ligue o rodízio de leads nas configurações antes de distribuir.'
      using errcode = '22023';
  end if;

  v_result := private.route_lead(
    p_lead_id,
    'roulette',
    true,
    case when v_lead.assigned_to is null then '{}'::uuid[] else array[v_lead.assigned_to] end
  );

  return v_result;
end;
$$;

comment on function public.assign_lead_from_roulette(uuid, uuid) is
  'Entrega o lead ao próximo corretor da roleta (dono, gerente ou assistente). Devolve {ok, assigned_to, queued_until}. Fora do horário de plantão, o lead fica na fila da próxima janela.';

revoke all on function public.assign_lead_from_roulette(uuid, uuid) from public, anon;
grant execute on function public.assign_lead_from_roulette(uuid, uuid) to authenticated;

-- Reatribuição em massa: corretor saiu, os leads dele vão para outro ou voltam
-- para a roleta, numa ação só.
create or replace function public.bulk_reassign_leads(
  p_organization_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid default null,
  p_include_closed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.lead_routing_settings;
  v_ids uuid[];
  v_lead_id uuid;
  v_moved integer := 0;
  v_queued integer := 0;
  v_unassigned integer := 0;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.has_role(p_organization_id, '{owner,manager}') then
    raise exception 'Só dono e gerente reatribuem leads em massa.' using errcode = '42501';
  end if;

  if p_from_user_id is null then
    raise exception 'Informe de quem são os leads.' using errcode = '22023';
  end if;

  if p_to_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_to_user_id
      and m.active
  ) then
    raise exception 'O novo responsável precisa ser um membro ativo da imobiliária.'
      using errcode = '23514';
  end if;

  if p_to_user_id = p_from_user_id then
    raise exception 'Escolha um responsável diferente do atual.' using errcode = '22023';
  end if;

  v_config := private.lead_routing_config(p_organization_id);

  select coalesce(array_agg(l.id order by l.created_at), '{}'::uuid[])
    into v_ids
  from (
    select l.id, l.created_at
    from public.leads l
    where l.organization_id = p_organization_id
      and l.assigned_to = p_from_user_id
      and (p_include_closed or l.stage not in ('won', 'lost'))
    order by l.created_at
    limit 2000
  ) l;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object('moved', 0, 'queued', 0, 'unassigned', 0, 'mode',
      case when p_to_user_id is null then 'roulette' else 'transfer' end);
  end if;

  if p_to_user_id is not null then
    perform set_config('app.lead_event_reason', 'bulk_transfer', true);

    update public.leads l
    set assigned_to = p_to_user_id
    where l.organization_id = p_organization_id
      and l.id = any (v_ids);

    get diagnostics v_moved = row_count;
    perform set_config('app.lead_event_reason', '', true);

    return jsonb_build_object('moved', v_moved, 'queued', 0, 'unassigned', 0, 'mode', 'transfer');
  end if;

  -- Sem destino: volta para a roleta (ou fica sem responsável quando ela está
  -- desligada, que é o comportamento de hoje).
  if not v_config.roulette_enabled then
    perform set_config('app.lead_event_reason', 'bulk_release', true);

    update public.leads l
    set assigned_to = null
    where l.organization_id = p_organization_id
      and l.id = any (v_ids);

    get diagnostics v_unassigned = row_count;
    perform set_config('app.lead_event_reason', '', true);

    return jsonb_build_object(
      'moved', 0, 'queued', 0, 'unassigned', v_unassigned, 'mode', 'release'
    );
  end if;

  foreach v_lead_id in array v_ids loop
    v_result := private.route_lead(v_lead_id, 'bulk_release', true, array[p_from_user_id]);

    if (v_result ->> 'assigned_to') is not null then
      v_moved := v_moved + 1;
    elsif (v_result ->> 'queued_until') is not null then
      v_queued := v_queued + 1;
    else
      v_unassigned := v_unassigned + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'moved', v_moved, 'queued', v_queued, 'unassigned', v_unassigned, 'mode', 'roulette'
  );
end;
$$;

comment on function public.bulk_reassign_leads(uuid, uuid, uuid, boolean) is
  'Transfere de uma vez os leads de um corretor para outro (p_to_user_id) ou devolve todos para a roleta (p_to_user_id nulo). Só dono e gerente; até 2.000 leads por chamada; registra o motivo em lead_assignment_events.';

revoke all on function public.bulk_reassign_leads(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.bulk_reassign_leads(uuid, uuid, uuid, boolean) to authenticated;

-- Painel do rodízio: tudo agregado no banco (nenhuma lista desce para o Node).
create or replace function public.get_lead_routing_overview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.lead_routing_settings;
  v_now timestamptz := now();
  v_weekday smallint;
  v_minute integer;
  v_day_start timestamptz;
  v_members jsonb;
  v_totals jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    raise exception 'Você não tem acesso ao rodízio desta imobiliária.' using errcode = '42501';
  end if;

  v_config := private.lead_routing_config(p_organization_id);

  select c.weekday, c.minute_of_day into v_weekday, v_minute
  from private.lead_routing_clock(v_now, v_config.time_zone) c;

  v_day_start := private.lead_routing_day_start(v_now, v_config.time_zone);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'user_id', m.user_id,
        'role', ms.role,
        'member_active', ms.active,
        'active', m.active,
        'weight', m.weight,
        'daily_limit', m.daily_limit,
        'away_from', m.away_from,
        'away_until', m.away_until,
        'away_now', private.lead_member_away(m.away_from, m.away_until, v_now),
        'on_shift', private.lead_on_shift(m.id, v_weekday, v_minute),
        'last_assigned_at', m.last_assigned_at,
        'assigned_today', stats.assigned_today,
        'open_leads', stats.open_leads,
        'overdue_leads', stats.overdue_leads,
        'avg_first_response_minutes', stats.avg_minutes,
        'shifts', coalesce(shifts.items, '[]'::jsonb)
      )
      order by ms.active desc, m.active desc, m.user_id
    ),
    '[]'::jsonb
  )
  into v_members
  from public.lead_routing_members m
  left join public.memberships ms
    on ms.organization_id = m.organization_id
   and ms.user_id = m.user_id
  cross join lateral (
    select
      (
        select count(*)::integer
        from public.lead_assignment_events e
        where e.organization_id = m.organization_id
          and e.to_user_id = m.user_id
          and e.created_at >= v_day_start
          and e.reason not in ('bulk_transfer', 'bulk_release')
      ) as assigned_today,
      (
        select count(*)::integer
        from public.leads l
        where l.organization_id = m.organization_id
          and l.assigned_to = m.user_id
          and l.stage not in ('won', 'lost')
      ) as open_leads,
      (
        select count(*)::integer
        from public.leads l
        where l.organization_id = m.organization_id
          and l.assigned_to = m.user_id
          and l.first_response_due_at is not null
          and l.first_response_due_at <= v_now
      ) as overdue_leads,
      (
        select round(avg(extract(epoch from (l.last_contact_at - l.assigned_at)) / 60)::numeric, 1)
        from public.leads l
        where l.organization_id = m.organization_id
          and l.assigned_to = m.user_id
          and l.assigned_at is not null
          and l.last_contact_at is not null
          and l.last_contact_at >= l.assigned_at
          and l.assigned_at >= v_now - interval '30 days'
      ) as avg_minutes
  ) stats
  cross join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'weekday', s.weekday,
        'start_minute', s.start_minute,
        'end_minute', s.end_minute
      )
      order by s.weekday, s.start_minute
    ) as items
    from public.lead_routing_shifts s
    where s.member_id = m.id
  ) shifts
  where m.organization_id = p_organization_id;

  select jsonb_build_object(
    'leads_today', count(*) filter (where l.created_at >= v_day_start),
    'unassigned', count(*) filter (where l.assigned_to is null and l.stage = 'new'),
    'queued', count(*) filter (where l.routing_due_at is not null),
    'overdue', count(*) filter (
      where l.first_response_due_at is not null and l.first_response_due_at <= v_now
    ),
    'reassigned_7d', count(*) filter (
      where l.sla_reassignments > 0 and l.created_at >= v_now - interval '7 days'
    ),
    'answered_in_time_7d', count(*) filter (
      where l.created_at >= v_now - interval '7 days'
        and l.assigned_at is not null
        and l.last_contact_at is not null
        and l.last_contact_at <= l.assigned_at + make_interval(mins => v_config.sla_minutes)
    ),
    'answered_7d', count(*) filter (
      where l.created_at >= v_now - interval '7 days'
        and l.last_contact_at is not null
    )
  )
  into v_totals
  from public.leads l
  where l.organization_id = p_organization_id
    and l.created_at >= v_now - interval '30 days';

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'organization_id', p_organization_id,
      'roulette_enabled', v_config.roulette_enabled,
      'respect_schedule', v_config.respect_schedule,
      'fallback_to_page_assignee', v_config.fallback_to_page_assignee,
      'sla_minutes', v_config.sla_minutes,
      'sla_reassign_enabled', v_config.sla_reassign_enabled,
      'sla_warning_percent', v_config.sla_warning_percent,
      'max_reassignments', v_config.max_reassignments,
      'time_zone', v_config.time_zone,
      'configured', exists (
        select 1 from public.lead_routing_settings s where s.organization_id = p_organization_id
      )
    ),
    'members', v_members,
    'totals', coalesce(v_totals, '{}'::jsonb),
    'now', v_now
  );
end;
$$;

comment on function public.get_lead_routing_overview(uuid) is
  'Painel do rodízio: configuração, fila com plantão/limite/ausência e os números agregados de cada corretor (leads do dia, em aberto, fora do prazo, tempo médio de primeiro contato). Dono, gerente e assistente.';

revoke all on function public.get_lead_routing_overview(uuid) from public, anon;
grant execute on function public.get_lead_routing_overview(uuid) to authenticated;

-- Conversão por etapa e tempo em cada fase, a partir de lead_stage_events.
create or replace function public.get_lead_stage_metrics(
  p_organization_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from timestamptz := now() - make_interval(days => v_days);
  v_stages jsonb;
  v_funnel jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager,assistant}') then
    raise exception 'Você não tem acesso às métricas desta imobiliária.' using errcode = '42501';
  end if;

  with eventos as (
    select
      e.lead_id,
      e.to_stage as stage,
      e.created_at,
      lead(e.created_at) over (partition by e.lead_id order by e.created_at, e.id) as next_at
    from public.lead_stage_events e
    where e.organization_id = p_organization_id
      and e.created_at >= v_from
  ),
  agregado as (
    select
      stage,
      count(*)::integer as entered,
      count(next_at)::integer as moved_on,
      round(
        percentile_cont(0.5) within group (
          order by extract(epoch from (next_at - created_at)) / 3600
        )::numeric,
        2
      ) as median_hours,
      round(
        avg(extract(epoch from (next_at - created_at)) / 3600) filter (where next_at is not null)::numeric,
        2
      ) as avg_hours
    from eventos
    group by stage
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'stage', a.stage,
        'entered', a.entered,
        'moved_on', a.moved_on,
        'still_there', a.entered - a.moved_on,
        'median_hours', a.median_hours,
        'avg_hours', a.avg_hours
      )
      order by array_position(
        array['new', 'contacted', 'qualified', 'visit_scheduled', 'proposal', 'won', 'lost']::public.lead_stage[],
        a.stage
      )
    ),
    '[]'::jsonb
  )
  into v_stages
  from agregado a;

  select jsonb_build_object(
    'leads', count(*)::integer,
    'contacted', count(*) filter (where l.last_contact_at is not null)::integer,
    'won', count(*) filter (where l.stage = 'won')::integer,
    'lost', count(*) filter (where l.stage = 'lost')::integer,
    'open', count(*) filter (where l.stage not in ('won', 'lost'))::integer,
    'median_first_response_minutes', round(
      percentile_cont(0.5) within group (
        order by extract(epoch from (l.last_contact_at - l.assigned_at)) / 60
      )::numeric,
      1
    )
  )
  into v_funnel
  from public.leads l
  where l.organization_id = p_organization_id
    and l.created_at >= v_from;

  return jsonb_build_object(
    'days', v_days,
    'from', v_from,
    'stages', v_stages,
    'totals', coalesce(v_funnel, '{}'::jsonb)
  );
end;
$$;

comment on function public.get_lead_stage_metrics(uuid, integer) is
  'Conversão por etapa e tempo em cada fase (mediana e média) a partir de public.lead_stage_events, mais o resumo do período. Dono, gerente e assistente.';

revoke all on function public.get_lead_stage_metrics(uuid, integer) from public, anon;
grant execute on function public.get_lead_stage_metrics(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. RPCs do servidor Next (chave notification_server_key do Vault)
-- -----------------------------------------------------------------------------
create or replace function private.check_notification_server_key(p_server_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'notification_server_key'
  limit 1;

  if v_secret is null
     or p_server_key is null
     or extensions.digest(p_server_key, 'sha256') <> extensions.digest(v_secret, 'sha256') then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.check_notification_server_key(text) from public, anon, authenticated;

create or replace function public.claim_lead_notifications(
  p_server_key text,
  p_limit integer default 50
)
returns table (
  id uuid,
  kind text,
  organization_id uuid,
  organization_slug text,
  lead_id uuid,
  lead_name text,
  lead_source text,
  lead_interest text,
  lead_phone text,
  lead_created_at timestamptz,
  due_at timestamptz,
  sla_minutes integer,
  recipient_email text,
  recipient_name text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform private.check_notification_server_key(p_server_key);

  return query
  with escolhidos as (
    select n.id
    from private.lead_notifications n
    where n.sent_at is null
      and n.claimed_at is null
      and n.attempts < 5
      and n.created_at > now() - interval '1 day'
    order by n.created_at
    limit v_limit
    for update skip locked
  ),
  reivindicados as (
    update private.lead_notifications n
    set claimed_at = now(),
        attempts = n.attempts + 1
    from escolhidos e
    where n.id = e.id
    returning n.id, n.kind, n.organization_id, n.lead_id, n.user_id, n.due_at
  )
  select
    r.id,
    r.kind,
    r.organization_id,
    o.slug::text,
    r.lead_id,
    l.name,
    l.source::text,
    l.interest,
    l.phone,
    l.created_at,
    r.due_at,
    private.lead_sla_minutes(r.organization_id),
    u.email::text,
    nullif(btrim(p.full_name), '')
  from reivindicados r
  join public.organizations o on o.id = r.organization_id
  join public.leads l on l.id = r.lead_id
  join auth.users u on u.id = r.user_id
  left join public.profiles p on p.id = r.user_id
  where u.email is not null
    and u.email_confirmed_at is not null;
end;
$$;

comment on function public.claim_lead_notifications(text, integer) is
  'Servidor Next (chave publishable + NOTIFICATION_SERVER_KEY): reserva e devolve os avisos de lead pendentes (recebeu lead, prazo acabando, redistribuído). Telefone e nome vêm crus para o template mascarar; nunca expõe a chave.';

revoke all on function public.claim_lead_notifications(text, integer) from public, anon, authenticated;
grant execute on function public.claim_lead_notifications(text, integer) to anon, authenticated;

create or replace function public.settle_lead_notifications(
  p_server_key text,
  p_sent uuid[] default '{}'::uuid[],
  p_failed uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent integer := 0;
  v_failed integer := 0;
begin
  perform private.check_notification_server_key(p_server_key);

  update private.lead_notifications n
  set sent_at = now(), claimed_at = coalesce(n.claimed_at, now())
  where n.id = any (coalesce(p_sent, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_sent = row_count;

  update private.lead_notifications n
  set claimed_at = null
  where n.id = any (coalesce(p_failed, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_failed = row_count;

  return jsonb_build_object('sent', v_sent, 'released', v_failed);
end;
$$;

comment on function public.settle_lead_notifications(text, uuid[], uuid[]) is
  'Servidor Next: confirma os avisos enviados e devolve para a fila os que falharam (nova tentativa até 5 vezes).';

revoke all on function public.settle_lead_notifications(text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.settle_lead_notifications(text, uuid[], uuid[]) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Lead novo entra pela roleta
-- -----------------------------------------------------------------------------
-- Trigger BEFORE INSERT (roda antes de leads_before_write, que é quem calcula
-- assigned_at e o prazo): com o rodízio ligado, quem decide o responsável é a
-- roleta, e não o campo fixo `landing_pages.lead_assignee_id`.
--   * lead de landing page: a roleta substitui o responsável fixo da página;
--     sem ninguém de plantão, cai no responsável fixo (fallback_to_page_assignee)
--     ou espera a próxima janela;
--   * lead sem responsável (cadastro manual, portal): entra na roleta;
--   * lead com responsável escolhido a dedo: não é tocado.
create or replace function private.leads_apply_roulette()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.lead_routing_settings;
  v_now timestamptz := now();
  v_picked uuid;
begin
  if new.stage <> 'new' then
    return new;
  end if;

  if new.source is distinct from 'landing_page' and new.assigned_to is not null then
    return new;
  end if;

  v_config := private.lead_routing_config(new.organization_id);

  if not v_config.roulette_enabled then
    return new;
  end if;

  v_picked := private.lead_routing_pick(new.organization_id, v_now, '{}'::uuid[]);

  if v_picked is not null then
    new.assigned_to := v_picked;
    new.routing_due_at := null;
    return new;
  end if;

  -- Ninguém de plantão agora: cai no responsável fixo da página, quando houver.
  if new.source is not distinct from 'landing_page'
     and v_config.fallback_to_page_assignee
     and new.assigned_to is not null then
    new.routing_due_at := null;
    return new;
  end if;

  new.assigned_to := null;

  if private.lead_routing_has_queue(new.organization_id, v_now, '{}'::uuid[]) then
    new.routing_due_at := coalesce(
      private.lead_routing_next_window(new.organization_id, v_now, '{}'::uuid[]),
      v_now + interval '15 minutes'
    );
  else
    new.routing_due_at := null;
  end if;

  return new;
end;
$$;

comment on function private.leads_apply_roulette() is
  'Trigger BEFORE INSERT em public.leads: com o rodízio ligado, o responsável do lead novo sai da roleta (e não do responsável fixo da landing page). Fora do horário de plantão o lead fica com routing_due_at na próxima janela.';

revoke all on function private.leads_apply_roulette() from public, anon, authenticated;

-- O nome ordena antes de leads_before_write (triggers BEFORE rodam em ordem
-- alfabética), que é quem calcula assigned_at e first_response_due_at.
drop trigger if exists leads_apply_roulette on public.leads;
create trigger leads_apply_roulette
  before insert on public.leads
  for each row execute function private.leads_apply_roulette();

-- -----------------------------------------------------------------------------
-- 11. Políticas RLS e grants por coluna
-- -----------------------------------------------------------------------------

-- lead_routing_settings -------------------------------------------------------
drop policy if exists "lead_routing_settings: membros leem" on public.lead_routing_settings;
create policy "lead_routing_settings: membros leem"
  on public.lead_routing_settings for select to authenticated
  using ((select private.is_member(organization_id)));

drop policy if exists "lead_routing_settings: dono e gerente criam" on public.lead_routing_settings;
create policy "lead_routing_settings: dono e gerente criam"
  on public.lead_routing_settings for insert to authenticated
  with check ((select private.has_role(organization_id, '{owner,manager}')));

drop policy if exists "lead_routing_settings: dono e gerente atualizam" on public.lead_routing_settings;
create policy "lead_routing_settings: dono e gerente atualizam"
  on public.lead_routing_settings for update to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')))
  with check ((select private.has_role(organization_id, '{owner,manager}')));

revoke all on public.lead_routing_settings from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.lead_routing_settings from authenticated;
grant select on public.lead_routing_settings to authenticated;
grant insert (
  organization_id, roulette_enabled, respect_schedule, fallback_to_page_assignee,
  sla_minutes, sla_reassign_enabled, sla_warning_percent, max_reassignments, time_zone
) on public.lead_routing_settings to authenticated;
grant update (
  roulette_enabled, respect_schedule, fallback_to_page_assignee, sla_minutes,
  sla_reassign_enabled, sla_warning_percent, max_reassignments, time_zone
) on public.lead_routing_settings to authenticated;

-- lead_routing_members --------------------------------------------------------
drop policy if exists "lead_routing_members: membros leem" on public.lead_routing_members;
create policy "lead_routing_members: membros leem"
  on public.lead_routing_members for select to authenticated
  using ((select private.is_member(organization_id)));

drop policy if exists "lead_routing_members: dono e gerente criam" on public.lead_routing_members;
create policy "lead_routing_members: dono e gerente criam"
  on public.lead_routing_members for insert to authenticated
  with check ((select private.has_role(organization_id, '{owner,manager}')));

drop policy if exists "lead_routing_members: dono e gerente atualizam" on public.lead_routing_members;
create policy "lead_routing_members: dono e gerente atualizam"
  on public.lead_routing_members for update to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')))
  with check ((select private.has_role(organization_id, '{owner,manager}')));

drop policy if exists "lead_routing_members: dono e gerente removem" on public.lead_routing_members;
create policy "lead_routing_members: dono e gerente removem"
  on public.lead_routing_members for delete to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')));

revoke all on public.lead_routing_members from anon;
revoke insert, update, truncate, trigger, references on public.lead_routing_members from authenticated;
grant select, delete on public.lead_routing_members to authenticated;
grant insert (
  organization_id, user_id, active, weight, daily_limit, away_from, away_until
) on public.lead_routing_members to authenticated;
-- last_assigned_at é estado do rodízio: só o banco escreve.
grant update (
  active, weight, daily_limit, away_from, away_until
) on public.lead_routing_members to authenticated;

-- lead_routing_shifts ---------------------------------------------------------
drop policy if exists "lead_routing_shifts: membros leem" on public.lead_routing_shifts;
create policy "lead_routing_shifts: membros leem"
  on public.lead_routing_shifts for select to authenticated
  using ((select private.is_member(organization_id)));

drop policy if exists "lead_routing_shifts: dono e gerente criam" on public.lead_routing_shifts;
create policy "lead_routing_shifts: dono e gerente criam"
  on public.lead_routing_shifts for insert to authenticated
  with check ((select private.has_role(organization_id, '{owner,manager}')));

drop policy if exists "lead_routing_shifts: dono e gerente removem" on public.lead_routing_shifts;
create policy "lead_routing_shifts: dono e gerente removem"
  on public.lead_routing_shifts for delete to authenticated
  using ((select private.has_role(organization_id, '{owner,manager}')));

revoke all on public.lead_routing_shifts from anon;
revoke insert, update, truncate, trigger, references on public.lead_routing_shifts from authenticated;
grant select, delete on public.lead_routing_shifts to authenticated;
grant insert (
  organization_id, member_id, weekday, start_minute, end_minute
) on public.lead_routing_shifts to authenticated;

-- Histórico: leitura para quem pode ver o lead; escrita só pelos triggers.
create or replace function private.can_access_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and private.can_access_lead_row(l.organization_id, l.assigned_to, false)
  );
$$;

revoke all on function private.can_access_lead(uuid) from public, anon;
grant execute on function private.can_access_lead(uuid) to authenticated;

drop policy if exists "lead_stage_events: acesso conforme o lead" on public.lead_stage_events;
create policy "lead_stage_events: acesso conforme o lead"
  on public.lead_stage_events for select to authenticated
  using ((select private.can_access_lead(lead_id)));

drop policy if exists "lead_assignment_events: acesso conforme o lead" on public.lead_assignment_events;
create policy "lead_assignment_events: acesso conforme o lead"
  on public.lead_assignment_events for select to authenticated
  using ((select private.can_access_lead(lead_id)));

revoke all on public.lead_stage_events from anon, authenticated;
revoke all on public.lead_assignment_events from anon, authenticated;
grant select on public.lead_stage_events to authenticated;
grant select on public.lead_assignment_events to authenticated;
