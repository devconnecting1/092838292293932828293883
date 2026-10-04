-- =============================================================================
-- Lembretes: resumo diário, lembrete de visita, relatório semanal e aniversários
-- =============================================================================
--  1. public.email_preferences: cada pessoa liga/desliga os e-mails em "Meu perfil"
--  2. Ajudantes de data (aniversário, 29/02) e de acesso ao cliente
--  3. Painel: public.dashboard_client_birthdays (aniversariantes da semana)
--  4. Relatório: public.report_broker_visits (visitas por corretor no período)
--  5. Resumo diário por pessoa (07h): private.daily_digest_deliveries e
--     public.claim_daily_digests / public.settle_daily_digests
--  6. Lembrete de visita 2 h antes: private.visit_reminder_notifications,
--     passada pg_cron (job lembretes-de-visita, a cada 5 min), webhook pg_net e
--     public.claim_visit_reminders / public.settle_visit_reminders
--  7. Relatório semanal ao gestor (segunda 07h): private.weekly_report_deliveries
--     e public.claim_weekly_reports / public.settle_weekly_reports
--
-- "Hoje" é sempre a data de São Paulo. As RPCs com p_server_key usam o segredo
-- notification_server_key do Vault (env NOTIFICATION_SERVER_KEY) e só o anon
-- executa. Os números do relatório semanal saem das MESMAS funções da tela
-- /relatorios (report_broker_performance e report_broker_visits), chamadas com a
-- identidade de um dono ou gerente da imobiliária: nada é recalculado no app.

-- -----------------------------------------------------------------------------
-- 1. Preferências de e-mail por pessoa
-- -----------------------------------------------------------------------------
create table if not exists public.email_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  daily_digest boolean not null default true,
  visit_reminders boolean not null default true,
  weekly_report boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_preferences is
  'E-mails automáticos que a pessoa quer receber (vale para todas as imobiliárias dela). Sem linha = tudo ligado. Editada pela própria pessoa em "Meu perfil".';
comment on column public.email_preferences.daily_digest is
  'Resumo diário das 07h: tarefas de hoje e atrasadas, visitas do dia, leads sem contato e aniversariantes da carteira.';
comment on column public.email_preferences.visit_reminders is
  'Lembrete por e-mail 2 horas antes de cada visita em que a pessoa é o corretor.';
comment on column public.email_preferences.weekly_report is
  'Relatório semanal da equipe (segunda 07h). Só chega para dono e gerente.';

alter table public.email_preferences enable row level security;

revoke all on table public.email_preferences from public, anon, authenticated;
grant select, insert, update on table public.email_preferences to authenticated;

drop policy if exists "email_preferences: usuário lê as próprias" on public.email_preferences;
create policy "email_preferences: usuário lê as próprias"
  on public.email_preferences
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "email_preferences: usuário cria as próprias" on public.email_preferences;
create policy "email_preferences: usuário cria as próprias"
  on public.email_preferences
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "email_preferences: usuário altera as próprias" on public.email_preferences;
create policy "email_preferences: usuário altera as próprias"
  on public.email_preferences
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists email_preferences_set_updated_at on public.email_preferences;
create trigger email_preferences_set_updated_at
  before update on public.email_preferences
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Ajudantes
-- -----------------------------------------------------------------------------
create or replace function private.is_leap_year(p_year integer)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0);
$$;

comment on function private.is_leap_year(integer) is 'Ano bissexto no calendário gregoriano.';

create or replace function private.month_day(p_date date)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select extract(month from p_date)::integer * 100 + extract(day from p_date)::integer;
$$;

comment on function private.month_day(date) is
  'Mês e dia como inteiro MMDD (15/09 -> 915). Base do índice de aniversários de clients.';

-- Aniversário num ano: quem nasceu em 29/02 comemora em 28/02 nos anos comuns.
create or replace function private.birthday_in_year(p_birth_date date, p_year integer)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_birth_date is null or p_year is null then null
    when private.month_day(p_birth_date) = 229 and not private.is_leap_year(p_year)
      then make_date(p_year, 2, 28)
    else make_date(p_year, extract(month from p_birth_date)::integer, extract(day from p_birth_date)::integer)
  end;
$$;

comment on function private.birthday_in_year(date, integer) is
  'Data do aniversário no ano informado; 29/02 vira 28/02 em ano não bissexto.';

create or replace function private.next_birthday(p_birth_date date, p_on date)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when private.birthday_in_year(p_birth_date, extract(year from p_on)::integer) >= p_on
      then private.birthday_in_year(p_birth_date, extract(year from p_on)::integer)
    else private.birthday_in_year(p_birth_date, extract(year from p_on)::integer + 1)
  end;
$$;

comment on function private.next_birthday(date, date) is
  'Próximo aniversário a partir da data (inclusive).';

-- Códigos MMDD dos dias da janela, para o filtro usar o índice. Numa janela com
-- 28/02 de ano comum entra também o 229 (quem nasceu em 29/02).
create or replace function private.birthday_codes(p_from date, p_days integer)
returns integer[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.code), '{}'::integer[])
  from (
    select private.month_day(p_from + g) as code
    from generate_series(0, greatest(coalesce(p_days, 1), 1) - 1) g
    union all
    select 229
    from generate_series(0, greatest(coalesce(p_days, 1), 1) - 1) g
    where private.month_day(p_from + g) = 228
      and not private.is_leap_year(extract(year from p_from + g)::integer)
  ) x;
$$;

comment on function private.birthday_codes(date, integer) is
  'Códigos MMDD (private.month_day) dos p_days dias a partir de p_from, incluindo 29/02 quando a janela passa por 28/02 de ano comum.';

revoke all on function private.is_leap_year(integer) from public, anon;
revoke all on function private.month_day(date) from public, anon;
revoke all on function private.birthday_in_year(date, integer) from public, anon;
revoke all on function private.next_birthday(date, date) from public, anon;
revoke all on function private.birthday_codes(date, integer) from public, anon;
grant execute on function private.is_leap_year(integer) to authenticated;
grant execute on function private.month_day(date) to authenticated;
grant execute on function private.birthday_in_year(date, integer) to authenticated;
grant execute on function private.next_birthday(date, date) to authenticated;
grant execute on function private.birthday_codes(date, integer) to authenticated;

create index if not exists clients_organization_birthday_idx
  on public.clients (organization_id, private.month_day(birth_date))
  where birth_date is not null;

-- O e-mail vai para a pessoa, não para a sessão: este é o espelho CONSERVADOR de
-- private.can_access_client_row para um usuário qualquer (o ramo "proprietário
-- de imóvel meu" fica de fora, então na dúvida o nome do cliente não sai).
create or replace function private.client_visible_to_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_client_id uuid
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
    join public.clients c
      on c.organization_id = m.organization_id
     and c.id = p_client_id
    where m.organization_id = p_organization_id
      and m.user_id = p_user_id
      and m.active
      and (
        m.role in ('owner', 'manager', 'assistant', 'finance')
        or (
          m.role = 'broker'
          and (
            c.assigned_to = m.user_id
            or exists (
              select 1 from public.client_shares s
              where s.client_id = c.id and s.user_id = m.user_id
            )
          )
        )
        or (m.role = 'capturer' and c.created_by = m.user_id)
      )
  );
$$;

comment on function private.client_visible_to_member(uuid, uuid, uuid) is
  'Se o membro enxerga o cliente (versão conservadora de can_access_client_row sem depender da sessão). Usada pelos e-mails para decidir se o primeiro nome do cliente aparece.';

revoke all on function private.client_visible_to_member(uuid, uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Painel: aniversariantes da semana
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_client_birthdays(
  p_organization_id uuid,
  p_days integer default 7,
  p_limit integer default 8
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with args as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as today,
      least(greatest(coalesce(p_days, 7), 1), 31) as days,
      least(greatest(coalesce(p_limit, 8), 1), 30) as lim
  ),
  aniversariantes as (
    select
      c.id,
      c.name,
      c.birth_date,
      coalesce(nullif(btrim(c.whatsapp), ''), nullif(btrim(c.phone), '')) as phone,
      private.next_birthday(c.birth_date, a.today) as next_birthday,
      a.today,
      a.days
    from public.clients c
    cross join args a
    where c.organization_id = p_organization_id
      and c.birth_date is not null
      and private.month_day(c.birth_date) = any (private.birthday_codes(a.today, a.days))
  ),
  janela as (
    select * from aniversariantes where next_birthday - today < days
  )
  select jsonb_build_object(
    'total', (select count(*) from janela),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'client_id', x.id,
            'name', x.name,
            'next_birthday', x.next_birthday,
            'days_until', x.next_birthday - x.today,
            'turning_age', case
              when extract(year from x.birth_date) >= 1900
                then extract(year from x.next_birthday)::integer - extract(year from x.birth_date)::integer
            end,
            'phone', x.phone
          )
          order by x.next_birthday, x.name
        )
        from (
          select *
          from janela
          order by next_birthday, name
          limit (select lim from args)
        ) x
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.dashboard_client_birthdays(uuid, integer, integer) is
  'Cartão do Painel: clientes que fazem aniversário nos próximos p_days dias (hoje incluso), com dias que faltam, idade que completam e telefone para o botão do WhatsApp. 29/02 conta em 28/02 nos anos comuns. security invoker: o RLS de clients decide quem aparece.';

revoke all on function public.dashboard_client_birthdays(uuid, integer, integer) from public, anon;
grant execute on function public.dashboard_client_birthdays(uuid, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Relatório: visitas por corretor
-- -----------------------------------------------------------------------------
-- Mesmas regras de relatorios_desempenho: security invoker, janela de
-- private.report_window, dono e gerente veem a equipe e os demais papéis só a
-- própria linha. Visita conta no período pelo início (starts_at).
create or replace function public.report_broker_visits(
  p_organization_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  user_id uuid,
  visits_scheduled bigint,
  visits_done bigint,
  visits_no_show bigint,
  visits_canceled bigint
)
language sql
stable
set search_path = ''
as $$
  with janela as (
    select
      w.inicio,
      w.fim,
      private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) as ve_equipe,
      (select auth.uid()) as eu
    from private.report_window(p_from, p_to) w
  )
  select
    a.broker_id,
    count(*) filter (where a.status <> 'canceled'),
    count(*) filter (where a.status = 'done'),
    count(*) filter (where a.status = 'no_show'),
    count(*) filter (where a.status = 'canceled')
  from public.appointments a
  cross join janela j
  where a.organization_id = p_organization_id
    and a.broker_id is not null
    and a.starts_at >= j.inicio
    and a.starts_at < j.fim
    and (j.ve_equipe or a.broker_id = j.eu)
  group by a.broker_id
  order by 3 desc, 2 desc, 1;
$$;

comment on function public.report_broker_visits(uuid, timestamptz, timestamptz) is
  'Visitas por corretor no período (pelo início): agendadas (exceto canceladas), realizadas, não compareceu e canceladas. Security invoker; dono e gerente recebem a equipe, os demais papéis só a própria linha. Usada pelo relatório semanal por e-mail.';

revoke all on function public.report_broker_visits(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.report_broker_visits(uuid, timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Resumo diário
-- -----------------------------------------------------------------------------
create table if not exists private.daily_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  digest_date date not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  -- Sem nada para contar hoje: não envia e não tenta de novo no mesmo dia.
  skipped_at timestamptz,
  attempts smallint not null default 0,
  constraint daily_digest_deliveries_once unique (organization_id, user_id, digest_date)
);

create index if not exists daily_digest_deliveries_user_id_idx
  on private.daily_digest_deliveries (user_id);
create index if not exists daily_digest_deliveries_digest_date_idx
  on private.daily_digest_deliveries (digest_date);

comment on table private.daily_digest_deliveries is
  'Controle do resumo diário por e-mail: uma linha por imobiliária, pessoa e dia (chave única), para o resumo nunca sair duas vezes no mesmo dia. skipped_at = não havia conteúdo. Linhas com mais de 30 dias são apagadas pelo próprio claim.';

alter table private.daily_digest_deliveries enable row level security;
revoke all on table private.daily_digest_deliveries from public, anon, authenticated;

create or replace function private.daily_digest_content(
  p_organization_id uuid,
  p_user_id uuid,
  p_today date,
  p_stale_days integer,
  p_item_limit integer default 10
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with limites as (
    select
      (p_today::timestamp at time zone 'America/Sao_Paulo') as dia_inicio,
      ((p_today + 1)::timestamp at time zone 'America/Sao_Paulo') as dia_fim,
      least(greatest(coalesce(p_item_limit, 10), 1), 30) as lim,
      least(greatest(coalesce(p_stale_days, 3), 1), 60) as dias_parado
  ),
  tarefas as (
    select t.id, t.title, t.due_at, t.priority, t.due_at < l.dia_inicio as atrasada
    from public.tasks t
    cross join limites l
    where t.assignee_id = p_user_id
      and t.organization_id = p_organization_id
      and t.status = 'open'
      and t.due_at is not null
      and t.due_at < l.dia_fim
  ),
  visitas as (
    select
      a.id,
      a.starts_at,
      a.ends_at,
      a.status,
      a.meeting_point,
      p.id as property_id,
      p.code,
      p.title,
      p.address_display,
      p.street,
      p.street_number,
      p.neighborhood,
      p.city,
      p.state,
      case
        when a.client_id is not null
         and private.client_visible_to_member(a.organization_id, p_user_id, a.client_id)
          then nullif(split_part(btrim(c.name), ' ', 1), '')
      end as client_first_name
    from public.appointments a
    cross join limites l
    left join public.properties p
      on p.organization_id = a.organization_id and p.id = a.property_id
    left join public.clients c
      on c.organization_id = a.organization_id and c.id = a.client_id
    where a.broker_id = p_user_id
      and a.organization_id = p_organization_id
      and a.status in ('scheduled', 'confirmed')
      and a.starts_at >= l.dia_inicio
      and a.starts_at < l.dia_fim
  ),
  leads_parados as (
    select
      ld.id,
      ld.name,
      ld.stage,
      coalesce(ld.last_contact_at, ld.assigned_at, ld.created_at) as ultimo_contato
    from public.leads ld
    cross join limites l
    where ld.organization_id = p_organization_id
      and ld.assigned_to = p_user_id
      and ld.stage not in ('won', 'lost')
      and coalesce(ld.last_contact_at, ld.assigned_at, ld.created_at)
          < now() - make_interval(days => l.dias_parado)
  ),
  aniversarios as (
    select
      c.id,
      c.name,
      case
        when extract(year from c.birth_date) >= 1900
          then extract(year from p_today)::integer - extract(year from c.birth_date)::integer
      end as idade
    from public.clients c
    where c.organization_id = p_organization_id
      and c.assigned_to = p_user_id
      and c.birth_date is not null
      and private.month_day(c.birth_date) = any (private.birthday_codes(p_today, 1))
      and private.next_birthday(c.birth_date, p_today) = p_today
  )
  select jsonb_build_object(
    'has_content',
      exists (select 1 from tarefas)
      or exists (select 1 from visitas)
      or exists (select 1 from leads_parados)
      or exists (select 1 from aniversarios),
    'stale_days', (select dias_parado from limites),
    'tasks_overdue_total', (select count(*) from tarefas where atrasada),
    'tasks_overdue', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'due_at', x.due_at, 'priority', x.priority) order by x.due_at, x.id)
      from (select * from tarefas where atrasada order by due_at, id limit (select lim from limites)) x
    ), '[]'::jsonb),
    'tasks_today_total', (select count(*) from tarefas where not atrasada),
    'tasks_today', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'due_at', x.due_at, 'priority', x.priority) order by x.due_at, x.id)
      from (select * from tarefas where not atrasada order by due_at, id limit (select lim from limites)) x
    ), '[]'::jsonb),
    'visits_total', (select count(*) from visitas),
    'visits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id,
          'starts_at', x.starts_at,
          'ends_at', x.ends_at,
          'status', x.status,
          'meeting_point', x.meeting_point,
          'client_first_name', x.client_first_name,
          'property', case when x.property_id is null then null else jsonb_build_object(
            'id', x.property_id,
            'code', x.code,
            'title', x.title,
            'address_display', x.address_display,
            'street', x.street,
            'street_number', x.street_number,
            'neighborhood', x.neighborhood,
            'city', x.city,
            'state', x.state
          ) end
        )
        order by x.starts_at, x.id
      )
      from (select * from visitas order by starts_at, id limit (select lim from limites)) x
    ), '[]'::jsonb),
    'stale_leads_total', (select count(*) from leads_parados),
    'stale_leads', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'stage', x.stage, 'last_contact_at', x.ultimo_contato) order by x.ultimo_contato, x.id)
      from (select * from leads_parados order by ultimo_contato, id limit (select lim from limites)) x
    ), '[]'::jsonb),
    'birthdays_total', (select count(*) from aniversarios),
    'birthdays', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'age', x.idade) order by x.name, x.id)
      from (select * from aniversarios order by name, id limit (select lim from limites)) x
    ), '[]'::jsonb)
  );
$$;

comment on function private.daily_digest_content(uuid, uuid, date, integer, integer) is
  'Conteúdo do resumo diário de uma pessoa numa imobiliária: tarefas abertas atrasadas e de hoje (responsável), visitas abertas do dia (corretor), leads em aberto sem contato há mais de p_stale_days dias (responsável) e clientes da carteira (assigned_to) que fazem aniversário hoje. Endereço cru + address_display: quem aplica o modo de exibição é o app.';

revoke all on function private.daily_digest_content(uuid, uuid, date, integer, integer) from public, anon, authenticated;

create or replace function public.claim_daily_digests(
  p_server_key text,
  p_limit integer default 20,
  p_stale_days integer default 3,
  p_organization_id uuid default null
)
returns table (
  id uuid,
  organization_id uuid,
  organization_slug text,
  organization_name text,
  brand_color text,
  digest_date date,
  recipient_user_id uuid,
  recipient_email text,
  recipient_name text,
  content jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_now timestamptz := now();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_returned integer := 0;
  v_delivery_id uuid;
  v_content jsonb;
  rec record;
begin
  perform private.check_notification_server_key(p_server_key);

  delete from private.daily_digest_deliveries d
  where d.digest_date < v_today - 30;

  for rec in
    select m.organization_id as org_id, m.user_id as uid
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.email_preferences ep on ep.user_id = m.user_id
    where m.active
      and (p_organization_id is null or m.organization_id = p_organization_id)
      and u.email is not null
      and u.email_confirmed_at is not null
      and coalesce(ep.daily_digest, true)
      and not exists (
        select 1
        from private.daily_digest_deliveries d
        where d.organization_id = m.organization_id
          and d.user_id = m.user_id
          and d.digest_date = v_today
          and (
            d.sent_at is not null
            or d.skipped_at is not null
            or d.attempts >= 5
            or d.claimed_at >= v_now - interval '15 minutes'
          )
      )
      and private.billing_state(m.organization_id) <> 'read_only'
    -- Quem está há mais tempo sem resumo vem primeiro: se a cota do dia acabar,
    -- amanhã a fila começa por outras pessoas.
    order by (
        select max(d.digest_date)
        from private.daily_digest_deliveries d
        where d.organization_id = m.organization_id
          and d.user_id = m.user_id
          and d.sent_at is not null
      ) asc nulls first,
      m.organization_id,
      m.user_id
    limit least(v_limit * 25, 2500)
  loop
    exit when v_returned >= v_limit;

    v_delivery_id := null;

    -- Reserva atômica: outra execução ao mesmo tempo não pega a mesma pessoa.
    insert into private.daily_digest_deliveries as d (
      organization_id, user_id, digest_date, claimed_at, attempts
    )
    values (rec.org_id, rec.uid, v_today, v_now, 1)
    on conflict on constraint daily_digest_deliveries_once do update
      set claimed_at = excluded.claimed_at,
          attempts = d.attempts + 1
      where d.sent_at is null
        and d.skipped_at is null
        and d.attempts < 5
        and (d.claimed_at is null or d.claimed_at < v_now - interval '15 minutes')
    returning d.id into v_delivery_id;

    continue when v_delivery_id is null;

    v_content := private.daily_digest_content(rec.org_id, rec.uid, v_today, p_stale_days, 10);

    if coalesce((v_content ->> 'has_content')::boolean, false) is not true then
      update private.daily_digest_deliveries d
      set skipped_at = v_now,
          claimed_at = null
      where d.id = v_delivery_id;

      continue;
    end if;

    v_returned := v_returned + 1;

    return query
    select
      v_delivery_id,
      o.id,
      o.slug::text,
      o.name,
      o.brand ->> 'primary_color',
      v_today,
      u.id,
      u.email::text,
      nullif(btrim(pr.full_name), ''),
      v_content
    from public.organizations o
    join auth.users u on u.id = rec.uid
    left join public.profiles pr on pr.id = rec.uid
    where o.id = rec.org_id;
  end loop;
end;
$$;

comment on function public.claim_daily_digests(text, integer, integer, uuid) is
  'Cron diário (07h de Brasília): reserva o resumo do dia de cada membro ativo com e-mail confirmado e preferência ligada (um por imobiliária, pessoa e dia) e devolve só quem tem conteúdo; quem não tem fica marcado como pulado. Todo id devolvido precisa voltar em settle_daily_digests. p_organization_id restringe a uma imobiliária. Exige a chave do servidor.';

revoke all on function public.claim_daily_digests(text, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_daily_digests(text, integer, integer, uuid) to anon;

create or replace function public.settle_daily_digests(
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

  update private.daily_digest_deliveries d
  set sent_at = now(), claimed_at = coalesce(d.claimed_at, now())
  where d.id = any (coalesce(p_sent, '{}'::uuid[]))
    and d.sent_at is null;
  get diagnostics v_sent = row_count;

  update private.daily_digest_deliveries d
  set claimed_at = null
  where d.id = any (coalesce(p_failed, '{}'::uuid[]))
    and d.sent_at is null;
  get diagnostics v_failed = row_count;

  update private.daily_digest_deliveries d
  set claimed_at = null,
      attempts = greatest(d.attempts - 1, 0)
  where d.id = any (coalesce(p_released, '{}'::uuid[]))
    and d.sent_at is null
    and d.claimed_at is not null;
  get diagnostics v_released = row_count;

  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'released', v_released);
end;
$$;

comment on function public.settle_daily_digests(text, uuid[], uuid[], uuid[]) is
  'Cron diário: confirma os resumos enviados (não saem de novo no mesmo dia), devolve os que falharam (conta tentativa, até 5) e os que nem foram tentados (não conta). Exige a chave do servidor.';

revoke all on function public.settle_daily_digests(text, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.settle_daily_digests(text, uuid[], uuid[], uuid[]) to anon;

-- -----------------------------------------------------------------------------
-- 6. Lembrete de visita (2 horas antes)
-- -----------------------------------------------------------------------------
create table if not exists private.visit_reminder_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Início da visita quando o lembrete nasceu: remarcar abre um lembrete novo.
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts smallint not null default 0,
  constraint visit_reminder_notifications_once unique (appointment_id, user_id, starts_at)
);

create index if not exists visit_reminder_notifications_pending_idx
  on private.visit_reminder_notifications (starts_at)
  where sent_at is null;
create index if not exists visit_reminder_notifications_user_id_idx
  on private.visit_reminder_notifications (user_id);
create index if not exists visit_reminder_notifications_organization_id_idx
  on private.visit_reminder_notifications (organization_id);

comment on table private.visit_reminder_notifications is
  'Fila dos lembretes de visita por e-mail (2 horas antes, para o corretor da visita). A chave única garante um lembrete por visita, corretor e horário. Alimentada por private.enqueue_visit_reminders (pg_cron) e drenada por public.claim_visit_reminders.';

alter table private.visit_reminder_notifications enable row level security;
revoke all on table private.visit_reminder_notifications from public, anon, authenticated;

-- Varredura das visitas em aberto por início (parcial: só o que ainda pode ter lembrete).
create index if not exists appointments_open_starts_at_idx
  on public.appointments (starts_at)
  where status in ('scheduled', 'confirmed');

create or replace function private.enqueue_visit_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_inserted integer := 0;
begin
  insert into private.visit_reminder_notifications (organization_id, appointment_id, user_id, starts_at)
  select a.organization_id, a.id, a.broker_id, a.starts_at
  from public.appointments a
  join public.memberships m
    on m.organization_id = a.organization_id
   and m.user_id = a.broker_id
   and m.active
  join auth.users u on u.id = a.broker_id
  left join public.email_preferences ep on ep.user_id = a.broker_id
  where a.status in ('scheduled', 'confirmed')
    and a.broker_id is not null
    -- Até 2 h antes; visita a menos de 10 min não vale mais o e-mail.
    and a.starts_at > v_now + interval '10 minutes'
    and a.starts_at <= v_now + interval '2 hours'
    and u.email is not null
    and u.email_confirmed_at is not null
    and coalesce(ep.visit_reminders, true)
    and private.billing_state(a.organization_id) <> 'read_only'
  on conflict on constraint visit_reminder_notifications_once do nothing;
  get diagnostics v_inserted = row_count;

  -- Limpeza: enviados há mais de 7 dias e pendentes de visitas que já passaram.
  delete from private.visit_reminder_notifications n
  where (n.sent_at is not null and n.sent_at < v_now - interval '7 days')
     or (n.sent_at is null and n.starts_at < v_now - interval '1 day');

  return v_inserted;
end;
$$;

comment on function private.enqueue_visit_reminders() is
  'Rotina agendada (pg_cron, job lembretes-de-visita, a cada 5 min): enfileira o lembrete de cada visita agendada ou confirmada que começa em até 2 horas, para o corretor com e-mail confirmado e preferência ligada. Idempotente.';

revoke all on function private.enqueue_visit_reminders() from public, anon, authenticated;

-- Aviso ao servidor Next (pg_net) quando há lembrete na fila. Só dispara com os
-- dois segredos no Vault: visit_reminders_webhook_url (https) e
-- visit_reminders_webhook_secret (mesmo valor de CRON_SECRET).
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
  'Chama a rota do Next que envia os lembretes de visita (POST com Authorization: Bearer) quando há lembrete pendente. Sem os segredos visit_reminders_webhook_url e visit_reminders_webhook_secret no Vault, não faz nada.';

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
    select private.ping_visit_reminders_webhook();
  $cron$
);

create or replace function public.claim_visit_reminders(
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
  recipient_name text
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

  -- Lembrete que não vale mais (visita passou, foi remarcada, cancelada ou
  -- trocou de corretor) sai da fila antes de reservar.
  delete from private.visit_reminder_notifications n
  where n.sent_at is null
    and (
      n.starts_at <= now()
      or not exists (
        select 1
        from public.appointments a
        where a.id = n.appointment_id
          and a.status in ('scheduled', 'confirmed')
          and a.starts_at = n.starts_at
          and a.broker_id = n.user_id
      )
    );

  return query
  with escolhidos as (
    select n.id
    from private.visit_reminder_notifications n
    join auth.users u on u.id = n.user_id
    left join public.email_preferences ep on ep.user_id = n.user_id
    where n.sent_at is null
      and (n.claimed_at is null or n.claimed_at < now() - interval '15 minutes')
      and n.attempts < 5
      and u.email is not null
      and u.email_confirmed_at is not null
      and coalesce(ep.visit_reminders, true)
      and exists (
        select 1
        from public.memberships m
        where m.organization_id = n.organization_id
          and m.user_id = n.user_id
          and m.active
      )
    order by n.starts_at, n.id
    limit v_limit
    for update of n skip locked
  ),
  reivindicados as (
    update private.visit_reminder_notifications n
    set claimed_at = now(),
        attempts = n.attempts + 1
    from escolhidos e
    where n.id = e.id
    returning n.id, n.organization_id, n.appointment_id, n.user_id
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
    nullif(btrim(pr.full_name), '')
  from reivindicados r
  join public.organizations o on o.id = r.organization_id
  join public.appointments a on a.id = r.appointment_id
  left join public.properties p
    on p.organization_id = a.organization_id and p.id = a.property_id
  left join public.clients c
    on c.organization_id = a.organization_id and c.id = a.client_id
  join auth.users u on u.id = r.user_id
  left join public.profiles pr on pr.id = r.user_id
  order by a.starts_at, r.id;
end;
$$;

comment on function public.claim_visit_reminders(text, integer) is
  'Webhook/cron dos lembretes de visita: descarta lembretes que não valem mais e reserva os pendentes (visita ainda em aberto, no mesmo horário e com o mesmo corretor). Primeiro nome do cliente só quando o corretor enxerga o cliente; endereço cru + address_display. Todo id devolvido precisa voltar em settle_visit_reminders. Exige a chave do servidor.';

revoke all on function public.claim_visit_reminders(text, integer) from public, anon, authenticated;
grant execute on function public.claim_visit_reminders(text, integer) to anon;

create or replace function public.settle_visit_reminders(
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

  update private.visit_reminder_notifications n
  set sent_at = now(), claimed_at = coalesce(n.claimed_at, now())
  where n.id = any (coalesce(p_sent, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_sent = row_count;

  update private.visit_reminder_notifications n
  set claimed_at = null
  where n.id = any (coalesce(p_failed, '{}'::uuid[]))
    and n.sent_at is null;
  get diagnostics v_failed = row_count;

  update private.visit_reminder_notifications n
  set claimed_at = null,
      attempts = greatest(n.attempts - 1, 0)
  where n.id = any (coalesce(p_released, '{}'::uuid[]))
    and n.sent_at is null
    and n.claimed_at is not null;
  get diagnostics v_released = row_count;

  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'released', v_released);
end;
$$;

comment on function public.settle_visit_reminders(text, uuid[], uuid[], uuid[]) is
  'Confirma os lembretes de visita enviados, devolve os que falharam (conta tentativa, até 5) e os que nem foram tentados (não conta). Exige a chave do servidor.';

revoke all on function public.settle_visit_reminders(text, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.settle_visit_reminders(text, uuid[], uuid[], uuid[]) to anon;

-- -----------------------------------------------------------------------------
-- 7. Relatório semanal ao gestor
-- -----------------------------------------------------------------------------
create table if not exists private.weekly_report_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Segunda-feira da semana relatada.
  week_start date not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  -- Semana sem nenhum número: não envia.
  skipped_at timestamptz,
  attempts smallint not null default 0,
  constraint weekly_report_deliveries_once unique (organization_id, user_id, week_start)
);

create index if not exists weekly_report_deliveries_user_id_idx
  on private.weekly_report_deliveries (user_id);
create index if not exists weekly_report_deliveries_week_start_idx
  on private.weekly_report_deliveries (week_start);

comment on table private.weekly_report_deliveries is
  'Controle do relatório semanal por e-mail: uma linha por imobiliária, gestor e semana (chave única), para o relatório nunca sair duas vezes. skipped_at = semana sem números. Linhas com mais de 8 semanas são apagadas pelo próprio claim.';

alter table private.weekly_report_deliveries enable row level security;
revoke all on table private.weekly_report_deliveries from public, anon, authenticated;

create or replace function public.claim_weekly_reports(
  p_server_key text,
  p_limit integer default 50,
  p_organization_id uuid default null
)
returns table (
  id uuid,
  organization_id uuid,
  organization_slug text,
  organization_name text,
  brand_color text,
  week_start date,
  week_end date,
  recipient_user_id uuid,
  recipient_email text,
  recipient_name text,
  report jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_now timestamptz := now();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_monday date;
  v_week_start date;
  v_from timestamptz;
  v_to timestamptz;
  v_returned integer := 0;
  v_org uuid;
  v_ids uuid[];
  v_users uuid[];
  v_prev_claims text;
  v_prev_sub text;
  v_brokers jsonb;
  v_totals jsonb;
  v_report jsonb;
begin
  perform private.check_notification_server_key(p_server_key);

  -- Semana anterior completa (segunda a domingo, dias civis de Brasília): o
  -- mesmo intervalo de /relatorios?de=<segunda>&ate=<domingo>.
  v_monday := v_today - (extract(isodow from v_today)::integer - 1);
  v_week_start := v_monday - 7;
  v_from := v_week_start::timestamp at time zone 'America/Sao_Paulo';
  v_to := v_monday::timestamp at time zone 'America/Sao_Paulo';

  delete from private.weekly_report_deliveries d
  where d.week_start < v_week_start - 56;

  for v_org in
    select distinct m.organization_id
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.email_preferences ep on ep.user_id = m.user_id
    where m.active
      and m.role in ('owner', 'manager')
      and (p_organization_id is null or m.organization_id = p_organization_id)
      and u.email is not null
      and u.email_confirmed_at is not null
      and coalesce(ep.weekly_report, true)
      and not exists (
        select 1
        from private.weekly_report_deliveries d
        where d.organization_id = m.organization_id
          and d.user_id = m.user_id
          and d.week_start = v_week_start
          and (
            d.sent_at is not null
            or d.skipped_at is not null
            or d.attempts >= 5
            or d.claimed_at >= v_now - interval '15 minutes'
          )
      )
      and private.billing_state(m.organization_id) <> 'read_only'
    order by m.organization_id
  loop
    exit when v_returned >= v_limit;

    -- Reserva atômica dos gestores desta imobiliária.
    with candidatos as (
      select m.user_id
      from public.memberships m
      join auth.users u on u.id = m.user_id
      left join public.email_preferences ep on ep.user_id = m.user_id
      where m.organization_id = v_org
        and m.active
        and m.role in ('owner', 'manager')
        and u.email is not null
        and u.email_confirmed_at is not null
        and coalesce(ep.weekly_report, true)
        and not exists (
          select 1
          from private.weekly_report_deliveries d
          where d.organization_id = v_org
            and d.user_id = m.user_id
            and d.week_start = v_week_start
            and (
              d.sent_at is not null
              or d.skipped_at is not null
              or d.attempts >= 5
              or d.claimed_at >= v_now - interval '15 minutes'
            )
        )
      order by m.role, m.user_id
      limit v_limit - v_returned
    ),
    reservados as (
      insert into private.weekly_report_deliveries as d (
        organization_id, user_id, week_start, claimed_at, attempts
      )
      select v_org, c.user_id, v_week_start, v_now, 1
      from candidatos c
      on conflict on constraint weekly_report_deliveries_once do update
        set claimed_at = excluded.claimed_at,
            attempts = d.attempts + 1
        where d.sent_at is null
          and d.skipped_at is null
          and d.attempts < 5
          and (d.claimed_at is null or d.claimed_at < v_now - interval '15 minutes')
      returning d.id, d.user_id
    )
    select coalesce(array_agg(r.id order by r.user_id), '{}'::uuid[]),
           coalesce(array_agg(r.user_id order by r.user_id), '{}'::uuid[])
      into v_ids, v_users
    from reservados r;

    continue when cardinality(v_ids) = 0;

    -- As funções de relatório são security invoker e recortam pela sessão
    -- (auth.uid() + papel). Aqui não há sessão: a conta roda com a identidade de
    -- um gestor reservado (dono ou gerente veem a equipe inteira, igual à tela),
    -- só dentro desta transação, e a identidade anterior volta logo depois.
    v_prev_claims := current_setting('request.jwt.claims', true);
    v_prev_sub := current_setting('request.jwt.claim.sub', true);
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_users[1], 'role', 'authenticated')::text,
      true
    );
    perform set_config('request.jwt.claim.sub', v_users[1]::text, true);

    with linhas as (
      select
        b.user_id,
        b.full_name,
        b.member_active,
        b.leads_received,
        b.leads_answered,
        b.leads_in_sla,
        b.leads_won,
        b.leads_lost,
        b.first_response_median_minutes,
        b.proposals_made,
        b.proposals_closed,
        b.proposals_closed_amount,
        coalesce(v.visits_scheduled, 0) as visits_scheduled,
        coalesce(v.visits_done, 0) as visits_done,
        coalesce(v.visits_no_show, 0) as visits_no_show,
        b.ordem
      from (
        select rb.*, row_number() over () as ordem
        from public.report_broker_performance(v_org, v_from, v_to) rb
      ) b
      left join public.report_broker_visits(v_org, v_from, v_to) v on v.user_id = b.user_id
    ),
    ativas as (
      select *
      from linhas l
      where l.leads_received > 0
         or l.leads_won > 0
         or l.leads_lost > 0
         or l.proposals_made > 0
         or l.proposals_closed > 0
         or l.visits_scheduled > 0
    )
    select
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'user_id', x.user_id,
              'name', x.full_name,
              'active', x.member_active,
              'leads_received', x.leads_received,
              'leads_answered', x.leads_answered,
              'leads_in_sla', x.leads_in_sla,
              'leads_won', x.leads_won,
              'first_response_median_minutes', x.first_response_median_minutes,
              'visits_scheduled', x.visits_scheduled,
              'visits_done', x.visits_done,
              'visits_no_show', x.visits_no_show,
              'proposals_made', x.proposals_made,
              'proposals_closed', x.proposals_closed,
              'proposals_closed_amount', x.proposals_closed_amount
            )
            order by x.ordem
          )
          from (select * from ativas order by ordem limit 20) x
        ),
        '[]'::jsonb
      ),
      jsonb_build_object(
        'brokers_with_activity', (select count(*) from ativas),
        'leads_received', (select coalesce(sum(leads_received), 0) from linhas),
        'leads_answered', (select coalesce(sum(leads_answered), 0) from linhas),
        'leads_in_sla', (select coalesce(sum(leads_in_sla), 0) from linhas),
        'leads_won', (select coalesce(sum(leads_won), 0) from linhas),
        'leads_lost', (select coalesce(sum(leads_lost), 0) from linhas),
        'visits_scheduled', (select coalesce(sum(visits_scheduled), 0) from linhas),
        'visits_done', (select coalesce(sum(visits_done), 0) from linhas),
        'visits_no_show', (select coalesce(sum(visits_no_show), 0) from linhas),
        'proposals_made', (select coalesce(sum(proposals_made), 0) from linhas),
        'proposals_closed', (select coalesce(sum(proposals_closed), 0) from linhas),
        'proposals_closed_amount', (select coalesce(sum(proposals_closed_amount), 0) from linhas)
      )
      into v_brokers, v_totals;

    perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);

    if coalesce((v_totals ->> 'brokers_with_activity')::integer, 0) = 0 then
      update private.weekly_report_deliveries d
      set skipped_at = v_now,
          claimed_at = null
      where d.id = any (v_ids);

      continue;
    end if;

    v_report := jsonb_build_object(
      'week_start', v_week_start,
      'week_end', v_week_start + 6,
      'totals', v_totals,
      'brokers', v_brokers
    );

    v_returned := v_returned + cardinality(v_ids);

    return query
    select
      d.id,
      o.id,
      o.slug::text,
      o.name,
      o.brand ->> 'primary_color',
      v_week_start,
      v_week_start + 6,
      u.id,
      u.email::text,
      nullif(btrim(pr.full_name), ''),
      v_report
    from private.weekly_report_deliveries d
    join public.organizations o on o.id = d.organization_id
    join auth.users u on u.id = d.user_id
    left join public.profiles pr on pr.id = d.user_id
    where d.id = any (v_ids)
    order by d.user_id;
  end loop;
end;
$$;

comment on function public.claim_weekly_reports(text, integer, uuid) is
  'Cron semanal (segunda 07h de Brasília): reserva o relatório da semana anterior (segunda a domingo) para cada dono e gerente ativo com e-mail confirmado e preferência ligada, um por imobiliária, pessoa e semana. Os números vêm de public.report_broker_performance e public.report_broker_visits (as mesmas funções de /relatorios), calculados com a identidade de um gestor reservado; totais = soma das linhas. Semana sem números fica marcada como pulada. Todo id devolvido precisa voltar em settle_weekly_reports. Exige a chave do servidor.';

revoke all on function public.claim_weekly_reports(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_weekly_reports(text, integer, uuid) to anon;

create or replace function public.settle_weekly_reports(
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

  update private.weekly_report_deliveries d
  set sent_at = now(), claimed_at = coalesce(d.claimed_at, now())
  where d.id = any (coalesce(p_sent, '{}'::uuid[]))
    and d.sent_at is null;
  get diagnostics v_sent = row_count;

  update private.weekly_report_deliveries d
  set claimed_at = null
  where d.id = any (coalesce(p_failed, '{}'::uuid[]))
    and d.sent_at is null;
  get diagnostics v_failed = row_count;

  update private.weekly_report_deliveries d
  set claimed_at = null,
      attempts = greatest(d.attempts - 1, 0)
  where d.id = any (coalesce(p_released, '{}'::uuid[]))
    and d.sent_at is null
    and d.claimed_at is not null;
  get diagnostics v_released = row_count;

  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'released', v_released);
end;
$$;

comment on function public.settle_weekly_reports(text, uuid[], uuid[], uuid[]) is
  'Cron semanal: confirma os relatórios enviados (não saem de novo na mesma semana), devolve os que falharam (conta tentativa, até 5) e os que nem foram tentados (não conta). Exige a chave do servidor.';

revoke all on function public.settle_weekly_reports(text, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.settle_weekly_reports(text, uuid[], uuid[], uuid[]) to anon;
