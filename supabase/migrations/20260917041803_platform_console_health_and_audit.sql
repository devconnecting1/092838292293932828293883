-- =============================================================================
-- Console da Plataforma: chave do servidor, registro do console e saúde
-- =============================================================================
-- Área interna da equipe dona do SaaS (/plataforma), fora do CRM das
-- imobiliárias. O servidor Next confere o e-mail confirmado do usuário logado
-- (PLATFORM_ADMIN_EMAILS) e só então chama estas RPCs, sem sessão, com a chave
-- publishable + PLATFORM_SERVER_KEY (segredo platform_server_key do Vault).
-- Nunca service_role.
--
--  1. Segredo do Vault platform_server_key e private.check_platform_server_key
--  2. private.platform_audit_events: registro do console, só de acréscimo
--  3. private.record_platform_audit_event (para as RPCs futuras do console
--     gravarem o registro na mesma transação da mudança),
--     public.platform_log_action e public.platform_list_audit_events
--  4. public.platform_health: retrato global só com contagens e estados, sem
--     nenhum dado pessoal (rotinas do pg_cron, segredos esperados no Vault,
--     filas e assinaturas)

-- -----------------------------------------------------------------------------
-- 1. Chave do servidor
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'platform_server_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'platform_server_key',
      'Chave do servidor Next para as RPCs do Console da Plataforma (env PLATFORM_SERVER_KEY).'
    );
  end if;
end;
$$;

create or replace function private.check_platform_server_key(p_server_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'platform_server_key'
  limit 1;

  if v_secret is null
     or p_server_key is null
     or extensions.digest(p_server_key, 'sha256') <> extensions.digest(v_secret, 'sha256') then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
end;
$$;

comment on function private.check_platform_server_key(text) is
  'Confere a PLATFORM_SERVER_KEY (segredo platform_server_key do Vault) e levanta 42501 se não conferir. Uso interno das RPCs do Console da Plataforma.';

revoke all on function private.check_platform_server_key(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Registro do console (só de acréscimo)
-- -----------------------------------------------------------------------------
-- Sem chave estrangeira para auth.users nem para organizations, de propósito: o
-- registro precisa continuar legível depois que a conta ou a imobiliária forem
-- apagadas. Antes/depois guardam só o necessário para entender a mudança, sem
-- dado pessoal de cliente final.
create table private.platform_audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid not null,
  actor_email text not null,
  action text not null,
  target_type text,
  target_id text,
  organization_id uuid,
  reason text,
  before_data jsonb,
  after_data jsonb,
  constraint platform_audit_events_actor_email_check
    check (
      actor_email = lower(actor_email)
      and char_length(actor_email) between 3 and 320
      and actor_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
  constraint platform_audit_events_action_check
    check (char_length(action) <= 80 and action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$'),
  constraint platform_audit_events_target_type_check
    check (target_type is null or target_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint platform_audit_events_target_id_check
    check (target_id is null or (target_type is not null and char_length(target_id) between 1 and 200)),
  constraint platform_audit_events_reason_check
    check (reason is null or char_length(reason) between 3 and 1000),
  constraint platform_audit_events_before_data_check
    check (
      before_data is null
      or (jsonb_typeof(before_data) = 'object' and octet_length(before_data::text) <= 16384)
    ),
  constraint platform_audit_events_after_data_check
    check (
      after_data is null
      or (jsonb_typeof(after_data) = 'object' and octet_length(after_data::text) <= 16384)
    )
);

comment on table private.platform_audit_events is
  'Registro do Console da Plataforma: quem (e-mail e id da conta da equipe), o quê (ação), em quem (alvo e imobiliária), por quê (motivo), antes/depois (sem dado pessoal de cliente final) e quando. Só de acréscimo: UPDATE, DELETE e TRUNCATE são recusados por gatilho. Escrita só por private.record_platform_audit_event.';
comment on column private.platform_audit_events.actor_email is
  'E-mail confirmado de quem agiu (equipe da plataforma), em minúsculas, conferido contra auth.users na gravação.';
comment on column private.platform_audit_events.action is
  'Ação em snake_case com até 4 partes separadas por ponto (ex.: organizacao.bloquear, comunicado.publicar).';
comment on column private.platform_audit_events.target_type is
  'Tipo do alvo (ex.: organizacao, assinatura, comunicado). Null quando a ação é do sistema todo.';
comment on column private.platform_audit_events.target_id is
  'Identificador do alvo (uuid, id da Stripe, slug). Exige target_type.';
comment on column private.platform_audit_events.organization_id is
  'Imobiliária afetada, quando houver. Sem chave estrangeira: o registro sobrevive à exclusão da imobiliária.';
comment on column private.platform_audit_events.before_data is
  'Estado relevante antes da mudança (objeto JSON, até 16 KB), sem dado pessoal de cliente final.';
comment on column private.platform_audit_events.after_data is
  'Estado relevante depois da mudança (objeto JSON, até 16 KB), sem dado pessoal de cliente final.';

create index platform_audit_events_organization_idx
  on private.platform_audit_events (organization_id, id desc)
  where organization_id is not null;

create index platform_audit_events_action_idx
  on private.platform_audit_events (action, id desc);

alter table private.platform_audit_events enable row level security;

-- Sem política: ninguém lê nem escreve direto; só as funções abaixo.
revoke all on private.platform_audit_events from public, anon, authenticated;

create or replace function private.platform_audit_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O registro do console só aceita novas linhas.' using errcode = '42501';
end;
$$;

comment on function private.platform_audit_events_append_only() is
  'Gatilho que torna private.platform_audit_events só de acréscimo (recusa UPDATE, DELETE e TRUNCATE).';

revoke all on function private.platform_audit_events_append_only() from public, anon, authenticated;

create trigger platform_audit_events_append_only_rows
  before update or delete on private.platform_audit_events
  for each row execute function private.platform_audit_events_append_only();

create trigger platform_audit_events_append_only_truncate
  before truncate on private.platform_audit_events
  for each statement execute function private.platform_audit_events_append_only();

-- Barreira final contra dado pessoal no antes/depois. O servidor Next já limpa
-- os dados (packages/core/src/platform/audit.ts); aqui recusa o que escapar:
-- e-mail, CPF formatado e telefone com DDD entre parênteses.
create or replace function private.platform_audit_has_personal_data(p_data jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_data is not null
    and (
      p_data::text ~ '[^[:space:]@"]+@[^[:space:]@"]+\.[^[:space:]@"]+'
      or p_data::text ~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'
      or p_data::text ~ '\([0-9]{2}\)[[:space:]]?[0-9]{4,5}-?[0-9]{4}'
    );
$$;

comment on function private.platform_audit_has_personal_data(jsonb) is
  'Verdadeiro quando o JSON tem e-mail, CPF formatado ou telefone com DDD. Usada para recusar dado pessoal no antes/depois do registro do console.';

revoke all on function private.platform_audit_has_personal_data(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Gravação e leitura do registro
-- -----------------------------------------------------------------------------
create or replace function private.record_platform_audit_event(
  p_actor_user_id uuid,
  p_actor_email text,
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_organization_id uuid default null,
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_actor_email, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id bigint;
begin
  -- Quem agiu precisa ser uma conta real, com esse e-mail e confirmada.
  if p_actor_user_id is null or not exists (
    select 1
    from auth.users u
    where u.id = p_actor_user_id
      and lower(u.email) = v_email
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if private.platform_audit_has_personal_data(p_before)
     or private.platform_audit_has_personal_data(p_after) then
    raise exception 'O antes/depois do registro não pode ter dado pessoal.' using errcode = '22023';
  end if;

  insert into private.platform_audit_events (
    actor_user_id, actor_email, action, target_type, target_id, organization_id,
    reason, before_data, after_data
  )
  values (
    p_actor_user_id, v_email, btrim(p_action), nullif(btrim(coalesce(p_target_type, '')), ''),
    nullif(btrim(coalesce(p_target_id, '')), ''), p_organization_id, v_reason, p_before, p_after
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.record_platform_audit_event(uuid, text, text, text, text, uuid, text, jsonb, jsonb) is
  'Grava uma linha no registro do console. Confere a conta de quem agiu (id + e-mail confirmado) e recusa dado pessoal no antes/depois. RPCs futuras do console que alteram dados devem chamá-la na mesma transação da mudança.';

revoke all on function private.record_platform_audit_event(uuid, text, text, text, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;

create or replace function public.platform_log_action(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_organization_id uuid default null,
  p_reason text default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_platform_server_key(p_server_key);

  return private.record_platform_audit_event(
    p_actor_user_id, p_actor_email, p_action, p_target_type, p_target_id,
    p_organization_id, p_reason, p_before, p_after
  );
end;
$$;

comment on function public.platform_log_action(text, uuid, text, text, text, text, uuid, text, jsonb, jsonb) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: grava uma ação do Console da Plataforma no registro e devolve o id. Só de acréscimo.';

create or replace function public.platform_list_audit_events(
  p_server_key text,
  p_limit integer default 50,
  p_before_id bigint default null,
  p_organization_id uuid default null,
  p_action text default null
)
returns table (
  id bigint,
  occurred_at timestamptz,
  actor_user_id uuid,
  actor_email text,
  action text,
  target_type text,
  target_id text,
  organization_id uuid,
  reason text,
  before_data jsonb,
  after_data jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.check_platform_server_key(p_server_key);

  return query
  select
    e.id, e.occurred_at, e.actor_user_id, e.actor_email, e.action, e.target_type,
    e.target_id, e.organization_id, e.reason, e.before_data, e.after_data
  from private.platform_audit_events e
  where (p_before_id is null or e.id < p_before_id)
    and (p_organization_id is null or e.organization_id = p_organization_id)
    and (p_action is null or e.action = p_action)
  order by e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

comment on function public.platform_list_audit_events(text, integer, bigint, uuid, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): registro do console do mais novo para o mais antigo, paginado por id (p_before_id), com filtro opcional por imobiliária e por ação. Até 200 linhas.';

-- -----------------------------------------------------------------------------
-- 4. Saúde do sistema
-- -----------------------------------------------------------------------------
-- Retrato global para a tela /plataforma/saude. Cada parte é calculada num
-- bloco próprio: se uma falhar, volta null (indisponível) e as outras seguem.
-- Só contagens, horários e estados; mensagens de erro das rotinas saem só na
-- primeira linha, cortadas e sem e-mail nem sequência longa de números.
create or replace function public.platform_health(
  p_server_key text,
  p_secret_names text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_names text[] := coalesce(p_secret_names, '{}'::text[]);
  v_cron jsonb;
  v_vault jsonb;
  v_queues jsonb;
  v_billing jsonb;
begin
  perform private.check_platform_server_key(p_server_key);

  if cardinality(v_names) > 50 or exists (
    select 1 from unnest(v_names) as n(name) where n.name is null or n.name !~ '^[a-z][a-z0-9_]{2,62}$'
  ) then
    raise exception 'Nomes de segredo inválidos.' using errcode = '22023';
  end if;

  -- Rotinas do banco (pg_cron). O histórico tem 14 dias (limpeza-historico-cron).
  begin
    with last_run as (
      select distinct on (d.jobid)
        d.jobid, d.status, d.start_time, d.end_time, d.return_message
      from cron.job_run_details d
      where d.start_time > v_now - interval '15 days'
      order by d.jobid, d.start_time desc, d.runid desc
    ),
    recent as (
      select
        d.jobid,
        count(*) as runs,
        count(*) filter (where d.status = 'failed') as failures
      from cron.job_run_details d
      where d.start_time > v_now - interval '24 hours'
      group by d.jobid
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', j.jobname,
      'schedule', j.schedule,
      'active', j.active,
      'last_status', l.status,
      'last_started_at', l.start_time,
      'last_finished_at', l.end_time,
      'last_message', case when l.status = 'failed' then left(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              split_part(coalesce(l.return_message, ''), E'\n', 1),
              '\([^()]*\)=\([^()]*\)', '(...)', 'g'
            ),
            '[^[:space:]@]+@[^[:space:]@]+', '[e-mail]', 'g'
          ),
          '[0-9][0-9 ().-]{6,}[0-9]', '[número]', 'g'
        ),
        160
      ) end,
      'runs_24h', coalesce(r.runs, 0),
      'failures_24h', coalesce(r.failures, 0)
    ) order by j.jobname), '[]'::jsonb)
    into v_cron
    from cron.job j
    left join last_run l on l.jobid = j.jobid
    left join recent r on r.jobid = j.jobid;
  exception when others then
    v_cron := null;
  end;

  -- Segredos esperados no Vault: só se existem, pelos nomes pedidos.
  begin
    select coalesce(jsonb_object_agg(
      n.name,
      exists (select 1 from vault.secrets s where s.name = n.name)
    ), '{}'::jsonb)
    into v_vault
    from (select distinct u.name from unnest(v_names) as u(name)) n;
  exception when others then
    v_vault := null;
  end;

  -- Filas de envio: só contagens. stale_after_minutes diz a partir de quando um
  -- item pendente conta como antigo.
  begin
    select jsonb_build_object(
      'avisos_de_lead', (
        select jsonb_build_object(
          'pending', count(*) filter (where n.sent_at is null and n.attempts < 5),
          'stale', count(*) filter (
            where n.sent_at is null and n.attempts < 5 and n.created_at < v_now - interval '60 minutes'),
          'failed', count(*) filter (
            where n.sent_at is null and n.attempts >= 5 and n.created_at > v_now - interval '7 days'),
          'oldest_pending_at', min(n.created_at) filter (where n.sent_at is null and n.attempts < 5),
          'stale_after_minutes', 60
        )
        from private.lead_notifications n
      ),
      'alertas_de_autorizacao', (
        select jsonb_build_object(
          'pending', count(*) filter (where n.sent_at is null and n.attempts < 5),
          'stale', count(*) filter (
            where n.sent_at is null and n.attempts < 5 and n.created_at < v_now - interval '26 hours'),
          'failed', count(*) filter (
            where n.sent_at is null and n.attempts >= 5 and n.created_at > v_now - interval '30 days'),
          'oldest_pending_at', min(n.created_at) filter (where n.sent_at is null and n.attempts < 5),
          'stale_after_minutes', 1560
        )
        from private.authorization_alert_notifications n
      ),
      'lembretes_de_visita', (
        select jsonb_build_object(
          'pending', count(*) filter (
            where n.sent_at is null and n.attempts < 5 and n.starts_at > v_now),
          'stale', count(*) filter (
            where n.sent_at is null and n.attempts < 5 and n.starts_at > v_now
              and n.created_at < v_now - interval '30 minutes'),
          'failed', count(*) filter (
            where n.sent_at is null and (n.attempts >= 5 or n.starts_at <= v_now)
              and n.starts_at > v_now - interval '7 days'),
          'oldest_pending_at', min(n.created_at) filter (
            where n.sent_at is null and n.attempts < 5 and n.starts_at > v_now),
          'stale_after_minutes', 30
        )
        from private.visit_reminder_notifications n
      ),
      'resumos_diarios', (
        select jsonb_build_object(
          'pending', count(*) filter (
            where d.sent_at is null and d.skipped_at is null and d.attempts < 5),
          'stale', count(*) filter (
            where d.sent_at is null and d.skipped_at is null and d.attempts < 5
              and d.created_at < v_now - interval '120 minutes'),
          'failed', count(*) filter (
            where d.sent_at is null and d.skipped_at is null and d.attempts >= 5
              and d.created_at > v_now - interval '7 days'),
          'oldest_pending_at', min(d.created_at) filter (
            where d.sent_at is null and d.skipped_at is null and d.attempts < 5),
          'stale_after_minutes', 120
        )
        from private.daily_digest_deliveries d
      ),
      'relatorios_semanais', (
        select jsonb_build_object(
          'pending', count(*) filter (
            where d.sent_at is null and d.skipped_at is null and d.attempts < 5),
          'stale', count(*) filter (
            where d.sent_at is null and d.skipped_at is null and d.attempts < 5
              and d.created_at < v_now - interval '120 minutes'),
          'failed', count(*) filter (
            where d.sent_at is null and d.skipped_at is null and d.attempts >= 5
              and d.created_at > v_now - interval '30 days'),
          'oldest_pending_at', min(d.created_at) filter (
            where d.sent_at is null and d.skipped_at is null and d.attempts < 5),
          'stale_after_minutes', 120
        )
        from private.weekly_report_deliveries d
      ),
      -- Push: "pending" = avisos das últimas 24 h ainda sem e-mail e sem push para
      -- quem tem aparelho; "stale" = o e-mail já saiu e o push não (chaves VAPID
      -- ausentes ou envio de push com falha). Prazo acabando não conta: o push
      -- dele só sai antes do prazo.
      'push_de_avisos', (
        select jsonb_build_object(
          'pending', count(*) filter (where n.sent_at is null),
          'stale', count(*) filter (where n.sent_at is not null and n.kind <> 'sla_warning'),
          'failed', 0,
          'oldest_pending_at', min(n.created_at) filter (where n.sent_at is null),
          'stale_after_minutes', null,
          'devices', (select count(*) from public.push_subscriptions)
        )
        from private.lead_notifications n
        where n.push_sent_at is null
          and n.attempts < 5
          and n.created_at > v_now - interval '1 day'
          and exists (
            select 1
            from public.push_subscriptions s
            where s.user_id = n.user_id
              and s.created_at <= n.created_at
              and (s.organization_id is null or s.organization_id = n.organization_id)
          )
      ),
      'entrada_de_leads', (
        select jsonb_build_object(
          'pending', count(*) filter (where del.status = 'pending'),
          'stale', count(*) filter (
            where del.status in ('pending', 'failed') and del.received_at < v_now - interval '60 minutes'),
          'failed', count(*) filter (where del.status = 'failed'),
          'oldest_pending_at', min(del.received_at) filter (where del.status in ('pending', 'failed')),
          'stale_after_minutes', 60
        )
        from public.lead_integration_deliveries del
        where del.status in ('pending', 'failed')
      )
    )
    into v_queues;
  exception when others then
    v_queues := null;
  end;

  -- Assinaturas: contagem por status da Stripe e por situação de acesso.
  begin
    select jsonb_build_object(
      'organizations', (select count(*) from public.organizations),
      'accounts', count(*),
      'with_customer', count(b.stripe_customer_id),
      'with_subscription', count(b.stripe_subscription_id),
      'by_status', coalesce((
        select jsonb_object_agg(s.status, s.total)
        from (
          select b2.status, count(*) as total
          from public.billing_accounts b2
          group by b2.status
        ) s
      ), '{}'::jsonb),
      'by_state', coalesce((
        select jsonb_object_agg(s.state, s.total)
        from (
          select
            private.billing_state_at(
              b3.status, b3.plan_key, b3.trial_ends_at, b3.current_period_end, v_now
            ) as state,
            count(*) as total
          from public.billing_accounts b3
          group by 1
        ) s
      ), '{}'::jsonb)
    )
    into v_billing
    from public.billing_accounts b;
  exception when others then
    v_billing := null;
  end;

  return jsonb_build_object(
    'generated_at', v_now,
    'cron_jobs', v_cron,
    'vault_secrets', v_vault,
    'queues', v_queues,
    'billing', v_billing
  );
end;
$$;

comment on function public.platform_health(text, text[]) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: retrato global da saúde do sistema para o Console da Plataforma. Rotinas do pg_cron (última execução, falhas em 24 h, mensagem curta sem dado pessoal), existência dos segredos pedidos no Vault (nunca o valor), contagens das filas de envio e das assinaturas. Parte que falhar volta null.';

-- -----------------------------------------------------------------------------
-- Privilégios: RPCs com chave do servidor só para anon (o servidor chama sem sessão)
-- -----------------------------------------------------------------------------
revoke all on function public.platform_log_action(text, uuid, text, text, text, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.platform_list_audit_events(text, integer, bigint, uuid, text)
  from public, anon, authenticated;
revoke all on function public.platform_health(text, text[]) from public, anon, authenticated;

grant execute on function public.platform_log_action(text, uuid, text, text, text, text, uuid, text, jsonb, jsonb)
  to anon;
grant execute on function public.platform_list_audit_events(text, integer, bigint, uuid, text) to anon;
grant execute on function public.platform_health(text, text[]) to anon;
