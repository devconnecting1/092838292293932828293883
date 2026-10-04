-- =============================================================================
-- Avisos de visita marcada por outra pessoa, lembrete de tarefa no celular e
-- preferências de tela (letra maior e "Comece por aqui")
-- =============================================================================
--  1. public.email_preferences ganha as preferências novas da pessoa:
--     visit_assigned, task_reminders, large_text e getting_started_dismissed_at.
--     A tabela já é só da própria pessoa (RLS): colegas de imobiliária não veem
--     se alguém usa letra maior, o que não aconteceria em public.profiles.
--  2. Visita marcada para o corretor por outra pessoa (ex.: assistente):
--     private.visit_assignment_notifications, alimentada por gatilho em
--     public.appointments e drenada por public.claim_visit_assignment_notices /
--     public.settle_visit_assignment_notices (e-mail com .ics e push).
--  3. Lembrete de tarefa 15 minutos antes, só no celular:
--     private.task_reminder_notifications, alimentada pela mesma passada
--     pg_cron dos lembretes de visita (a cada 5 min) e drenada por
--     public.claim_task_reminders / public.settle_task_reminders.
--  4. O webhook dos lembretes de visita (mesmos segredos do Vault) passa a
--     disparar também quando há aviso nas duas filas novas.
--
-- As RPCs com p_server_key usam o segredo notification_server_key do Vault
-- (env NOTIFICATION_SERVER_KEY) e só o anon executa. Aparelho e chaves do push
-- saem só por essas RPCs, como em claim_lead_notification_pushes.

-- -----------------------------------------------------------------------------
-- 1. Preferências da pessoa
-- -----------------------------------------------------------------------------
alter table public.email_preferences
  add column if not exists visit_assigned boolean not null default true,
  add column if not exists task_reminders boolean not null default true,
  add column if not exists large_text boolean not null default false,
  add column if not exists getting_started_dismissed_at timestamptz;

comment on table public.email_preferences is
  'Preferências de cada pessoa (valem em todas as imobiliárias): e-mails e avisos automáticos, letra e botões maiores e o cartão "Comece por aqui". Sem linha = padrão (avisos ligados, letra normal). Cada um lê e altera só a própria linha.';
comment on column public.email_preferences.visit_assigned is
  'Aviso por e-mail e no celular quando outra pessoa marca ou remarca uma visita para você.';
comment on column public.email_preferences.task_reminders is
  'Lembrete no celular 15 minutos antes do prazo de cada tarefa sua (tarefas com horário).';
comment on column public.email_preferences.large_text is
  'Letra e botões maiores no CRM inteiro.';
comment on column public.email_preferences.getting_started_dismissed_at is
  'Quando a pessoa escondeu o cartão "Comece por aqui" do painel (null = visível para dono e gerente).';

-- -----------------------------------------------------------------------------
-- 2. Visita marcada por outra pessoa
-- -----------------------------------------------------------------------------
create table if not exists private.visit_assignment_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  -- Corretor da visita (quem recebe o aviso).
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Quem marcou ou remarcou.
  assigned_by uuid references auth.users (id) on delete set null,
  -- Início da visita quando o aviso nasceu: remarcar abre um aviso novo.
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  push_sent_at timestamptz,
  attempts smallint not null default 0,
  constraint visit_assignment_notifications_once unique (appointment_id, user_id, starts_at)
);

create index if not exists visit_assignment_notifications_pending_idx
  on private.visit_assignment_notifications (created_at)
  where sent_at is null;
create index if not exists visit_assignment_notifications_user_id_idx
  on private.visit_assignment_notifications (user_id);
create index if not exists visit_assignment_notifications_organization_id_idx
  on private.visit_assignment_notifications (organization_id);
create index if not exists visit_assignment_notifications_assigned_by_idx
  on private.visit_assignment_notifications (assigned_by);

comment on table private.visit_assignment_notifications is
  'Fila do aviso "marcaram uma visita para você" (e-mail com .ics e push), quando quem agenda ou remarca não é o próprio corretor. A chave única garante um aviso por visita, corretor e horário. Alimentada pelo gatilho appointments_enqueue_assignment_notice e drenada por public.claim_visit_assignment_notices.';

alter table private.visit_assignment_notifications enable row level security;
revoke all on table private.visit_assignment_notifications from public, anon, authenticated;

create policy "visit_assignment_notifications: sem acesso pela API"
  on private.visit_assignment_notifications
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

comment on policy "visit_assignment_notifications: sem acesso pela API"
  on private.visit_assignment_notifications is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer e rotinas agendadas. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

create or replace function private.enqueue_visit_assignment_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  -- Só avisa quando outra pessoa (com sessão) marca para o corretor uma visita em aberto e futura.
  if v_actor is null
     or new.broker_id is null
     or new.broker_id = v_actor
     or new.status not in ('scheduled', 'confirmed')
     or new.starts_at <= now() then
    return null;
  end if;

  -- Na edição, só corretor novo, horário novo ou visita reaberta geram aviso.
  if tg_op = 'UPDATE'
     and new.broker_id is not distinct from old.broker_id
     and new.starts_at = old.starts_at
     and old.status in ('scheduled', 'confirmed') then
    return null;
  end if;

  begin
    insert into private.visit_assignment_notifications (
      organization_id, appointment_id, user_id, assigned_by, starts_at
    )
    select new.organization_id, new.id, new.broker_id, v_actor, new.starts_at
    where coalesce(
      (select ep.visit_assigned from public.email_preferences ep where ep.user_id = new.broker_id),
      true
    )
    on conflict on constraint visit_assignment_notifications_once do nothing;
  exception
    when others then
      -- O aviso é conveniência: falha aqui nunca impede salvar a visita.
      null;
  end;

  return null;
end;
$$;

comment on function private.enqueue_visit_assignment_notice() is
  'Gatilho (AFTER INSERT/UPDATE em appointments): enfileira o aviso ao corretor quando outra pessoa marca, remarca, troca o corretor ou reabre uma visita futura, respeitando a preferência visit_assigned. Nunca bloqueia a gravação.';

revoke all on function private.enqueue_visit_assignment_notice() from public, anon, authenticated;

drop trigger if exists appointments_enqueue_assignment_notice on public.appointments;
create trigger appointments_enqueue_assignment_notice
  after insert or update of broker_id, starts_at, status on public.appointments
  for each row execute function private.enqueue_visit_assignment_notice();

create or replace function public.claim_visit_assignment_notices(
  p_server_key text,
  p_limit integer default 20
)
returns table (
  id uuid,
  organization_id uuid,
  organization_slug text,
  organization_name text,
  brand_color text,
  appointment_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  appointment_status public.appointment_status,
  meeting_point text,
  client_first_name text,
  property_id uuid,
  property_code text,
  property_title text,
  address_display public.address_display,
  street text,
  street_number text,
  neighborhood text,
  city text,
  state text,
  recipient_user_id uuid,
  recipient_email text,
  recipient_name text,
  assigned_by_name text,
  push_targets jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform private.check_notification_server_key(p_server_key);

  -- Aviso que não vale mais (visita passou, foi remarcada, cancelada, trocou de
  -- corretor ou o corretor desligou o aviso) sai da fila antes de reservar.
  delete from private.visit_assignment_notifications n
  where n.sent_at is null
    and (
      n.starts_at <= now()
      or exists (
        select 1 from public.email_preferences ep
        where ep.user_id = n.user_id and not ep.visit_assigned
      )
      or not exists (
        select 1
        from public.appointments a
        where a.id = n.appointment_id
          and a.status in ('scheduled', 'confirmed')
          and a.starts_at = n.starts_at
          and a.broker_id = n.user_id
      )
    );

  -- Limpeza: enviados há mais de 7 dias.
  delete from private.visit_assignment_notifications n
  where n.sent_at is not null
    and n.sent_at < now() - interval '7 days';

  return query
  with escolhidos as (
    select n.id, n.push_sent_at is null as push_pendente
    from private.visit_assignment_notifications n
    join auth.users u on u.id = n.user_id
    where n.sent_at is null
      and (n.claimed_at is null or n.claimed_at < now() - interval '15 minutes')
      and n.attempts < 5
      and u.email is not null
      and u.email_confirmed_at is not null
      and private.billing_state(n.organization_id) <> 'read_only'
      and exists (
        select 1
        from public.memberships m
        where m.organization_id = n.organization_id
          and m.user_id = n.user_id
          and m.active
      )
    order by n.created_at, n.id
    limit v_limit
    for update of n skip locked
  ),
  reivindicados as (
    update private.visit_assignment_notifications n
    set claimed_at = now(),
        attempts = n.attempts + 1,
        -- Um push por aviso: o reenvio do e-mail não repete o push.
        push_sent_at = coalesce(n.push_sent_at, now())
    from escolhidos e
    where n.id = e.id
    returning n.id, n.organization_id, n.appointment_id, n.user_id, n.assigned_by, e.push_pendente
  )
  select
    r.id,
    r.organization_id,
    o.slug::text,
    o.name,
    o.brand ->> 'primary_color',
    a.id,
    a.starts_at,
    a.ends_at,
    a.status,
    a.meeting_point,
    case
      when a.client_id is not null
       and private.client_visible_to_member(a.organization_id, r.user_id, a.client_id)
        then nullif(split_part(btrim(c.name), ' ', 1), '')
    end,
    p.id,
    p.code,
    p.title,
    p.address_display,
    p.street,
    p.street_number,
    p.neighborhood,
    p.city,
    p.state,
    r.user_id,
    u.email::text,
    nullif(btrim(pr.full_name), ''),
    nullif(btrim(pa.full_name), ''),
    case
      when r.push_pendente then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'subscription_id', s.id,
            'endpoint', s.endpoint,
            'p256dh', s.p256dh,
            'auth', s.auth_secret
          )
          order by s.created_at
        )
        from public.push_subscriptions s
        where s.user_id = r.user_id
          and (s.organization_id is null or s.organization_id = r.organization_id)
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  from reivindicados r
  join public.organizations o on o.id = r.organization_id
  join public.appointments a on a.id = r.appointment_id
  left join public.properties p
    on p.organization_id = a.organization_id and p.id = a.property_id
  left join public.clients c
    on c.organization_id = a.organization_id and c.id = a.client_id
  join auth.users u on u.id = r.user_id
  left join public.profiles pr on pr.id = r.user_id
  left join public.profiles pa on pa.id = r.assigned_by
  order by a.starts_at, r.id;
end;
$$;

comment on function public.claim_visit_assignment_notices(text, integer) is
  'Servidor Next (chave publishable + NOTIFICATION_SERVER_KEY): descarta avisos que não valem mais e reserva os pendentes de "marcaram uma visita para você". Devolve os dados da visita (primeiro nome do cliente só se o corretor o enxerga), quem marcou e, só na primeira reserva, os aparelhos com push do corretor. Todo id devolvido precisa voltar em settle_visit_assignment_notices.';

revoke all on function public.claim_visit_assignment_notices(text, integer) from public, anon, authenticated;
grant execute on function public.claim_visit_assignment_notices(text, integer) to anon;

create or replace function public.settle_visit_assignment_notices(
  p_server_key text,
  p_sent uuid[] default '{}'::uuid[],
  p_failed uuid[] default '{}'::uuid[],
  p_released uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent integer := 0;
  v_failed integer := 0;
  v_released integer := 0;
begin
  perform private.check_notification_server_key(p_server_key);

  update private.visit_assignment_notifications n
  set sent_at = now(), claimed_at = coalesce(n.claimed_at, now())
  where n.id = any (coalesce(p_sent, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_sent = row_count;

  update private.visit_assignment_notifications n
  set claimed_at = null
  where n.id = any (coalesce(p_failed, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_failed = row_count;

  update private.visit_assignment_notifications n
  set claimed_at = null,
      attempts = greatest(n.attempts - 1, 0)
  where n.id = any (coalesce(p_released, '{}'::uuid[]))
    and n.sent_at is null
    and n.claimed_at is not null;
  get diagnostics v_released = row_count;

  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'released', v_released);
end;
$$;

comment on function public.settle_visit_assignment_notices(text, uuid[], uuid[], uuid[]) is
  'Confirma os avisos de visita marcada enviados, devolve os que falharam (conta tentativa, até 5) e os que nem foram tentados (não conta). Exige a chave do servidor.';

revoke all on function public.settle_visit_assignment_notices(text, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.settle_visit_assignment_notices(text, uuid[], uuid[], uuid[]) to anon;

-- -----------------------------------------------------------------------------
-- 3. Lembrete de tarefa 15 minutos antes (push)
-- -----------------------------------------------------------------------------
create table if not exists private.task_reminder_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Prazo quando o lembrete nasceu: mudar o prazo abre um lembrete novo.
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts smallint not null default 0,
  constraint task_reminder_notifications_once unique (task_id, user_id, due_at)
);

create index if not exists task_reminder_notifications_pending_idx
  on private.task_reminder_notifications (due_at)
  where sent_at is null;
create index if not exists task_reminder_notifications_user_id_idx
  on private.task_reminder_notifications (user_id);
create index if not exists task_reminder_notifications_organization_id_idx
  on private.task_reminder_notifications (organization_id);

comment on table private.task_reminder_notifications is
  'Fila do lembrete de tarefa no celular (15 minutos antes do prazo, para o responsável com aparelho ligado e preferência task_reminders). A chave única garante um lembrete por tarefa, responsável e prazo. Alimentada por private.enqueue_task_reminders (pg_cron, job lembretes-de-visita) e drenada por public.claim_task_reminders.';

alter table private.task_reminder_notifications enable row level security;
revoke all on table private.task_reminder_notifications from public, anon, authenticated;

create policy "task_reminder_notifications: sem acesso pela API"
  on private.task_reminder_notifications
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

comment on policy "task_reminder_notifications: sem acesso pela API"
  on private.task_reminder_notifications is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer e rotinas agendadas. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

-- Varredura das tarefas em aberto por prazo (parcial: só o que ainda pode ter lembrete).
create index if not exists tasks_open_due_at_idx
  on public.tasks (due_at)
  where status = 'open' and due_at is not null;

create or replace function private.enqueue_task_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_inserted integer := 0;
begin
  insert into private.task_reminder_notifications (organization_id, task_id, user_id, due_at)
  select t.organization_id, t.id, t.assignee_id, t.due_at
  from public.tasks t
  join public.memberships m
    on m.organization_id = t.organization_id
   and m.user_id = t.assignee_id
   and m.active
  left join public.email_preferences ep on ep.user_id = t.assignee_id
  where t.status = 'open'
    and t.assignee_id is not null
    -- Até 15 min antes; a menos de 1 min o lembrete não serve mais.
    and t.due_at > v_now + interval '1 minute'
    and t.due_at <= v_now + interval '15 minutes'
    -- Tarefa "do dia todo" (23:59 em Brasília) não tem horário para lembrar.
    and to_char(t.due_at at time zone 'America/Sao_Paulo', 'HH24:MI') <> '23:59'
    and coalesce(ep.task_reminders, true)
    and private.billing_state(t.organization_id) <> 'read_only'
    and exists (
      select 1
      from public.push_subscriptions s
      where s.user_id = t.assignee_id
        and (s.organization_id is null or s.organization_id = t.organization_id)
    )
  on conflict on constraint task_reminder_notifications_once do nothing;
  get diagnostics v_inserted = row_count;

  -- Limpeza: enviados há mais de 7 dias e pendentes de prazos que já passaram.
  delete from private.task_reminder_notifications n
  where (n.sent_at is not null and n.sent_at < v_now - interval '7 days')
     or (n.sent_at is null and n.due_at < v_now - interval '1 day');

  return v_inserted;
end;
$$;

comment on function private.enqueue_task_reminders() is
  'Rotina agendada (pg_cron, job lembretes-de-visita, a cada 5 min): enfileira o lembrete no celular de cada tarefa em aberto com horário que vence em até 15 minutos, para o responsável com aparelho ligado e preferência task_reminders. Idempotente.';

revoke all on function private.enqueue_task_reminders() from public, anon, authenticated;

create or replace function public.claim_task_reminders(
  p_server_key text,
  p_limit integer default 20
)
returns table (
  id uuid,
  organization_id uuid,
  organization_slug text,
  task_id uuid,
  task_title text,
  due_at timestamptz,
  recipient_user_id uuid,
  push_targets jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform private.check_notification_server_key(p_server_key);

  -- Lembrete que não vale mais (prazo passou ou mudou, tarefa concluída,
  -- responsável trocado ou lembrete desligado) sai da fila antes de reservar.
  delete from private.task_reminder_notifications n
  where n.sent_at is null
    and (
      n.due_at <= now()
      or exists (
        select 1 from public.email_preferences ep
        where ep.user_id = n.user_id and not ep.task_reminders
      )
      or not exists (
        select 1
        from public.tasks t
        where t.id = n.task_id
          and t.status = 'open'
          and t.due_at = n.due_at
          and t.assignee_id = n.user_id
      )
    );

  return query
  with escolhidos as (
    select n.id
    from private.task_reminder_notifications n
    where n.sent_at is null
      and (n.claimed_at is null or n.claimed_at < now() - interval '15 minutes')
      and n.attempts < 3
      and exists (
        select 1
        from public.memberships m
        where m.organization_id = n.organization_id
          and m.user_id = n.user_id
          and m.active
      )
    order by n.due_at, n.id
    limit v_limit
    for update of n skip locked
  ),
  reivindicados as (
    update private.task_reminder_notifications n
    set claimed_at = now(),
        attempts = n.attempts + 1
    from escolhidos e
    where n.id = e.id
    returning n.id, n.organization_id, n.task_id, n.user_id
  )
  select
    r.id,
    r.organization_id,
    o.slug::text,
    t.id,
    t.title,
    t.due_at,
    r.user_id,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'subscription_id', s.id,
          'endpoint', s.endpoint,
          'p256dh', s.p256dh,
          'auth', s.auth_secret
        )
        order by s.created_at
      )
      from public.push_subscriptions s
      where s.user_id = r.user_id
        and (s.organization_id is null or s.organization_id = r.organization_id)
    ), '[]'::jsonb)
  from reivindicados r
  join public.organizations o on o.id = r.organization_id
  join public.tasks t on t.id = r.task_id
  order by t.due_at, r.id;
end;
$$;

comment on function public.claim_task_reminders(text, integer) is
  'Servidor Next (chave publishable + NOTIFICATION_SERVER_KEY): descarta lembretes de tarefa que não valem mais e reserva os pendentes com os aparelhos do responsável (até 3 tentativas). Todo id devolvido precisa voltar em settle_task_reminders.';

revoke all on function public.claim_task_reminders(text, integer) from public, anon, authenticated;
grant execute on function public.claim_task_reminders(text, integer) to anon;

create or replace function public.settle_task_reminders(
  p_server_key text,
  p_sent uuid[] default '{}'::uuid[],
  p_failed uuid[] default '{}'::uuid[],
  p_released uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent integer := 0;
  v_failed integer := 0;
  v_released integer := 0;
begin
  perform private.check_notification_server_key(p_server_key);

  update private.task_reminder_notifications n
  set sent_at = now(), claimed_at = coalesce(n.claimed_at, now())
  where n.id = any (coalesce(p_sent, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_sent = row_count;

  update private.task_reminder_notifications n
  set claimed_at = null
  where n.id = any (coalesce(p_failed, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_failed = row_count;

  update private.task_reminder_notifications n
  set claimed_at = null,
      attempts = greatest(n.attempts - 1, 0)
  where n.id = any (coalesce(p_released, '{}'::uuid[]))
    and n.sent_at is null
    and n.claimed_at is not null;
  get diagnostics v_released = row_count;

  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'released', v_released);
end;
$$;

comment on function public.settle_task_reminders(text, uuid[], uuid[], uuid[]) is
  'Confirma os lembretes de tarefa entregues, devolve os que falharam (conta tentativa, até 3) e os que nem foram tentados (não conta). Exige a chave do servidor.';

revoke all on function public.settle_task_reminders(text, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.settle_task_reminders(text, uuid[], uuid[], uuid[]) to anon;

-- -----------------------------------------------------------------------------
-- 4. Webhook e passada agendada
-- -----------------------------------------------------------------------------
create or replace function private.ping_visit_reminders_webhook()
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
    select 1
    from private.visit_reminder_notifications n
    where n.sent_at is null
      and n.claimed_at is null
      and n.attempts < 5
      and n.starts_at > now()
  )
  and not exists (
    select 1
    from private.visit_assignment_notifications n
    where n.sent_at is null
      and n.claimed_at is null
      and n.attempts < 5
      and n.starts_at > now()
  )
  and not exists (
    select 1
    from private.task_reminder_notifications n
    where n.sent_at is null
      and n.claimed_at is null
      and n.attempts < 3
      and n.due_at > now()
  ) then
    return false;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'visit_reminders_webhook_url'
  limit 1;

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'visit_reminders_webhook_secret'
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

comment on function private.ping_visit_reminders_webhook() is
  'Chama a rota do Next que envia os lembretes de visita, os avisos de visita marcada e os lembretes de tarefa (POST com Authorization: Bearer) quando há item pendente em alguma das três filas. Sem os segredos visit_reminders_webhook_url e visit_reminders_webhook_secret no Vault, não faz nada.';

revoke all on function private.ping_visit_reminders_webhook() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lembretes-de-visita') then
    perform cron.unschedule('lembretes-de-visita');
  end if;
end;
$$;

select cron.schedule(
  'lembretes-de-visita',
  '*/5 * * * *',
  $cron$
    select private.enqueue_visit_reminders();
    select private.enqueue_task_reminders();
    select private.ping_visit_reminders_webhook();
  $cron$
);
