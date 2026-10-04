-- =============================================================================
-- Página de status: incidentes automáticos, aviso aos Donos e fornecedores
-- =============================================================================
-- O sistema passa a abrir, atualizar e fechar incidentes sozinho, sem IA e sem
-- custo novo: regras determinísticas e conservadoras que rodam dentro da mesma
-- rotina status-publico-medicoes (pg_cron, a cada minuto), no banco. Espelho
-- das regras em packages/core/src/status/automation.ts (mudou aqui, mude lá).
--
--  1. Registro do console aceita ação do sistema (ator nulo) por
--     private.record_system_audit_event; a lista mostra "sistema".
--  2. private.status_incidents ganha origem (team | automatic), o estado da
--     automação (assumido pela equipe ou pausado pelo limite de atualizações) e
--     o início do "monitorando" automático. Atualização sem autor = automação.
--  3. private.status_auto_tracker: medições seguidas por parte (nível depois da
--     histerese de 2). Sem medição não conta nada (nunca vira queda).
--  4. Regras (private.status_auto_incidents_step):
--     - abre com instabilidade parcial/fora do ar por 3 medições seguidas, ou
--       lentidão (ou pior) por 10; impacto: lentidão → pequeno, instabilidade
--       parcial → grande, fora do ar → crítico;
--     - não abre se a parte já está num incidente em aberto (da equipe ou
--       automático), em manutenção em andamento, ou sem medição neste minuto;
--     - partes que qualificam no mesmo minuto entram no MESMO incidente;
--     - piora → atualização com o impacto novo; 5 medições seguidas
--       operacionais → "monitorando"; mais 15 min estável → "resolvido"; voltou
--       a cair monitorando → "investigando" de novo; caiu até 30 min depois de
--       resolvido → reabre o mesmo;
--     - lentidão por 10 medições depois de uma queda → impacto volta a pequeno;
--     - no máximo 6 incidentes automáticos por parte por dia (dia de São
--       Paulo); passou disso, reabre o último do dia em vez de criar outro;
--     - no máximo 30 atualizações automáticas por incidente: depois disso a
--       automação para e o Console pede que a equipe assuma;
--     - equipe publicou atualização, editou ou clicou "Assumir" → a automação
--       não mexe mais nele.
--  5. private.status_alerts: aviso por e-mail aos Donos (PLATFORM_ADMIN_EMAILS,
--     no servidor) quando um incidente automático chega a impacto grande ou
--     crítico e quando ele se resolve sozinho. Fila com claim/settle
--     (platform_status_claim_alerts / platform_status_settle_alert, chave
--     platform_server_key) e webhook pg_net para /api/cron/status-alerts com os
--     segredos status_alerts_webhook_url e status_alerts_webhook_secret (mesmo
--     valor de CRON_SECRET). Trava: 10 e-mails em 24 h no total; webhook no
--     máximo a cada 10 min; aviso pendente expira em 6 h.
--  6. private.status_vendor_state: indicador público dos fornecedores com API
--     de status oficial (Atlassian Statuspage, /api/v2/status.json, sem chave e
--     sem limite de requisições: https://support.atlassian.com/statuspage/docs/what-are-the-different-apis-under-statuspage/
--     e https://status.supabase.com/api): Supabase e Vercel, a cada 5 min. Só
--     sinal interno: nunca muda a situação pública; quando coincide, o texto do
--     incidente automático diz "possível relação com instabilidade em um
--     fornecedor de infraestrutura" (sem nome). Stripe e Brevo ficam de fora
--     (sem JSON de status documentado oficialmente).
--  7. billing continua manual: o banco não guarda erro de processamento dos
--     webhooks da Stripe (só os logs da Vercel), então não há sinal confiável.
--
-- Custo: nenhuma chamada nova por minuto à Vercel. pg_net faz 2 GETs a cada
-- 5 min aos fornecedores (fora da Vercel) e, só com aviso pendente, 1 POST à
-- rota de avisos no máximo a cada 10 min.

-- -----------------------------------------------------------------------------
-- 1. Registro do console: ação do sistema
-- -----------------------------------------------------------------------------
alter table private.platform_audit_events
  alter column actor_user_id drop not null,
  alter column actor_email drop not null;

alter table private.platform_audit_events
  add constraint platform_audit_events_actor_check
    check ((actor_user_id is null) = (actor_email is null));

comment on table private.platform_audit_events is
  'Registro do Console da Plataforma: quem (e-mail e id da conta da equipe, ou nulo quando foi o sistema), o quê (ação), em quem (alvo e imobiliária), por quê (motivo), antes/depois (sem dado pessoal de cliente final) e quando. Só de acréscimo: UPDATE, DELETE e TRUNCATE são recusados por gatilho (exceto a retenção de 2 anos). Escrita só por private.record_platform_audit_event (equipe) e private.record_system_audit_event (sistema).';
comment on column private.platform_audit_events.actor_user_id is
  'Conta da equipe que agiu. Null junto com actor_email = ação do sistema (ex.: incidente automático da página de status), sem pessoa.';
comment on column private.platform_audit_events.actor_email is
  'E-mail confirmado de quem agiu (equipe da plataforma), em minúsculas, conferido contra auth.users na gravação. Null junto com actor_user_id = ação do sistema.';

create or replace function private.record_system_audit_event(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_before jsonb default null,
  p_after jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if private.platform_audit_has_personal_data(p_before)
     or private.platform_audit_has_personal_data(p_after) then
    raise exception 'O antes/depois do registro não pode ter dado pessoal.' using errcode = '22023';
  end if;

  insert into private.platform_audit_events (
    actor_user_id, actor_email, action, target_type, target_id, before_data, after_data
  )
  values (
    null,
    null,
    btrim(p_action),
    nullif(btrim(coalesce(p_target_type, '')), ''),
    nullif(btrim(coalesce(p_target_id, '')), ''),
    p_before,
    p_after
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function private.record_system_audit_event(text, text, text, jsonb, jsonb) is
  'Grava no registro do console uma ação do SISTEMA (sem pessoa: actor_user_id e actor_email nulos), recusando dado pessoal no antes/depois. Uso: automação da página de status. Nunca chamada por RPC exposta.';

revoke all on function private.record_system_audit_event(text, text, text, jsonb, jsonb)
  from public, anon, authenticated;

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
    e.id, e.occurred_at, e.actor_user_id, coalesce(e.actor_email, 'sistema'), e.action, e.target_type,
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
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): registro do console do mais novo para o mais antigo, paginado por id (p_before_id), com filtro opcional por imobiliária e por ação. Até 200 linhas. Ação do sistema vem com actor_user_id nulo e actor_email "sistema".';

-- -----------------------------------------------------------------------------
-- 2. Origem do incidente e estado da automação
-- -----------------------------------------------------------------------------
alter table private.status_incidents
  alter column created_by drop not null,
  add column source text not null default 'team',
  add column automation_stopped_at timestamptz,
  add column automation_stopped_reason text,
  add column automation_stopped_by uuid,
  add column auto_monitoring_since timestamptz;

alter table private.status_incidents
  add constraint status_incidents_source_check
    check (source in ('team', 'automatic') and (source = 'team' or kind = 'incident')),
  add constraint status_incidents_created_by_check
    check ((source = 'team') = (created_by is not null)),
  add constraint status_incidents_automation_check
    check (
      (automation_stopped_at is null) = (automation_stopped_reason is null)
      and (
        automation_stopped_reason is null
        or automation_stopped_reason in ('equipe', 'limite_de_atualizacoes')
      )
      and (automation_stopped_by is null or automation_stopped_reason = 'equipe')
      and (source = 'automatic' or (automation_stopped_at is null and auto_monitoring_since is null))
    );

comment on column private.status_incidents.source is
  'team = escrito pela equipe no Console; automatic = aberto pela automação da página de status (private.status_auto_incidents_step). O público vê a origem ("Detectado automaticamente"), nunca quem.';
comment on column private.status_incidents.created_by is
  'Conta da equipe que criou (sem chave estrangeira; o e-mail fica só no registro do console). Null só em incidente automático. Nunca vai ao público.';
comment on column private.status_incidents.automation_stopped_at is
  'Incidente automático: quando a automação deixou de mexer nele (equipe assumiu, publicou atualização ou editou; ou limite de atualizações). Null = a automação ainda conduz.';
comment on column private.status_incidents.automation_stopped_reason is
  'equipe (assumido pela equipe) ou limite_de_atualizacoes (30 atualizações automáticas: a equipe precisa assumir).';
comment on column private.status_incidents.automation_stopped_by is
  'Conta da equipe que assumiu (sem chave estrangeira). Nunca vai ao público.';
comment on column private.status_incidents.auto_monitoring_since is
  'Incidente automático em "monitorando": desde quando o funcionamento voltou (resolve sozinho 15 min depois se continuar estável).';

create index status_incidents_automatic_idx
  on private.status_incidents (created_at desc)
  where source = 'automatic';

alter table private.status_incident_updates
  alter column created_by drop not null;

comment on column private.status_incident_updates.created_by is
  'Conta da equipe que publicou. Null = atualização publicada pela automação (incidente automático). Nunca vai ao público.';

-- -----------------------------------------------------------------------------
-- 3. Regras comuns da automação
-- -----------------------------------------------------------------------------
create or replace function private.status_component_name(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'crm' then 'CRM'
    when 'login' then 'Login e contas'
    when 'leads_capture' then 'Landing pages e captação'
    when 'lead_routing' then 'Rodízio de leads'
    when 'notifications' then 'Avisos por e-mail e no celular'
    when 'integrations' then 'Portais e integrações'
    when 'caixa_catalog' then 'Imóveis da Caixa'
    when 'billing' then 'Assinaturas e pagamentos'
  end;
$$;

comment on function private.status_component_name(text) is
  'Nome público da parte (igual a STATUS_COMPONENTS em packages/core/src/status/public.ts).';

create or replace function private.status_impact_rank(p_impact text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_impact
    when 'none' then 0
    when 'minor' then 1
    when 'major' then 2
    when 'critical' then 3
  end;
$$;

comment on function private.status_impact_rank(text) is
  'Gravidade do impacto: nenhum 0, pequeno 1, grande 2, crítico 3 (null para desconhecido).';

create or replace function private.status_auto_qualifying_impact(
  p_level text,
  p_down_streak integer,
  p_impaired_streak integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_level = 'major_outage' and p_down_streak >= 3 then 'critical'
    when p_level = 'partial_outage' and p_down_streak >= 3 then 'major'
    when p_level in ('degraded_performance', 'partial_outage', 'major_outage')
      and p_impaired_streak >= 10 then 'minor'
  end;
$$;

comment on function private.status_auto_qualifying_impact(text, integer, integer) is
  'Impacto que a medição automática justifica agora (null = nenhum): instabilidade parcial ou fora do ar há 3 medições seguidas → grande ou crítico; lentidão ou pior há 10 → pequeno (igual a qualifyingAutoImpact no core).';

create or replace function private.status_auto_incident_title(p_keys text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when cardinality(p_keys) = 1 then 'Instabilidade em ' || private.status_component_name(p_keys[1])
    else 'Instabilidade em várias partes do sistema'
  end;
$$;

comment on function private.status_auto_incident_title(text[]) is
  'Título do incidente automático: "Instabilidade em <parte>" ou, com mais de uma parte, "Instabilidade em várias partes do sistema" (igual a automaticIncidentTitle no core).';

revoke all on function private.status_component_name(text) from public, anon, authenticated;
revoke all on function private.status_impact_rank(text) from public, anon, authenticated;
revoke all on function private.status_auto_qualifying_impact(text, integer, integer)
  from public, anon, authenticated;
revoke all on function private.status_auto_incident_title(text[]) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Medições seguidas por parte
-- -----------------------------------------------------------------------------
create table private.status_auto_tracker (
  component_key text primary key,
  level text,
  down_streak integer not null default 0,
  impaired_streak integer not null default 0,
  ok_streak integer not null default 0,
  calm_streak integer not null default 0,
  last_sample_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint status_auto_tracker_component_key_check
    check (component_key = any (private.status_component_keys())),
  constraint status_auto_tracker_level_check
    check (
      level is null
      or level in ('operational', 'degraded_performance', 'partial_outage', 'major_outage')
    ),
  constraint status_auto_tracker_streaks_check
    check (
      down_streak between 0 and 100000
      and impaired_streak between 0 and 100000
      and ok_streak between 0 and 100000
      and calm_streak between 0 and 100000
    )
);

comment on table private.status_auto_tracker is
  'Medições seguidas de cada parte para a automação de incidentes, contadas sobre o nível automático depois da histerese: down_streak (instabilidade parcial ou fora do ar), impaired_streak (qualquer coisa pior que operacional), ok_streak (operacional) e calm_streak (operacional ou lentidão). Minuto sem medição não conta; intervalo maior que 5 min recomeça a contagem. Só para a automação e o Console.';

alter table private.status_auto_tracker enable row level security;
revoke all on private.status_auto_tracker from public, anon, authenticated;

create or replace function private.status_auto_update_trackers(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into private.status_auto_tracker as t (
    component_key, level, down_streak, impaired_streak, ok_streak, calm_streak, last_sample_at
  )
  select
    s.component_key,
    s.level,
    case when s.level in ('partial_outage', 'major_outage') then 1 else 0 end,
    case when s.level <> 'operational' then 1 else 0 end,
    case when s.level = 'operational' then 1 else 0 end,
    case when s.level in ('operational', 'degraded_performance') then 1 else 0 end,
    p_now
  from (
    select distinct on (x.component_key) x.component_key, x.level
    from private.status_samples x
    where x.measured_at = p_now
      and x.level is not null
    order by x.component_key, x.id desc
  ) s
  on conflict (component_key) do update
  set level = excluded.level,
      down_streak = case
        when excluded.down_streak = 0 then 0
        when t.last_sample_at >= p_now - interval '5 minutes' then least(t.down_streak + 1, 100000)
        else 1
      end,
      impaired_streak = case
        when excluded.impaired_streak = 0 then 0
        when t.last_sample_at >= p_now - interval '5 minutes' then least(t.impaired_streak + 1, 100000)
        else 1
      end,
      ok_streak = case
        when excluded.ok_streak = 0 then 0
        when t.last_sample_at >= p_now - interval '5 minutes' then least(t.ok_streak + 1, 100000)
        else 1
      end,
      calm_streak = case
        when excluded.calm_streak = 0 then 0
        when t.last_sample_at >= p_now - interval '5 minutes' then least(t.calm_streak + 1, 100000)
        else 1
      end,
      last_sample_at = p_now,
      updated_at = now()
  where t.last_sample_at is null
     or t.last_sample_at < p_now;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

comment on function private.status_auto_update_trackers(timestamptz) is
  'Soma nas medições seguidas (private.status_auto_tracker) as amostras gravadas neste minuto (measured_at = p_now) que já têm nível confirmado. Idempotente: amostra do mesmo minuto não conta duas vezes. Intervalo de mais de 5 min desde a última medição recomeça a contagem (igual a advanceAutoStreaks no core).';

revoke all on function private.status_auto_update_trackers(timestamptz) from public, anon, authenticated;

create or replace function private.status_auto_keys_impact(p_keys text[], p_now timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case max(
    private.status_impact_rank(
      private.status_auto_qualifying_impact(t.level, t.down_streak, t.impaired_streak)
    )
  )
    when 3 then 'critical'
    when 2 then 'major'
    else 'minor'
  end
  from private.status_auto_tracker t
  where t.component_key = any (p_keys)
    and t.last_sample_at = p_now;
$$;

comment on function private.status_auto_keys_impact(text[], timestamptz) is
  'Maior impacto justificado pelas partes medidas neste minuto (pequeno quando nenhuma justifica mais).';

create or replace function private.status_component_covered(p_key text, p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from private.status_incidents i
    where i.resolved_at is null
      and p_key = any (i.component_keys)
      and (
        (i.kind = 'incident' and i.status <> 'resolved')
        or (
          i.kind = 'maintenance'
          and private.status_effective_status(i.kind, i.status, i.scheduled_for, i.scheduled_until, p_now)
            = 'in_progress'
        )
      )
  );
$$;

comment on function private.status_component_covered(text, timestamptz) is
  'A parte já está num incidente em aberto (da equipe ou automático, assumido ou não) ou em manutenção em andamento? Nesses casos a automação não abre outro incidente.';

create or replace function private.status_auto_daily_count(p_key text, p_day_start timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from private.status_incidents i
  where i.source = 'automatic'
    and i.created_at >= p_day_start
    and p_key = any (i.component_keys);
$$;

comment on function private.status_auto_daily_count(text, timestamptz) is
  'Incidentes automáticos criados desde o início do dia (São Paulo) que envolvem a parte.';

revoke all on function private.status_auto_keys_impact(text[], timestamptz) from public, anon, authenticated;
revoke all on function private.status_component_covered(text, timestamptz) from public, anon, authenticated;
revoke all on function private.status_auto_daily_count(text, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Fornecedores (só sinal interno)
-- -----------------------------------------------------------------------------
create table private.status_vendor_state (
  vendor_key text primary key,
  name text not null,
  status_url text not null,
  enabled boolean not null default true,
  request_id bigint,
  sent_at timestamptz,
  indicator text,
  description text,
  checked_at timestamptz,
  last_result text,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint status_vendor_state_key_check check (vendor_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint status_vendor_state_name_check
    check (char_length(name) between 2 and 60 and name !~ '[<>[:cntrl:]]'),
  constraint status_vendor_state_url_check
    check (status_url ~ '^https://[a-z0-9.-]+/api/v2/status\.json$'),
  constraint status_vendor_state_indicator_check
    check (indicator is null or indicator in ('none', 'minor', 'major', 'critical')),
  constraint status_vendor_state_description_check
    check (
      description is null
      or (char_length(description) between 1 and 120 and description !~ '[<>[:cntrl:]]')
    ),
  constraint status_vendor_state_last_result_check
    check (
      last_result is null
      or last_result in (
        'ok', 'sem_resposta', 'http_erro', 'tempo_esgotado', 'erro_conexao', 'resposta_invalida',
        'falha_ao_enviar'
      )
    )
);

comment on table private.status_vendor_state is
  'Situação pública dos fornecedores de infraestrutura (API de status oficial do Atlassian Statuspage, /api/v2/status.json, sem chave): só o indicador (none, minor, major, critical), a descrição curta do fornecedor (até 120 caracteres) e quando foi lida. Sem histórico: cada leitura sobrescreve e o indicador some depois de 1 dia sem leitura. Só sinal interno para o Console e para o texto do incidente automático (sem citar o nome); nunca muda a situação pública.';
comment on column private.status_vendor_state.indicator is
  'status.indicator do Statuspage: none (operacional), minor, major ou critical (incidente em andamento). Manutenção não entra no indicador.';

insert into private.status_vendor_state (vendor_key, name, status_url)
values
  ('supabase', 'Supabase', 'https://status.supabase.com/api/v2/status.json'),
  ('vercel', 'Vercel', 'https://www.vercel-status.com/api/v2/status.json');

alter table private.status_vendor_state enable row level security;
revoke all on private.status_vendor_state from public, anon, authenticated;

create or replace function private.status_read_vendor_responses(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor record;
  v_status_code integer;
  v_timed_out boolean;
  v_error text;
  v_content text;
  v_body jsonb;
  v_indicator text;
  v_description text;
  v_result text;
  v_read integer := 0;
begin
  for v_vendor in
    select s.vendor_key, s.request_id, s.sent_at
    from private.status_vendor_state s
    where s.request_id is not null
    order by s.vendor_key
    for update
  loop
    select r.status_code, r.timed_out, r.error_msg, r.content
      into v_status_code, v_timed_out, v_error, v_content
    from net._http_response r
    where r.id = v_vendor.request_id;

    if not found then
      if v_vendor.sent_at is null or v_vendor.sent_at < p_now - interval '4 minutes' then
        update private.status_vendor_state s
        set request_id = null,
            last_result = 'sem_resposta',
            last_attempt_at = p_now,
            updated_at = now()
        where s.vendor_key = v_vendor.vendor_key;
      end if;

      continue;
    end if;

    v_body := private.status_try_jsonb(v_content);
    v_indicator := v_body #>> '{status,indicator}';
    v_description := nullif(
      left(
        btrim(
          regexp_replace(
            regexp_replace(coalesce(v_body #>> '{status,description}', ''), '<[^>]*>', '', 'g'),
            '[<>[:cntrl:]]', '', 'g'
          )
        ),
        120
      ),
      ''
    );

    v_result := case
      when coalesce(v_timed_out, false) or coalesce(v_error, '') ilike '%timeout%' then 'tempo_esgotado'
      when v_status_code is null then 'erro_conexao'
      when v_status_code < 200 or v_status_code >= 300 then 'http_erro'
      when v_indicator is null or v_indicator not in ('none', 'minor', 'major', 'critical')
        then 'resposta_invalida'
      else 'ok'
    end;

    update private.status_vendor_state s
    set request_id = null,
        last_result = v_result,
        last_attempt_at = p_now,
        indicator = case when v_result = 'ok' then v_indicator else s.indicator end,
        description = case when v_result = 'ok' then v_description else s.description end,
        checked_at = case when v_result = 'ok' then p_now else s.checked_at end,
        updated_at = now()
    where s.vendor_key = v_vendor.vendor_key;

    v_read := v_read + 1;
  end loop;

  return v_read;
end;
$$;

comment on function private.status_read_vendor_responses(timestamptz) is
  'Lê as respostas pendentes dos fornecedores (net._http_response): 2xx com status.indicator válido grava indicador, descrição curta (sem tags, até 120 caracteres) e checked_at; qualquer outra coisa só registra o resultado e mantém a última leitura boa. Sem resposta em 4 min = sem_resposta.';

create or replace function private.status_send_vendor_probes(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor record;
  v_request_id bigint;
  v_sent integer := 0;
begin
  for v_vendor in
    select s.vendor_key, s.status_url
    from private.status_vendor_state s
    where s.enabled
      and s.request_id is null
    order by s.vendor_key
    for update
  loop
    begin
      v_request_id := net.http_get(
        url := v_vendor.status_url,
        params := '{}'::jsonb,
        headers := jsonb_build_object('Accept', 'application/json', 'User-Agent', 'status-publico-fornecedores'),
        timeout_milliseconds := 5000
      );

      update private.status_vendor_state s
      set request_id = v_request_id,
          sent_at = p_now,
          updated_at = now()
      where s.vendor_key = v_vendor.vendor_key;

      v_sent := v_sent + 1;
    exception
      when others then
        update private.status_vendor_state s
        set last_result = 'falha_ao_enviar',
            last_attempt_at = p_now,
            updated_at = now()
        where s.vendor_key = v_vendor.vendor_key;
    end;
  end loop;

  return v_sent;
end;
$$;

comment on function private.status_send_vendor_probes(timestamptz) is
  'Dispara um GET assíncrono (pg_net, timeout 5 s) no status.json de cada fornecedor ativo sem requisição pendente. Chamada pela rotina status-publico-medicoes nos minutos 2, 7, 12... (a cada 5 min).';

create or replace function private.status_vendor_issue_active(p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from private.status_vendor_state s
    where s.enabled
      and s.indicator in ('minor', 'major', 'critical')
      and s.checked_at >= p_now - interval '15 minutes'
  );
$$;

comment on function private.status_vendor_issue_active(timestamptz) is
  'Algum fornecedor com incidente em andamento, lido nos últimos 15 min? Usado só para acrescentar "possível relação com instabilidade em um fornecedor de infraestrutura" ao texto do incidente automático.';

revoke all on function private.status_read_vendor_responses(timestamptz) from public, anon, authenticated;
revoke all on function private.status_send_vendor_probes(timestamptz) from public, anon, authenticated;
revoke all on function private.status_vendor_issue_active(timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Aviso aos Donos por e-mail (fila)
-- -----------------------------------------------------------------------------
create table private.status_alerts (
  id bigint generated always as identity primary key,
  incident_id uuid not null references private.status_incidents (id) on delete cascade,
  kind text not null,
  impact text not null,
  created_at timestamptz not null default now(),
  last_pinged_at timestamptz,
  claimed_at timestamptz,
  attempts smallint not null default 0,
  emails_reserved smallint not null default 0,
  emails_sent smallint not null default 0,
  sent_at timestamptz,
  skipped_at timestamptz,
  skip_reason text,
  constraint status_alerts_kind_check check (kind in ('opened', 'resolved')),
  constraint status_alerts_impact_check check (impact in ('none', 'minor', 'major', 'critical')),
  constraint status_alerts_counts_check
    check (
      attempts between 0 and 10
      and emails_reserved between 0 and 10
      and emails_sent between 0 and 10
    ),
  constraint status_alerts_closed_check check (sent_at is null or skipped_at is null),
  constraint status_alerts_skip_reason_check
    check (
      (skipped_at is null) = (skip_reason is null)
      and (skip_reason is null or skip_reason in ('expirado', 'tentativas_esgotadas'))
    )
);

comment on table private.status_alerts is
  'Fila do aviso por e-mail aos Donos (PLATFORM_ADMIN_EMAILS, só no servidor) sobre incidente automático: opened (chegou a impacto grande ou crítico) e resolved (resolveu sozinho depois de um opened). Um aviso pendente cancela o oposto que ainda não saiu. Drenada por /api/cron/status-alerts (platform_status_claim_alerts/platform_status_settle_alert). Trava: 10 e-mails em 24 h no total; pendente expira em 6 h; até 3 tentativas. Enviados e expirados saem depois de 30 dias. Sem dado pessoal: os destinatários não ficam no banco.';
comment on column private.status_alerts.emails_reserved is
  'E-mails reservados na reserva (um por destinatário), contados na trava de 24 h enquanto o envio não confirma (até 15 min).';
comment on column private.status_alerts.emails_sent is
  'E-mails que a rota confirmou como enviados (contam na trava de 24 h).';

create index status_alerts_pending_idx
  on private.status_alerts (id)
  where sent_at is null and skipped_at is null;

create index status_alerts_incident_idx
  on private.status_alerts (incident_id, id desc);

create index status_alerts_sent_idx
  on private.status_alerts (sent_at)
  where sent_at is not null;

alter table private.status_alerts enable row level security;
revoke all on private.status_alerts from public, anon, authenticated;

create or replace function private.status_alert_daily_email_limit()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 10;
$$;

comment on function private.status_alert_daily_email_limit() is
  'Trava do aviso por e-mail da página de status: 10 e-mails em 24 h, somando todos os destinatários (igual a STATUS_ALERT_DAILY_EMAIL_LIMIT no core).';

create or replace function private.status_alert_emails_used(p_now timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(
    case
      when a.sent_at is not null then a.emails_sent
      else a.emails_reserved
    end
  ), 0)::integer
  from private.status_alerts a
  where a.sent_at > p_now - interval '24 hours'
     or (
       a.sent_at is null
       and a.skipped_at is null
       and a.claimed_at > p_now - interval '15 minutes'
     );
$$;

comment on function private.status_alert_emails_used(timestamptz) is
  'E-mails de aviso já usados na janela de 24 h: enviados confirmados mais os reservados há menos de 15 min.';

create or replace function private.status_enqueue_alert(
  p_incident_id uuid,
  p_kind text,
  p_impact text,
  p_now timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last private.status_alerts%rowtype;
begin
  select * into v_last
  from private.status_alerts a
  where a.incident_id = p_incident_id
    and a.skipped_at is null
  order by a.id desc
  limit 1
  for update;

  if p_kind = 'opened' then
    if p_impact not in ('major', 'critical') then
      return 'ignorado';
    end if;

    if found and v_last.kind = 'resolved' and v_last.sent_at is null and v_last.claimed_at is null then
      -- "Resolvido" que ainda não saiu perdeu o sentido; o "aberto" anterior vale.
      delete from private.status_alerts a where a.id = v_last.id;
      return 'cancelado';
    end if;

    if found and v_last.kind = 'opened' then
      return 'ignorado';
    end if;
  elsif p_kind = 'resolved' then
    if not found or v_last.kind <> 'opened' then
      return 'ignorado';
    end if;

    if v_last.sent_at is null and v_last.claimed_at is null then
      -- Abriu e resolveu antes de o aviso sair: nenhum dos dois é enviado.
      delete from private.status_alerts a where a.id = v_last.id;
      return 'cancelado';
    end if;
  else
    return 'ignorado';
  end if;

  insert into private.status_alerts (incident_id, kind, impact, created_at)
  values (p_incident_id, p_kind, p_impact, p_now);

  return 'enfileirado';
end;
$$;

comment on function private.status_enqueue_alert(uuid, text, text, timestamptz) is
  'Enfileira o aviso aos Donos alternando aberto/resolvido por incidente: opened só com impacto grande ou crítico e só se o último aviso não for opened; resolved só depois de um opened. Pendente ainda não reservado do tipo oposto é cancelado em vez de enfileirar. Devolve enfileirado, cancelado ou ignorado.';

create or replace function private.ping_status_alerts_webhook(p_now timestamptz default now())
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
    from private.status_alerts a
    where a.sent_at is null
      and a.skipped_at is null
      and a.attempts < 3
      and a.created_at >= p_now - interval '6 hours'
      and (a.claimed_at is null or a.claimed_at < p_now - interval '15 minutes')
  ) then
    return false;
  end if;

  -- No máximo uma chamada a cada 10 min, e nenhuma com a trava de e-mails cheia.
  if exists (
    select 1
    from private.status_alerts a
    where a.last_pinged_at > p_now - interval '10 minutes'
  ) or private.status_alert_emails_used(p_now) >= private.status_alert_daily_email_limit() then
    return false;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'status_alerts_webhook_url'
  limit 1;

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = 'status_alerts_webhook_secret'
  limit 1;

  if v_url is null or v_secret is null or v_url !~* '^https://[^[:space:]<>"]+$' then
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

  update private.status_alerts a
  set last_pinged_at = p_now
  where a.sent_at is null
    and a.skipped_at is null;

  return true;
exception
  when others then
    -- Webhook é conveniência: falha nunca derruba a rotina.
    return false;
end;
$$;

comment on function private.ping_status_alerts_webhook(timestamptz) is
  'Chama /api/cron/status-alerts (POST com Authorization: Bearer) quando há aviso pendente, no máximo a cada 10 min e nunca com a trava de 10 e-mails em 24 h cheia. Sem os segredos status_alerts_webhook_url (https) e status_alerts_webhook_secret (mesmo valor de CRON_SECRET) no Vault, não faz nada e o aviso expira em 6 h.';

revoke all on function private.status_alert_daily_email_limit() from public, anon, authenticated;
revoke all on function private.status_alert_emails_used(timestamptz) from public, anon, authenticated;
revoke all on function private.status_enqueue_alert(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function private.ping_status_alerts_webhook(timestamptz) from public, anon, authenticated;

create or replace function public.platform_status_claim_alerts(
  p_server_key text,
  p_recipient_count integer,
  p_limit integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_recipients constant integer := least(greatest(coalesce(p_recipient_count, 0), 0), 10);
  v_limit constant integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_max constant integer := private.status_alert_daily_email_limit();
  v_used integer;
  v_alert record;
  v_items jsonb := '[]'::jsonb;
begin
  perform private.check_platform_server_key(p_server_key);

  -- Uma reserva por vez: duas chamadas juntas não furam a trava de e-mails.
  perform pg_advisory_xact_lock(hashtextextended('private.status_alerts.claim', 0));

  update private.status_alerts a
  set skipped_at = v_now,
      skip_reason = case when a.attempts >= 3 then 'tentativas_esgotadas' else 'expirado' end,
      claimed_at = null
  where a.sent_at is null
    and a.skipped_at is null
    and (a.claimed_at is null or a.claimed_at < v_now - interval '15 minutes')
    and (a.attempts >= 3 or a.created_at < v_now - interval '6 hours');

  v_used := private.status_alert_emails_used(v_now);

  if v_recipients > 0 then
    for v_alert in
      select a.id
      from private.status_alerts a
      where a.sent_at is null
        and a.skipped_at is null
        and a.attempts < 3
        and (a.claimed_at is null or a.claimed_at < v_now - interval '15 minutes')
      order by a.id
      limit v_limit
      for update of a skip locked
    loop
      exit when v_used + v_recipients > v_max;

      update private.status_alerts a
      set claimed_at = v_now,
          attempts = a.attempts + 1,
          emails_reserved = v_recipients
      where a.id = v_alert.id;

      v_used := v_used + v_recipients;

      select v_items || jsonb_build_array(jsonb_build_object(
        'id', a.id,
        'kind', a.kind,
        'impact', a.impact,
        'incident_id', i.id,
        'title', i.title,
        'component_keys', to_jsonb(i.component_keys),
        'started_at', i.started_at,
        'resolved_at', i.resolved_at,
        'created_at', a.created_at
      ))
      into v_items
      from private.status_alerts a
      join private.status_incidents i on i.id = a.incident_id
      where a.id = v_alert.id;
    end loop;
  end if;

  return jsonb_build_object('alerts', v_items, 'emails_used_24h', v_used, 'emails_limit', v_max);
end;
$$;

comment on function public.platform_status_claim_alerts(text, integer, integer) is
  'Rota /api/cron/status-alerts (chave publishable + PLATFORM_SERVER_KEY, sem sessão): expira avisos pendentes com mais de 6 h ou 3 tentativas e reserva os pendentes (até 10 por chamada) enquanto couberem na trava de 10 e-mails em 24 h, contando p_recipient_count e-mails por aviso (0 = não reserva nada). Todo aviso devolvido precisa voltar em platform_status_settle_alert. Devolve { alerts: [{ id, kind, impact, incident_id, title, component_keys, started_at, resolved_at, created_at }], emails_used_24h, emails_limit }. Erros: 42501 chave.';

create or replace function public.platform_status_settle_alert(
  p_server_key text,
  p_alert_id bigint,
  p_outcome text,
  p_emails_sent integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_platform_server_key(p_server_key);

  if p_outcome = 'sent' then
    update private.status_alerts a
    set sent_at = now(),
        emails_sent = least(greatest(coalesce(p_emails_sent, 1), 1), greatest(a.emails_reserved, 1), 10)
    where a.id = p_alert_id
      and a.sent_at is null
      and a.skipped_at is null
      and a.claimed_at is not null;
  elsif p_outcome = 'failed' then
    update private.status_alerts a
    set claimed_at = null
    where a.id = p_alert_id
      and a.sent_at is null
      and a.skipped_at is null
      and a.claimed_at is not null;
  elsif p_outcome = 'released' then
    update private.status_alerts a
    set claimed_at = null,
        attempts = greatest(a.attempts - 1, 0)
    where a.id = p_alert_id
      and a.sent_at is null
      and a.skipped_at is null
      and a.claimed_at is not null;
  else
    raise exception 'Resultado inválido.' using errcode = '22023';
  end if;

  return found;
end;
$$;

comment on function public.platform_status_settle_alert(text, bigint, text, integer) is
  'Rota /api/cron/status-alerts (chave publishable + PLATFORM_SERVER_KEY): confirma um aviso reservado. sent = saiu para p_emails_sent destinatários (conta na trava); failed = nenhum saiu, volta para a fila (conta tentativa, até 3); released = nem foi tentado (não conta tentativa). Devolve se havia reserva. Erros: 42501 chave; 22023 resultado inválido.';

revoke all on function public.platform_status_claim_alerts(text, integer, integer) from public, anon, authenticated;
revoke all on function public.platform_status_settle_alert(text, bigint, text, integer)
  from public, anon, authenticated;
grant execute on function public.platform_status_claim_alerts(text, integer, integer) to anon;
grant execute on function public.platform_status_settle_alert(text, bigint, text, integer) to anon;

-- -----------------------------------------------------------------------------
-- 7. Automação dos incidentes
-- -----------------------------------------------------------------------------
create table private.status_automation_state (
  singleton boolean primary key default true,
  last_run_at timestamptz,
  last_result jsonb,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint status_automation_state_singleton_check check (singleton),
  constraint status_automation_state_error_check
    check (last_error is null or last_error ~ '^[0-9A-Z]{5}$'),
  constraint status_automation_state_result_check
    check (
      last_result is null
      or (jsonb_typeof(last_result) = 'object' and octet_length(last_result::text) <= 2048)
    )
);

comment on table private.status_automation_state is
  'Última passada da automação de incidentes (quando, contagens e o código SQLSTATE do último erro, sem mensagem). Só para o Console.';

insert into private.status_automation_state (singleton) values (true);

alter table private.status_automation_state enable row level security;
revoke all on private.status_automation_state from public, anon, authenticated;

create or replace function private.status_incident_audit_data(p private.status_incidents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'tipo', p.kind,
    'origem', p.source,
    'titulo', private.platform_audit_mask_text(p.title),
    'impacto', p.impact,
    'estado', p.status,
    'partes', to_jsonb(p.component_keys),
    'inicio', p.started_at,
    'fim', p.resolved_at,
    'inicio_previsto', p.scheduled_for,
    'fim_previsto', p.scheduled_until,
    'automacao', case
      when p.source <> 'automatic' then null
      when p.automation_stopped_reason is null then 'ativa'
      else p.automation_stopped_reason
    end
  );
$$;

comment on function private.status_incident_audit_data(private.status_incidents) is
  'Antes/depois de um incidente ou manutenção para o registro do console (título mascarado por private.platform_audit_mask_text), com a origem e o estado da automação.';

create or replace function private.status_auto_incidents_step(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_recovery constant integer := 5;
  c_calm constant integer := 10;
  c_monitoring constant interval := interval '15 minutes';
  c_reopen constant interval := interval '30 minutes';
  c_daily constant integer := 6;
  c_max_updates constant integer := 30;
  c_recent constant interval := interval '10 minutes';
  v_day_start constant timestamptz :=
    ((p_now at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
  v_suffix text;
  v_inc private.status_incidents%rowtype;
  v_row private.status_incidents%rowtype;
  v_target private.status_incidents%rowtype;
  v_measured integer;
  v_target_rank integer;
  v_all_ok boolean;
  v_all_operational boolean;
  v_all_calm boolean;
  v_relapse boolean;
  v_updates integer;
  v_new_status text;
  v_new_impact text;
  v_message text;
  v_action text;
  v_keys text[];
  v_new_keys text[];
  v_impact text;
  v_changed integer := 0;
  v_resolved integer := 0;
  v_paused integer := 0;
  v_opened integer := 0;
  v_reopened integer := 0;
  v_over_limit integer := 0;
begin
  perform private.status_auto_update_trackers(p_now);

  v_suffix := case
    when private.status_vendor_issue_active(p_now)
      then ' Há possível relação com instabilidade em um fornecedor de infraestrutura.'
    else ''
  end;

  -- ---------------------------------------------------------------------------
  -- A. Incidentes automáticos em aberto que a automação ainda conduz
  -- ---------------------------------------------------------------------------
  for v_inc in
    select *
    from private.status_incidents i
    where i.source = 'automatic'
      and i.resolved_at is null
      and i.automation_stopped_at is null
    order by i.started_at, i.id
    for update
  loop
    select
      count(*) filter (where t.last_sample_at >= p_now - c_recent),
      coalesce(max(
        private.status_impact_rank(
          private.status_auto_qualifying_impact(t.level, t.down_streak, t.impaired_streak)
        )
      ) filter (where t.last_sample_at >= p_now - c_recent), 0),
      coalesce(bool_and(t.ok_streak >= c_recovery) filter (where t.last_sample_at >= p_now - c_recent), false),
      coalesce(bool_and(t.level = 'operational') filter (where t.last_sample_at >= p_now - c_recent), false),
      coalesce(bool_and(t.calm_streak >= c_calm) filter (where t.last_sample_at >= p_now - c_recent), false),
      coalesce(bool_or(t.down_streak >= 1 or t.impaired_streak >= 3) filter (where t.last_sample_at >= p_now - c_recent), false)
    into v_measured, v_target_rank, v_all_ok, v_all_operational, v_all_calm, v_relapse
    from unnest(v_inc.component_keys) as k(key)
    left join private.status_auto_tracker t on t.component_key = k.key;

    v_new_status := null;
    v_new_impact := v_inc.impact;
    v_message := null;
    v_action := 'incidente.atualizar_automatico';

    if v_target_rank > private.status_impact_rank(v_inc.impact) then
      v_new_impact := case v_target_rank when 1 then 'minor' when 2 then 'major' else 'critical' end;
      v_new_status := 'investigating';
      v_message := 'A instabilidade piorou. Estamos verificando.' || v_suffix;
    elsif v_inc.status = 'monitoring' and v_relapse then
      v_new_status := 'investigating';
      v_message := 'A instabilidade voltou. Estamos verificando.' || v_suffix;
    elsif v_inc.status <> 'monitoring' and v_measured > 0 and v_all_ok then
      v_new_status := 'monitoring';
      v_message := 'O funcionamento voltou ao normal. Seguimos acompanhando.';
    elsif v_inc.status = 'monitoring'
      and v_measured > 0
      and v_all_operational
      and v_inc.auto_monitoring_since <= p_now - c_monitoring then
      v_new_status := 'resolved';
      v_message := 'Resolvido. O funcionamento está normal.';
      v_action := 'incidente.resolver_automatico';
    elsif v_inc.status <> 'monitoring'
      and v_inc.impact in ('major', 'critical')
      and v_measured > 0
      and v_all_calm
      and not v_all_operational
      and v_target_rank <= 1 then
      v_new_impact := 'minor';
      v_new_status := 'investigating';
      v_message := 'A instabilidade diminuiu, mas ainda há lentidão. Seguimos verificando.';
    end if;

    continue when v_message is null;

    select count(*) into v_updates
    from private.status_incident_updates u
    where u.incident_id = v_inc.id;

    if v_updates >= c_max_updates and v_new_status <> 'resolved' then
      update private.status_incidents i
      set automation_stopped_at = p_now,
          automation_stopped_reason = 'limite_de_atualizacoes',
          auto_monitoring_since = null
      where i.id = v_inc.id
      returning * into v_row;

      perform private.record_system_audit_event(
        'incidente.pausar_automacao', 'incidente', v_inc.id::text,
        private.status_incident_audit_data(v_inc), private.status_incident_audit_data(v_row)
      );

      v_paused := v_paused + 1;
      continue;
    end if;

    update private.status_incidents i
    set status = v_new_status,
        impact = v_new_impact,
        resolved_at = case when v_new_status = 'resolved' then greatest(p_now, i.started_at) end,
        auto_monitoring_since = case when v_new_status = 'monitoring' then p_now end
    where i.id = v_inc.id
    returning * into v_row;

    insert into private.status_incident_updates (incident_id, status, message, created_by, created_at)
    values (v_inc.id, v_new_status, v_message, null, p_now);

    perform private.record_system_audit_event(
      v_action, 'incidente', v_inc.id::text,
      private.status_incident_audit_data(v_inc),
      private.status_incident_audit_data(v_row) || jsonb_build_object('mensagem', v_message)
    );

    if v_new_status = 'resolved' then
      perform private.status_enqueue_alert(v_inc.id, 'resolved', v_row.impact, p_now);
      v_resolved := v_resolved + 1;
    elsif private.status_impact_rank(v_new_impact) > private.status_impact_rank(v_inc.impact) then
      perform private.status_enqueue_alert(v_inc.id, 'opened', v_new_impact, p_now);
    end if;

    v_changed := v_changed + 1;
  end loop;

  -- ---------------------------------------------------------------------------
  -- B. Partes que qualificam neste minuto e não estão cobertas
  -- ---------------------------------------------------------------------------
  select coalesce(array_agg(t.component_key order by k.ord), '{}'::text[])
  into v_keys
  from private.status_auto_tracker t
  join unnest(private.status_component_keys()) with ordinality as k(key, ord)
    on k.key = t.component_key
  where t.last_sample_at = p_now
    and private.status_auto_qualifying_impact(t.level, t.down_streak, t.impaired_streak) is not null
    and not private.status_component_covered(t.component_key, p_now);

  if cardinality(v_keys) > 0 then
    -- Reabre o último automático resolvido há até 30 min com alguma dessas
    -- partes; ou, com o limite do dia atingido, o último do dia.
    select i.* into v_target
    from private.status_incidents i
    where i.source = 'automatic'
      and i.resolved_at is not null
      and i.automation_stopped_at is null
      and i.component_keys && v_keys
      and (
        i.resolved_at >= p_now - c_reopen
        or (
          i.created_at >= v_day_start
          and exists (
            select 1
            from unnest(v_keys) as q(key)
            where q.key = any (i.component_keys)
              and private.status_auto_daily_count(q.key, v_day_start) >= c_daily
          )
        )
      )
    order by i.resolved_at desc, i.id
    limit 1
    for update;

    if found then
      v_new_keys := private.status_normalize_component_keys(v_target.component_keys || v_keys);
      v_impact := private.status_auto_keys_impact(v_keys, p_now);
      v_message := 'A instabilidade voltou. Estamos verificando.' || v_suffix;

      update private.status_incidents i
      set status = 'investigating',
          resolved_at = null,
          auto_monitoring_since = null,
          component_keys = v_new_keys,
          impact = v_impact,
          title = private.status_auto_incident_title(v_new_keys)
      where i.id = v_target.id
      returning * into v_row;

      insert into private.status_incident_updates (incident_id, status, message, created_by, created_at)
      values (v_row.id, 'investigating', v_message, null, p_now);

      perform private.record_system_audit_event(
        'incidente.reabrir_automatico', 'incidente', v_row.id::text,
        private.status_incident_audit_data(v_target),
        private.status_incident_audit_data(v_row) || jsonb_build_object('mensagem', v_message)
      );

      perform private.status_enqueue_alert(v_row.id, 'opened', v_impact, p_now);
      v_reopened := v_reopened + 1;
    else
      select coalesce(array_agg(q.key order by q.ord), '{}'::text[])
      into v_new_keys
      from unnest(v_keys) with ordinality as q(key, ord)
      where private.status_auto_daily_count(q.key, v_day_start) < c_daily;

      v_over_limit := cardinality(v_keys) - cardinality(v_new_keys);

      if cardinality(v_new_keys) > 0 then
        v_impact := private.status_auto_keys_impact(v_new_keys, p_now);
        v_message := 'Detectamos automaticamente uma instabilidade '
          || case when cardinality(v_new_keys) = 1 then 'nesta parte' else 'nestas partes' end
          || ' do sistema. Estamos verificando.' || v_suffix;

        insert into private.status_incidents (
          kind, title, impact, status, component_keys, started_at, created_by, created_at, source
        )
        values (
          'incident',
          private.status_auto_incident_title(v_new_keys),
          v_impact,
          'investigating',
          v_new_keys,
          p_now,
          null,
          p_now,
          'automatic'
        )
        returning * into v_row;

        insert into private.status_incident_updates (incident_id, status, message, created_by, created_at)
        values (v_row.id, 'investigating', v_message, null, p_now);

        perform private.record_system_audit_event(
          'incidente.abrir_automatico', 'incidente', v_row.id::text,
          null,
          private.status_incident_audit_data(v_row) || jsonb_build_object('mensagem', v_message)
        );

        perform private.status_enqueue_alert(v_row.id, 'opened', v_impact, p_now);
        v_opened := v_opened + 1;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'abertos', v_opened,
    'reabertos', v_reopened,
    'atualizados', v_changed,
    'resolvidos', v_resolved,
    'pausados', v_paused,
    'fora_do_limite', v_over_limit
  );
end;
$$;

comment on function private.status_auto_incidents_step(timestamptz) is
  'Passo da rotina status-publico-medicoes que conduz os incidentes automáticos (sem IA, regras fixas). '
  'Abre: instabilidade parcial ou fora do ar por 3 medições seguidas (impacto grande ou crítico) ou lentidão ou pior por 10 (impacto pequeno), só com medição neste minuto e se a parte não estiver num incidente em aberto nem em manutenção em andamento; partes do mesmo minuto entram no mesmo incidente. '
  'Conduz (enquanto a equipe não assumir): piora → atualização com o impacto novo; 5 medições seguidas operacionais → monitorando; mais 15 min estável → resolvido; voltou a cair monitorando → investigando; lentidão por 10 medições depois de queda → impacto pequeno. '
  'Reabre o mesmo incidente se cair até 30 min depois de resolvido; com 6 automáticos na parte no dia, reabre o último do dia em vez de criar outro. Com 30 atualizações, pausa e pede a equipe. '
  'Texto sem detalhe interno; com fornecedor em incidente, acrescenta "possível relação com instabilidade em um fornecedor de infraestrutura". Grava tudo no registro do console como sistema e enfileira o aviso aos Donos (impacto grande/crítico e resolução).';

revoke all on function private.status_auto_incidents_step(timestamptz) from public, anon, authenticated;

create or replace function private.purge_status_measurements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_samples integer;
  v_days integer;
  v_alerts integer;
begin
  delete from private.status_samples s
  where s.id in (
    select x.id
    from private.status_samples x
    where x.measured_at < now() - interval '8 days'
    order by x.measured_at
    limit 50000
  );

  get diagnostics v_samples = row_count;

  delete from private.status_daily_summaries d
  where d.day < (now() at time zone 'America/Sao_Paulo')::date - 400;

  get diagnostics v_days = row_count;

  -- Aviso que nunca foi reservado (ex.: webhook sem os segredos) também expira.
  update private.status_alerts a
  set skipped_at = now(),
      skip_reason = case when a.attempts >= 3 then 'tentativas_esgotadas' else 'expirado' end,
      claimed_at = null
  where a.sent_at is null
    and a.skipped_at is null
    and (a.claimed_at is null or a.claimed_at < now() - interval '15 minutes')
    and (a.attempts >= 3 or a.created_at < now() - interval '6 hours');

  delete from private.status_alerts a
  where coalesce(a.sent_at, a.skipped_at) < now() - interval '30 days';

  get diagnostics v_alerts = row_count;

  update private.status_vendor_state s
  set indicator = null,
      description = null,
      updated_at = now()
  where s.checked_at < now() - interval '1 day'
    and (s.indicator is not null or s.description is not null);

  return v_samples + v_days + v_alerts;
end;
$$;

comment on function private.purge_status_measurements() is
  'Retenção da página de status: apaga amostras com mais de 8 dias (até 50.000 por vez), resumos diários com mais de 400 dias e avisos por e-mail enviados ou expirados há mais de 30 dias, expira avisos pendentes com mais de 6 h e esquece o indicador de fornecedor sem leitura há 1 dia. Chamada de hora em hora pela rotina status-publico-medicoes (minuto 11). Devolve quantas linhas apagou.';

create or replace function private.run_status_measurements()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_auto jsonb;
  v_error text;
  v_vendors_read integer := 0;
  v_vendors_sent integer := 0;
  v_purged integer := 0;
  v_sent boolean;
  v_alerts_ping boolean := false;
begin
  v_result := private.status_collect_measurements(now());

  begin
    v_vendors_read := private.status_read_vendor_responses(now());
  exception
    when others then
      v_vendors_read := -1;
  end;

  begin
    v_auto := private.status_auto_incidents_step(now());
  exception
    when others then
      v_auto := null;
      v_error := sqlstate;
  end;

  update private.status_automation_state s
  set last_run_at = now(),
      last_result = coalesce(v_auto, s.last_result),
      last_error = coalesce(v_error, s.last_error),
      last_error_at = case when v_error is not null then now() else s.last_error_at end,
      updated_at = now()
  where s.singleton;

  if extract(minute from now())::integer = 11 then
    v_purged := private.purge_status_measurements();
  end if;

  if extract(minute from now())::integer % 5 = 2 then
    begin
      v_vendors_sent := private.status_send_vendor_probes(now());
    exception
      when others then
        v_vendors_sent := -1;
    end;
  end if;

  v_sent := private.status_send_probe();
  v_alerts_ping := private.ping_status_alerts_webhook(now());

  return v_result || jsonb_build_object(
    'purged', v_purged,
    'probe_sent', v_sent,
    'automatic', coalesce(v_auto, jsonb_build_object('erro', v_error)),
    'vendors_read', v_vendors_read,
    'vendors_sent', v_vendors_sent,
    'alerts_webhook', v_alerts_ping
  );
end;
$$;

comment on function private.run_status_measurements() is
  'Rotina agendada (pg_cron, job status-publico-medicoes, a cada minuto): 1) lê a resposta da sonda do minuto anterior e os sinais do banco e grava as amostras (private.status_collect_measurements); 2) lê as respostas dos fornecedores (private.status_read_vendor_responses); 3) conduz os incidentes automáticos (private.status_auto_incidents_step; erro fica só em private.status_automation_state e não derruba as medições); 4) no minuto 11 de cada hora, aplica a retenção; 5) a cada 5 min (minutos 2, 7, 12...), consulta os fornecedores; 6) dispara a próxima sonda; 7) chama o webhook dos avisos por e-mail se houver aviso pendente. As requisições do pg_net só saem depois do COMMIT.';

-- -----------------------------------------------------------------------------
-- 8. RPC pública: origem do incidente
-- -----------------------------------------------------------------------------
create or replace function private.status_public_incident(
  p_incident private.status_incidents,
  p_now timestamptz
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_incident.id,
    'kind', p_incident.kind,
    'title', p_incident.title,
    'impact', p_incident.impact,
    'status', e.status,
    'componentKeys', to_jsonb(p_incident.component_keys),
    'startedAt', p_incident.started_at,
    'resolvedAt', case
      when e.status in ('resolved', 'completed')
        then coalesce(p_incident.resolved_at, p_incident.scheduled_until)
    end,
    'scheduledFor', p_incident.scheduled_for,
    'scheduledUntil', p_incident.scheduled_until,
    'source', p_incident.source,
    'updates', coalesce((
      select jsonb_agg(
        jsonb_build_object('status', u.status, 'message', u.message, 'createdAt', u.created_at)
        order by u.created_at desc, u.id desc
      )
      from private.status_incident_updates u
      where u.incident_id = p_incident.id
    ), '[]'::jsonb)
  )
  from (
    select private.status_effective_status(
      p_incident.kind, p_incident.status, p_incident.scheduled_for, p_incident.scheduled_until, p_now
    ) as status
  ) e;
$$;

comment on function private.status_public_incident(private.status_incidents, timestamptz) is
  'Incidente no formato PublicIncident (camelCase), com estado efetivo, origem (team ou automatic) e atualizações da mais recente para a mais antiga. Sem quem criou nem quem assumiu.';

-- -----------------------------------------------------------------------------
-- 9. RPCs do Console
-- -----------------------------------------------------------------------------
create or replace function public.platform_status_list_incidents(
  p_server_key text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_result jsonb;
begin
  perform private.check_platform_server_key(p_server_key);

  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id), '[]'::jsonb)
  into v_result
  from (
    select
      i.id,
      i.created_at,
      jsonb_build_object(
        'id', i.id,
        'kind', i.kind,
        'source', i.source,
        'title', i.title,
        'impact', i.impact,
        'status', i.status,
        'effective_status', e.status,
        'component_keys', to_jsonb(i.component_keys),
        'started_at', i.started_at,
        'resolved_at', case
          when e.status in ('resolved', 'completed') then coalesce(i.resolved_at, i.scheduled_until)
        end,
        'scheduled_for', i.scheduled_for,
        'scheduled_until', i.scheduled_until,
        'created_at', i.created_at,
        'updated_at', i.updated_at,
        'automation_stopped_at', i.automation_stopped_at,
        'automation_stopped_reason', i.automation_stopped_reason,
        'auto_monitoring_since', i.auto_monitoring_since,
        'waiting_measurement', (
          i.source = 'automatic'
          and i.resolved_at is null
          and i.automation_stopped_at is null
          and not exists (
            select 1
            from private.status_auto_tracker t
            where t.component_key = any (i.component_keys)
              and t.last_sample_at >= v_now - interval '10 minutes'
          )
        ),
        'updates', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', u.id,
              'status', u.status,
              'message', u.message,
              'created_at', u.created_at,
              'automatic', u.created_by is null
            )
            order by u.created_at desc, u.id desc
          )
          from private.status_incident_updates u
          where u.incident_id = i.id
        ), '[]'::jsonb)
      ) as item
    from private.status_incidents i
    cross join lateral (
      select private.status_effective_status(
        i.kind, i.status, i.scheduled_for, i.scheduled_until, v_now
      ) as status
    ) e
    order by i.created_at desc, i.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) x;

  return v_result;
end;
$$;

comment on function public.platform_status_list_incidents(text, integer) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): incidentes e manutenções do mais novo para o mais antigo (até 200), com origem (team/automatic), estado gravado e efetivo, datas, estado da automação (assumido pela equipe ou pausado pelo limite; waiting_measurement = automático sem medição recente em nenhuma parte) e atualizações (automatic = publicada pela automação).';

create or replace function public.platform_status_overview(
  p_server_key text,
  p_samples_per_component integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := least(greatest(coalesce(p_samples_per_component, 15), 1), 60);
  v_now constant timestamptz := now();
  v_probe jsonb;
  v_components jsonb;
  v_automation jsonb;
  v_vendors jsonb;
  v_alerts jsonb;
begin
  perform private.check_platform_server_key(p_server_key);

  select jsonb_build_object(
    'url_configured', exists (
      select 1
      from vault.decrypted_secrets ds
      where ds.name = 'status_probe_url'
        and ds.decrypted_secret ~* '^https://[^[:space:]<>"]+$'
    ),
    'job_active', (select j.active from cron.job j where j.jobname = 'status-publico-medicoes' limit 1),
    'last_sent_at', p.sent_at,
    'last_checked_at', p.last_checked_at,
    'last_result', p.last_result,
    'last_http_status', p.last_http_status,
    'last_duration_ms', p.last_duration_ms
  )
  into v_probe
  from private.status_probe_state p
  where p.singleton;

  select jsonb_agg(
    jsonb_build_object(
      'key', k.key,
      'source', case when k.key = 'billing' then 'manual' else 'automatic' end,
      'automatic_level', st.level,
      'candidate_level', st.candidate_level,
      'candidate_count', coalesce(st.candidate_count, 0),
      'last_measured_at', st.last_measured_at,
      'last_detail', st.last_detail,
      'changed_at', st.changed_at,
      'recent', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'measured_at', s.measured_at,
            'measured_level', s.measured_level,
            'level', s.level,
            'detail', s.detail
          )
          order by s.measured_at desc, s.id desc
        )
        from (
          select s2.*
          from private.status_samples s2
          where s2.component_key = k.key
          order by s2.measured_at desc, s2.id desc
          limit v_limit
        ) s
      ), '[]'::jsonb)
    )
    order by k.ord
  )
  into v_components
  from unnest(private.status_component_keys()) with ordinality as k(key, ord)
  left join private.status_component_state st on st.component_key = k.key;

  select jsonb_build_object(
    'last_run_at', a.last_run_at,
    'last_error', a.last_error,
    'last_error_at', a.last_error_at
  )
  into v_automation
  from private.status_automation_state a
  where a.singleton;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'key', s.vendor_key,
      'name', s.name,
      'enabled', s.enabled,
      'indicator', s.indicator,
      'checked_at', s.checked_at,
      'last_result', s.last_result,
      'last_attempt_at', s.last_attempt_at
    )
    order by s.name
  ), '[]'::jsonb)
  into v_vendors
  from private.status_vendor_state s;

  select jsonb_build_object(
    'webhook_configured', (
      select count(distinct vs.name) = 2
      from vault.secrets vs
      where vs.name in ('status_alerts_webhook_url', 'status_alerts_webhook_secret')
    ),
    'pending', (
      select count(*)
      from private.status_alerts a
      where a.sent_at is null
        and a.skipped_at is null
    ),
    'expired_last_7d', (
      select count(*)
      from private.status_alerts a
      where a.skipped_at > v_now - interval '7 days'
    ),
    'emails_used_24h', private.status_alert_emails_used(v_now),
    'emails_limit', private.status_alert_daily_email_limit(),
    'last_sent_at', (select max(a.sent_at) from private.status_alerts a)
  )
  into v_alerts;

  return jsonb_build_object(
    'generated_at', v_now,
    'probe', coalesce(v_probe, jsonb_build_object(
      'url_configured', false, 'job_active', null, 'last_sent_at', null, 'last_checked_at', null,
      'last_result', null, 'last_http_status', null, 'last_duration_ms', null
    )),
    'components', coalesce(v_components, '[]'::jsonb),
    'automation', coalesce(v_automation, jsonb_build_object(
      'last_run_at', null, 'last_error', null, 'last_error_at', null
    )),
    'vendors', v_vendors,
    'alerts', v_alerts
  );
end;
$$;

comment on function public.platform_status_overview(text, integer) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): estado da sonda HTTP (se status_probe_url existe no Vault — nunca o valor —, se a rotina está ativa, último resultado, HTTP e duração); por parte, o nível automático com histerese, o candidato e as últimas medições (até 60); a última passada da automação de incidentes (e o código do último erro); os fornecedores (indicador e leitura); e a fila do aviso por e-mail (segredos do webhook existem?, pendentes, expirados em 7 dias, e-mails usados em 24 h e a trava). Só para o Console.';

create or replace function public.platform_status_add_update(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_incident_id uuid,
  p_status text,
  p_message text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_before private.status_incidents%rowtype;
  v_row private.status_incidents%rowtype;
  v_update_id bigint;
  v_closing boolean;
  v_takes_over boolean;
begin
  perform private.check_platform_server_key(p_server_key);

  select * into v_before
  from private.status_incidents i
  where i.id = p_incident_id
  for update;

  if not found then
    raise exception 'Registro não encontrado.' using errcode = 'P0002';
  end if;

  if v_before.status in ('resolved', 'completed') then
    raise exception 'Registro encerrado não aceita atualização.' using errcode = '22023';
  end if;

  if (v_before.kind = 'incident' and p_status not in ('investigating', 'identified', 'monitoring', 'resolved'))
     or (v_before.kind = 'maintenance' and p_status not in ('scheduled', 'in_progress', 'completed'))
     or p_status is null
     or (v_before.kind = 'maintenance' and v_before.status = 'in_progress' and p_status = 'scheduled') then
    raise exception 'Estado inválido para este registro.' using errcode = '22023';
  end if;

  v_closing := p_status in ('resolved', 'completed');
  v_takes_over := v_before.source = 'automatic'
    and v_before.automation_stopped_reason is distinct from 'equipe';

  update private.status_incidents i
  set status = p_status,
      started_at = case
        when i.kind = 'maintenance' and p_status in ('in_progress', 'completed')
          then least(i.started_at, v_now)
        else i.started_at
      end,
      resolved_at = case when v_closing then v_now end,
      -- A equipe publicou: a automação não mexe mais neste incidente.
      automation_stopped_at = case when v_takes_over then v_now else i.automation_stopped_at end,
      automation_stopped_reason = case when v_takes_over then 'equipe' else i.automation_stopped_reason end,
      automation_stopped_by = case when v_takes_over then p_actor_user_id else i.automation_stopped_by end,
      auto_monitoring_since = null
  where i.id = p_incident_id
  returning * into v_row;

  insert into private.status_incident_updates (incident_id, status, message, created_by)
  values (
    p_incident_id,
    p_status,
    btrim(replace(coalesce(p_message, ''), E'\r\n', E'\n'), E' \n'),
    p_actor_user_id
  )
  returning id into v_update_id;

  perform private.record_platform_audit_event(
    p_actor_user_id,
    p_actor_email,
    case
      when v_before.kind = 'incident' and v_closing then 'incidente.resolver'
      when v_before.kind = 'incident' then 'incidente.atualizar'
      when v_closing then 'manutencao.concluir'
      else 'manutencao.atualizar'
    end,
    case when v_before.kind = 'incident' then 'incidente' else 'manutencao' end,
    p_incident_id::text,
    null,
    null,
    jsonb_build_object('estado', v_before.status),
    jsonb_build_object(
      'estado', v_row.status,
      'mensagem', private.platform_audit_mask_text(
        btrim(replace(coalesce(p_message, ''), E'\r\n', E'\n'), E' \n')
      )
    ) || case when v_takes_over then jsonb_build_object('assumiu_automatico', true) else '{}'::jsonb end
  );

  return v_update_id;
end;
$$;

comment on function public.platform_status_add_update(text, uuid, text, uuid, text, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: publica uma atualização (estado + mensagem) e muda o estado do registro; resolvido/concluída encerra (resolved_at). Manutenção que começa antes do previsto passa a ter o início real. Em incidente automático, a equipe assume (a automação para de mexer nele). Grava incidente.atualizar/incidente.resolver/manutencao.atualizar/manutencao.concluir no registro do console. Erros: 42501 chave ou conta; P0002 inexistente; 22023 encerrado ou estado inválido para o tipo; 23514 mensagem fora das regras.';

create or replace function public.platform_status_edit_incident(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_incident_id uuid,
  p_title text,
  p_impact text,
  p_component_keys text[],
  p_scheduled_for timestamptz default null,
  p_scheduled_until timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_before private.status_incidents%rowtype;
  v_row private.status_incidents%rowtype;
  v_keys text[] := private.status_normalize_component_keys(p_component_keys);
  v_title text := btrim(coalesce(p_title, ''));
  v_for timestamptz;
  v_until timestamptz;
  v_window_changed boolean;
  v_takes_over boolean;
begin
  perform private.check_platform_server_key(p_server_key);

  select * into v_before
  from private.status_incidents i
  where i.id = p_incident_id
  for update;

  if not found then
    raise exception 'Registro não encontrado.' using errcode = 'P0002';
  end if;

  -- Encerrado: só corrige o título; impacto e partes contam a história.
  if v_before.status in ('resolved', 'completed')
     and (p_impact is distinct from v_before.impact or v_keys is distinct from v_before.component_keys) then
    raise exception 'Registro encerrado só permite corrigir o título.' using errcode = '22023';
  end if;

  v_for := coalesce(p_scheduled_for, v_before.scheduled_for);
  v_until := coalesce(p_scheduled_until, v_before.scheduled_until);
  v_window_changed := v_for is distinct from v_before.scheduled_for
    or v_until is distinct from v_before.scheduled_until;

  if v_window_changed then
    if v_before.kind <> 'maintenance' or v_before.status <> 'scheduled' then
      raise exception 'Só manutenção ainda agendada muda de horário.' using errcode = '22023';
    end if;

    perform private.status_check_maintenance_window(v_for, v_until, v_now);
  end if;

  if v_title = v_before.title
     and p_impact is not distinct from v_before.impact
     and v_keys is not distinct from v_before.component_keys
     and not v_window_changed then
    return v_before.id;
  end if;

  v_takes_over := v_before.source = 'automatic'
    and v_before.automation_stopped_reason is distinct from 'equipe';

  update private.status_incidents i
  set title = v_title,
      impact = p_impact,
      component_keys = v_keys,
      scheduled_for = v_for,
      scheduled_until = v_until,
      started_at = case when v_window_changed then v_for else i.started_at end,
      -- A equipe editou: a automação não mexe mais neste incidente.
      automation_stopped_at = case when v_takes_over then v_now else i.automation_stopped_at end,
      automation_stopped_reason = case when v_takes_over then 'equipe' else i.automation_stopped_reason end,
      automation_stopped_by = case when v_takes_over then p_actor_user_id else i.automation_stopped_by end,
      auto_monitoring_since = case when v_takes_over then null else i.auto_monitoring_since end
  where i.id = p_incident_id
  returning * into v_row;

  perform private.record_platform_audit_event(
    p_actor_user_id,
    p_actor_email,
    case when v_before.kind = 'incident' then 'incidente.editar' else 'manutencao.editar' end,
    case when v_before.kind = 'incident' then 'incidente' else 'manutencao' end,
    p_incident_id::text,
    null,
    null,
    private.status_incident_audit_data(v_before),
    private.status_incident_audit_data(v_row)
  );

  return v_row.id;
end;
$$;

comment on function public.platform_status_edit_incident(text, uuid, text, uuid, text, text, text[], timestamptz, timestamptz) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: edita título, impacto e partes afetadas (encerrado: só o título) e, em manutenção ainda agendada, a janela prevista. Sem mudança, não grava nada; com mudança, grava incidente.editar/manutencao.editar no registro do console e, em incidente automático, a equipe assume. Erros: 42501 chave ou conta; P0002 inexistente; 22023 encerrado ou janela inválida; 23514 campo fora das regras.';

create or replace function public.platform_status_take_over(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_incident_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before private.status_incidents%rowtype;
  v_row private.status_incidents%rowtype;
begin
  perform private.check_platform_server_key(p_server_key);

  select * into v_before
  from private.status_incidents i
  where i.id = p_incident_id
  for update;

  if not found then
    raise exception 'Registro não encontrado.' using errcode = 'P0002';
  end if;

  if v_before.source <> 'automatic' then
    raise exception 'Só incidente automático pode ser assumido.' using errcode = '22023';
  end if;

  if v_before.automation_stopped_reason = 'equipe' then
    return v_before.id;
  end if;

  update private.status_incidents i
  set automation_stopped_at = now(),
      automation_stopped_reason = 'equipe',
      automation_stopped_by = p_actor_user_id,
      auto_monitoring_since = null
  where i.id = p_incident_id
  returning * into v_row;

  perform private.record_platform_audit_event(
    p_actor_user_id,
    p_actor_email,
    'incidente.assumir',
    'incidente',
    p_incident_id::text,
    null,
    null,
    private.status_incident_audit_data(v_before),
    private.status_incident_audit_data(v_row)
  );

  return v_row.id;
end;
$$;

comment on function public.platform_status_take_over(text, uuid, text, uuid) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: marca um incidente automático como assumido pela equipe (a automação não abre, atualiza, resolve nem reabre mais esse incidente) e grava incidente.assumir no registro do console. Já assumido: não grava nada. Erros: 42501 chave, conta ou Somente leitura; P0002 inexistente; 22023 não é automático.';

revoke all on function public.platform_status_take_over(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.platform_status_take_over(text, uuid, text, uuid) to anon;
