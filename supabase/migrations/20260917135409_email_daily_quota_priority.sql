-- =============================================================================
-- Cota diária de e-mail com prioridade por tipo de aviso
-- =============================================================================
-- Todos os e-mails da plataforma saem de uma única conta de envio (hoje Brevo
-- Free: 300 por dia, campanhas e transacionais, para todas as imobiliárias).
-- Este contador faz a reserva antes de cada envio e a confirmação depois, com
-- um teto por classe de prioridade calculado no app (@workspace/core/email/quota):
--   1 lead novo e prazo de 1º contato   2 convites e acesso à conta
--   3 lembretes de visita               4 cobrança, autorização e afins
--   5 resumo diário                     6 relatório semanal
-- As classes 1 e 2 podem usar a cota inteira; as demais param antes, deixando
-- uma reserva diária para o que não pode esperar.
--
-- Nada se perde em silêncio: aviso negado pela cota ou recusado pelo provedor
-- fica em private.email_undelivered_notices (só tipo, motivo, imobiliária e o
-- hash da chave de idempotência — nenhum e-mail, nome ou conteúdo) até sair.
-- O Painel (dono e gerente) e a Saúde do sistema do Console leem contagens.
--
-- Também: o relatório semanal passa a levar todos os corretores com atividade
-- (antes, no máximo 20) — o app mostra parte no corpo e o resto em CSV anexo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabelas
-- -----------------------------------------------------------------------------
create table if not exists private.email_daily_quota (
  -- Dia civil de Brasília.
  day date not null,
  priority smallint not null check (priority between 1 and 6),
  -- Reservado e ainda sem confirmação (envio em andamento ou interrompido).
  reserved integer not null default 0 check (reserved >= 0),
  sent integer not null default 0 check (sent >= 0),
  failed integer not null default 0 check (failed >= 0),
  -- Negados pela cota antes de tentar.
  denied integer not null default 0 check (denied >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, priority)
);

comment on table private.email_daily_quota is
  'Contador diário de e-mails por classe de prioridade (1 = lead novo ... 6 = relatório semanal). Uso do dia = soma de reserved + sent de todas as classes. Só contagens; linhas com mais de 35 dias são apagadas na primeira reserva de cada dia.';

alter table private.email_daily_quota enable row level security;

create policy "email_daily_quota: sem acesso pela API" on private.email_daily_quota
  as restrictive for all to anon, authenticated using (false) with check (false);

comment on policy "email_daily_quota: sem acesso pela API" on private.email_daily_quota is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

revoke all on private.email_daily_quota from public, anon, authenticated;

create table if not exists private.email_undelivered_notices (
  id uuid primary key default gen_random_uuid(),
  -- Dia civil de Brasília da primeira falha.
  day date not null,
  -- Chave de idempotência do envio (UUID derivado por SHA-256): identifica o
  -- aviso sem guardar destinatário nem conteúdo.
  notice_key uuid not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{2,39}$'),
  priority smallint not null check (priority between 1 and 6),
  reason text not null check (
    reason in ('daily_quota', 'rate_limited', 'not_configured', 'invalid_recipient', 'provider_error')
  ),
  attempts integer not null default 1 check (attempts >= 1),
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  delivered_at timestamptz,
  constraint email_undelivered_notices_once unique (day, notice_key)
);

create index if not exists email_undelivered_notices_org_day_idx
  on private.email_undelivered_notices (organization_id, day)
  where delivered_at is null;
create index if not exists email_undelivered_notices_notice_key_idx
  on private.email_undelivered_notices (notice_key);

comment on table private.email_undelivered_notices is
  'Avisos por e-mail que não saíram (cota diária, limite do provedor, configuração, destinatário inválido ou erro). Uma linha por aviso e dia; delivered_at preenchido quando uma nova tentativa sai. Sem dado pessoal: tipo, motivo, imobiliária e o hash da chave de idempotência. Apagadas depois de 35 dias.';

alter table private.email_undelivered_notices enable row level security;

create policy "email_undelivered_notices: sem acesso pela API" on private.email_undelivered_notices
  as restrictive for all to anon, authenticated using (false) with check (false);

comment on policy "email_undelivered_notices: sem acesso pela API" on private.email_undelivered_notices is
  'Negação explícita (RESTRICTIVE): tabela interna, lida e gravada só por funções security definer. Nunca crie política permissiva nem grant para anon/authenticated aqui.';

revoke all on private.email_undelivered_notices from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Funções internas
-- -----------------------------------------------------------------------------
create or replace function private.record_email_undelivered(
  p_day date,
  p_notice_key uuid,
  p_organization_slug text,
  p_kind text,
  p_priority integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.email_undelivered_notices as u (
    day, notice_key, organization_id, kind, priority, reason
  )
  values (
    p_day,
    p_notice_key,
    (select o.id from public.organizations o where o.slug = p_organization_slug),
    p_kind,
    p_priority,
    p_reason
  )
  on conflict on constraint email_undelivered_notices_once do update
    set reason = excluded.reason,
        attempts = u.attempts + 1,
        last_failed_at = now(),
        delivered_at = null;
end;
$$;

comment on function private.record_email_undelivered(date, uuid, text, text, integer, text) is
  'Marca um aviso por e-mail como não enviado no dia (ou soma mais uma tentativa). Uso interno de reserve_email_send e settle_email_send.';

revoke all on function private.record_email_undelivered(date, uuid, text, text, integer, text)
  from public, anon, authenticated;

create or replace function private.check_email_send_input(
  p_priority integer,
  p_kind text,
  p_notice_key uuid
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_priority is null or p_priority not between 1 and 6 then
    raise exception 'Prioridade inválida.' using errcode = '22023';
  end if;

  if p_kind is null or p_kind !~ '^[a-z][a-z0-9_]{2,39}$' then
    raise exception 'Tipo de aviso inválido.' using errcode = '22023';
  end if;

  if p_notice_key is null then
    raise exception 'Chave do aviso ausente.' using errcode = '22023';
  end if;
end;
$$;

comment on function private.check_email_send_input(integer, text, uuid) is
  'Validação comum de reserve_email_send e settle_email_send.';

revoke all on function private.check_email_send_input(integer, text, uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Reserva e confirmação (servidor Next, chave de notificação)
-- -----------------------------------------------------------------------------
create or replace function public.reserve_email_send(
  p_server_key text,
  p_priority integer,
  p_ceiling integer,
  p_kind text,
  p_notice_key uuid,
  p_organization_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_used integer;
  v_first boolean;
begin
  perform private.check_notification_server_key(p_server_key);
  perform private.check_email_send_input(p_priority, p_kind, p_notice_key);

  if p_ceiling is null or p_ceiling not between 0 and 10000000 then
    raise exception 'Teto inválido.' using errcode = '22023';
  end if;

  -- Uma reserva por vez em todo o banco: a soma do dia e o incremento precisam
  -- ser atômicos entre execuções paralelas (webhooks e crons).
  perform pg_advisory_xact_lock(hashtextextended('private.email_daily_quota', 0));

  select coalesce(sum(q.reserved + q.sent), 0)::integer, count(*) = 0
    into v_used, v_first
  from private.email_daily_quota q
  where q.day = v_day;

  if v_first then
    delete from private.email_daily_quota q where q.day < v_day - 35;
    delete from private.email_undelivered_notices u where u.day < v_day - 35;
  end if;

  if v_used < p_ceiling then
    insert into private.email_daily_quota as q (day, priority, reserved)
    values (v_day, p_priority, 1)
    on conflict (day, priority) do update
      set reserved = q.reserved + 1,
          updated_at = now();

    return jsonb_build_object('ok', true, 'day', v_day, 'used', v_used + 1);
  end if;

  insert into private.email_daily_quota as q (day, priority, denied)
  values (v_day, p_priority, 1)
  on conflict (day, priority) do update
    set denied = q.denied + 1,
        updated_at = now();

  perform private.record_email_undelivered(
    v_day, p_notice_key, p_organization_slug, p_kind, p_priority, 'daily_quota'
  );

  return jsonb_build_object('ok', false, 'day', v_day, 'used', v_used);
end;
$$;

comment on function public.reserve_email_send(text, integer, integer, text, uuid, text) is
  'Servidor Next, antes de cada e-mail: reserva 1 envio na cota do dia (Brasília) se o uso do dia (reservados + enviados, todas as classes) ainda estiver abaixo do teto da classe (calculado no app). Negado: conta em denied e marca o aviso como não enviado (daily_quota). Devolve {ok, day, used}; o day volta em settle_email_send. Exige a chave do servidor.';

revoke all on function public.reserve_email_send(text, integer, integer, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_email_send(text, integer, integer, text, uuid, text) to anon;

create or replace function public.settle_email_send(
  p_server_key text,
  p_day date,
  p_priority integer,
  p_kind text,
  p_notice_key uuid,
  p_organization_slug text default null,
  p_sent boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_reason text := coalesce(p_reason, 'provider_error');
  v_updated integer;
begin
  perform private.check_notification_server_key(p_server_key);
  perform private.check_email_send_input(p_priority, p_kind, p_notice_key);

  if p_day is null or p_day not between v_today - 1 and v_today then
    raise exception 'Dia inválido.' using errcode = '22023';
  end if;

  if not coalesce(p_sent, false) and v_reason not in (
    'rate_limited', 'not_configured', 'invalid_recipient', 'provider_error'
  ) then
    raise exception 'Motivo inválido.' using errcode = '22023';
  end if;

  update private.email_daily_quota q
  set reserved = greatest(q.reserved - 1, 0),
      sent = q.sent + case when coalesce(p_sent, false) then 1 else 0 end,
      failed = q.failed + case when coalesce(p_sent, false) then 0 else 1 end,
      updated_at = now()
  where q.day = p_day
    and q.priority = p_priority;
  get diagnostics v_updated = row_count;

  if coalesce(p_sent, false) then
    -- Saiu numa nova tentativa: some do cartão "Avisos não enviados".
    update private.email_undelivered_notices u
    set delivered_at = now()
    where u.notice_key = p_notice_key
      and u.delivered_at is null
      and u.day >= p_day - 7;
  else
    perform private.record_email_undelivered(
      p_day, p_notice_key, p_organization_slug, p_kind, p_priority, v_reason
    );
  end if;

  return jsonb_build_object('settled', v_updated = 1);
end;
$$;

comment on function public.settle_email_send(text, date, integer, text, uuid, text, boolean, text) is
  'Servidor Next, depois de cada e-mail reservado: enviado conta em sent (e marca o aviso como entregue se tinha falhado antes); falha devolve a reserva (conta em failed) e marca o aviso como não enviado com o motivo. Exige a chave do servidor.';

revoke all on function public.settle_email_send(text, date, integer, text, uuid, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.settle_email_send(text, date, integer, text, uuid, text, boolean, text) to anon;

-- -----------------------------------------------------------------------------
-- 4. Leitura: Painel (dono e gerente) e Console (Saúde do sistema)
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_undelivered_emails(p_organization_id uuid)
returns table (
  kind text,
  priority smallint,
  reason text,
  notices integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
     or not private.has_role(p_organization_id, '{owner,manager}'::public.app_role[]) then
    return;
  end if;

  return query
  select u.kind, u.priority, u.reason, count(*)::integer
  from private.email_undelivered_notices u
  where u.organization_id = p_organization_id
    and u.day = (now() at time zone 'America/Sao_Paulo')::date
    and u.delivered_at is null
  group by u.kind, u.priority, u.reason
  order by u.priority, u.kind, u.reason;
end;
$$;

comment on function public.dashboard_undelivered_emails(uuid) is
  'Painel: contagem dos avisos por e-mail desta imobiliária que não saíram hoje (Brasília), por tipo e motivo. Só dono e gerente ativos; para os demais volta vazio. Sem dado pessoal.';

revoke all on function public.dashboard_undelivered_emails(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_undelivered_emails(uuid) to authenticated;

create or replace function public.platform_email_quota(p_server_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform private.check_platform_server_key(p_server_key);

  return jsonb_build_object(
    'day', v_day,
    'by_priority', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'priority', q.priority,
          'reserved', q.reserved,
          'sent', q.sent,
          'failed', q.failed,
          'denied', q.denied
        )
        order by q.priority
      )
      from private.email_daily_quota q
      where q.day = v_day
    ), '[]'::jsonb),
    'undelivered_by_kind', coalesce((
      select jsonb_agg(
        jsonb_build_object('kind', x.kind, 'reason', x.reason, 'notices', x.notices)
        order by x.notices desc, x.kind
      )
      from (
        select u.kind, u.reason, count(*)::integer as notices
        from private.email_undelivered_notices u
        where u.day = v_day
          and u.delivered_at is null
        group by u.kind, u.reason
      ) x
    ), '[]'::jsonb),
    'undelivered_organizations', (
      select count(distinct u.organization_id)::integer
      from private.email_undelivered_notices u
      where u.day = v_day
        and u.delivered_at is null
    ),
    'last_days', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'day', d.day,
          'sent', d.sent,
          'failed', d.failed,
          'denied', d.denied
        )
        order by d.day desc
      )
      from (
        select q.day, sum(q.sent)::integer as sent, sum(q.failed)::integer as failed,
               sum(q.denied)::integer as denied
        from private.email_daily_quota q
        where q.day between v_day - 6 and v_day
        group by q.day
      ) d
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.platform_email_quota(text) is
  'Servidor Next (PLATFORM_SERVER_KEY), depois de conferir a equipe da plataforma: uso da cota de e-mail de hoje por classe de prioridade, avisos não enviados hoje por tipo e motivo, quantas imobiliárias foram afetadas e os totais dos últimos 7 dias. Só contagens.';

revoke all on function public.platform_email_quota(text) from public, anon, authenticated;
grant execute on function public.platform_email_quota(text) to anon;

-- -----------------------------------------------------------------------------
-- 5. Relatório semanal com todos os corretores (antes: no máximo 20)
-- -----------------------------------------------------------------------------
-- Mesma função de 20260917012450, só com o teto de linhas por corretor subido
-- para 500 (trava de tamanho). O app mostra até 30 no corpo e manda a lista
-- completa em CSV anexo; a repescagem é o mesmo claim rodando na terça.

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
          from (select * from ativas order by ordem limit 500) x
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
  'Cron semanal (segunda 07h de Brasília, com repescagem na terça): reserva o relatório da semana anterior (segunda a domingo) para cada dono e gerente ativo com e-mail confirmado e preferência ligada, um por imobiliária, pessoa e semana. Os números vêm de public.report_broker_performance e public.report_broker_visits (as mesmas funções de /relatorios), calculados com a identidade de um gestor reservado; totais = soma das linhas. Semana sem números fica marcada como pulada. Todo id devolvido precisa voltar em settle_weekly_reports. Exige a chave do servidor.';

revoke all on function public.claim_weekly_reports(text, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_weekly_reports(text, integer, uuid) to anon;
