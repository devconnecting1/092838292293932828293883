-- =============================================================================
-- Página de status pública (/status): incidentes, medições automáticas e RPCs
-- =============================================================================
-- Página estilo githubstatus.com para os clientes verem se o sistema está
-- funcionando, com 90 dias de histórico e os incidentes escritos pela equipe.
-- A "Saúde do sistema" do Console é a fonte dos sinais automáticos, mas nada
-- interno vai ao público: só nome da parte, situação, disponibilidade por dia e
-- os textos da equipe. Contrato dos dados: packages/core/src/status/public.ts.
--
--  1. Regras comuns: partes do sistema, gravidade dos níveis, impacto →
--     nível, situação efetiva da manutenção pelo relógio.
--  2. private.status_incidents e private.status_incident_updates (só de
--     acréscimo): incidentes e manutenções escritos no Console.
--  3. Medições automáticas: private.status_samples (8 dias),
--     private.status_daily_summaries (400 dias, dia de São Paulo),
--     private.status_component_state (histerese de 2 medições) e
--     private.status_probe_state (sonda HTTP ao app via pg_net).
--  4. Rotina status-publico-medicoes (pg_cron, a cada minuto): lê a resposta
--     da sonda do minuto anterior e os sinais do banco, grava as amostras e
--     dispara a próxima sonda. URL do app no segredo status_probe_url do
--     Vault; sem ele, não sonda e não marca nada como fora do ar.
--  5. public.get_public_status() (anon e authenticated, sem chave) e
--     public.status_ping() (consulta mínima da sonda).
--  6. RPCs do Console com p_server_key (só anon), com registro na mesma
--     transação: listar, criar, publicar atualização, editar e medições.
--
-- pg_net é assíncrono: a requisição só sai depois do COMMIT e a resposta fica
-- em net._http_response por 6 h (pg_net.ttl); timeout padrão 2 s, aqui 5 s
-- (https://supabase.com/docs/guides/database/extensions/pg_net). O health do
-- Auth exige a chave publishable no cabeçalho apikey
-- (https://supabase.com/docs/guides/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR):
-- para não guardar chave no banco, quem consulta o Auth é o próprio app, dentro
-- de /api/status/ping.

-- -----------------------------------------------------------------------------
-- 1. Regras comuns
-- -----------------------------------------------------------------------------
create or replace function private.status_component_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'crm', 'login', 'leads_capture', 'lead_routing', 'notifications', 'integrations',
    'caixa_catalog', 'billing'
  ]::text[];
$$;

comment on function private.status_component_keys() is
  'Partes do sistema mostradas na página de status, na ordem da página (igual a STATUS_COMPONENT_KEYS em packages/core/src/status/public.ts).';

create or replace function private.status_level_rank(p_level text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_level
    when 'operational' then 0
    when 'under_maintenance' then 1
    when 'degraded_performance' then 2
    when 'partial_outage' then 3
    when 'major_outage' then 4
  end;
$$;

comment on function private.status_level_rank(text) is
  'Gravidade do nível para escolher o pior: operacional 0, manutenção 1, lentidão 2, instabilidade parcial 3, fora do ar 4. Manutenção só vence operacional (igual a STATUS_LEVEL_RANK no core).';

create or replace function private.status_worse_level(p_a text, p_b text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_a is null then p_b
    when p_b is null then p_a
    when private.status_level_rank(p_b) > private.status_level_rank(p_a) then p_b
    else p_a
  end;
$$;

comment on function private.status_worse_level(text, text) is
  'O pior de dois níveis (null é ignorado; empate fica com o primeiro).';

create or replace function private.status_impact_level(p_impact text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_impact
    when 'none' then 'operational'
    when 'minor' then 'degraded_performance'
    when 'major' then 'partial_outage'
    when 'critical' then 'major_outage'
  end;
$$;

comment on function private.status_impact_level(text) is
  'Nível que um incidente em aberto impõe às partes afetadas: nenhum → operacional, pequeno → lentidão, grande → instabilidade parcial, crítico → fora do ar.';

create or replace function private.status_component_keys_valid(p_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_keys is not null
    and cardinality(p_keys) between 1 and 8
    and array_position(p_keys, null) is null
    and p_keys <@ private.status_component_keys()
    and cardinality(p_keys) = (select count(distinct k.key) from unnest(p_keys) as k(key));
$$;

comment on function private.status_component_keys_valid(text[]) is
  'Lista de partes afetadas válida: de 1 a 8 chaves conhecidas, sem repetição e sem null.';

create or replace function private.status_normalize_component_keys(p_keys text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(k.key order by k.ord), '{}'::text[])
  from unnest(private.status_component_keys()) with ordinality as k(key, ord)
  where k.key = any (coalesce(p_keys, '{}'::text[]));
$$;

comment on function private.status_normalize_component_keys(text[]) is
  'Partes afetadas sem repetição e na ordem da página (chave desconhecida some; a gravação recusa lista vazia).';

-- Manutenção agendada anda sozinha pelo relógio quando a equipe não mexe:
-- "em andamento" do início previsto até o fim previsto e "concluída" depois.
-- Marcada "em andamento" pela equipe, só fecha quando a equipe concluir.
create or replace function private.status_effective_status(
  p_kind text,
  p_status text,
  p_scheduled_for timestamptz,
  p_scheduled_until timestamptz,
  p_now timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind <> 'maintenance' or p_status <> 'scheduled' then p_status
    when p_scheduled_until <= p_now then 'completed'
    when p_scheduled_for <= p_now then 'in_progress'
    else 'scheduled'
  end;
$$;

comment on function private.status_effective_status(text, text, timestamptz, timestamptz, timestamptz) is
  'Estado que o público vê: manutenção "agendada" vira "em andamento" no início previsto e "concluída" no fim previsto; os demais estados valem como gravados (igual a effectiveIncidentStatus no core).';

revoke all on function private.status_component_keys() from public, anon, authenticated;
revoke all on function private.status_level_rank(text) from public, anon, authenticated;
revoke all on function private.status_worse_level(text, text) from public, anon, authenticated;
revoke all on function private.status_impact_level(text) from public, anon, authenticated;
revoke all on function private.status_component_keys_valid(text[]) from public, anon, authenticated;
revoke all on function private.status_normalize_component_keys(text[]) from public, anon, authenticated;
revoke all on function private.status_effective_status(text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Incidentes e manutenções
-- -----------------------------------------------------------------------------
create table private.status_incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  impact text not null,
  status text not null,
  component_keys text[] not null,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  scheduled_for timestamptz,
  scheduled_until timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint status_incidents_kind_check
    check (kind in ('incident', 'maintenance')),
  constraint status_incidents_title_check
    check (
      char_length(title) between 3 and 120
      and title = btrim(title)
      and title !~ '[<>[:cntrl:]]'
    ),
  constraint status_incidents_impact_check
    check (impact in ('none', 'minor', 'major', 'critical')),
  constraint status_incidents_status_check
    check (
      (kind = 'incident' and status in ('investigating', 'identified', 'monitoring', 'resolved'))
      or (kind = 'maintenance' and status in ('scheduled', 'in_progress', 'completed'))
    ),
  constraint status_incidents_component_keys_check
    check (private.status_component_keys_valid(component_keys)),
  constraint status_incidents_resolved_check
    check (
      (status in ('resolved', 'completed')) = (resolved_at is not null)
      and (resolved_at is null or resolved_at >= started_at)
    ),
  constraint status_incidents_schedule_check
    check (
      (kind = 'incident' and scheduled_for is null and scheduled_until is null)
      or (
        kind = 'maintenance'
        and scheduled_for is not null
        and scheduled_until > scheduled_for
        and scheduled_until <= scheduled_for + interval '72 hours'
      )
    )
);

comment on table private.status_incidents is
  'Incidentes e manutenções da página de status pública, escritos pela equipe no Console (/plataforma/status). Texto puro (sem HTML). Público vê título, impacto, estado, partes afetadas, datas e as atualizações — nunca quem criou. Escrita só pelas RPCs platform_status_* (chave do servidor), que gravam o registro do console na mesma transação. Sem acesso direto (RLS sem política).';
comment on column private.status_incidents.kind is
  'incident (algo quebrou) ou maintenance (parada planejada, com janela prevista).';
comment on column private.status_incidents.impact is
  'none, minor, major ou critical. Enquanto o incidente está em aberto, impõe às partes afetadas: operacional, lentidão, instabilidade parcial ou fora do ar.';
comment on column private.status_incidents.status is
  'Incidente: investigating, identified, monitoring, resolved. Manutenção: scheduled, in_progress, completed. Estado gravado; o público vê o efetivo (private.status_effective_status).';
comment on column private.status_incidents.component_keys is
  'Partes afetadas (1 a 8, sem repetição, na ordem da página).';
comment on column private.status_incidents.started_at is
  'Incidente: quando foi aberto. Manutenção: início previsto; se a equipe começar antes, vira o horário real.';
comment on column private.status_incidents.resolved_at is
  'Quando a equipe resolveu (incidente) ou concluiu (manutenção). Manutenção concluída pelo relógio fica null aqui e o público vê o fim previsto.';
comment on column private.status_incidents.scheduled_for is
  'Manutenção: início previsto (null em incidente).';
comment on column private.status_incidents.scheduled_until is
  'Manutenção: fim previsto, até 72 h depois do início (null em incidente).';
comment on column private.status_incidents.created_by is
  'Conta da equipe que criou (sem chave estrangeira; o e-mail fica só no registro do console). Nunca vai ao público.';

create index status_incidents_started_idx
  on private.status_incidents (started_at desc);

create index status_incidents_open_idx
  on private.status_incidents (kind, scheduled_for)
  where resolved_at is null;

create index status_incidents_resolved_idx
  on private.status_incidents (resolved_at desc)
  where resolved_at is not null;

create trigger status_incidents_set_updated_at
  before update on private.status_incidents
  for each row execute function private.set_updated_at();

alter table private.status_incidents enable row level security;
revoke all on private.status_incidents from public, anon, authenticated;

create table private.status_incident_updates (
  id bigint generated always as identity primary key,
  incident_id uuid not null references private.status_incidents (id) on delete restrict,
  status text not null,
  message text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint status_incident_updates_status_check
    check (
      status in (
        'investigating', 'identified', 'monitoring', 'resolved', 'scheduled', 'in_progress',
        'completed'
      )
    ),
  constraint status_incident_updates_message_check
    check (
      char_length(message) between 3 and 2000
      and message = btrim(message, E' \n')
      and replace(message, E'\n', '') !~ '[<>[:cntrl:]]'
    )
);

comment on table private.status_incident_updates is
  'Atualizações publicadas num incidente ou manutenção (estado + mensagem em texto puro; quebra de linha permitida). Só de acréscimo: UPDATE, DELETE e TRUNCATE são recusados por gatilho. Escrita só pelas RPCs platform_status_create_incident e platform_status_add_update.';

create index status_incident_updates_incident_idx
  on private.status_incident_updates (incident_id, created_at desc, id desc);

alter table private.status_incident_updates enable row level security;
revoke all on private.status_incident_updates from public, anon, authenticated;

create or replace function private.status_incident_updates_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'As atualizações de incidente só aceitam novas linhas.' using errcode = '42501';
end;
$$;

comment on function private.status_incident_updates_append_only() is
  'Gatilho que torna private.status_incident_updates só de acréscimo (recusa UPDATE, DELETE e TRUNCATE).';

revoke all on function private.status_incident_updates_append_only() from public, anon, authenticated;

create trigger status_incident_updates_append_only_rows
  before update or delete on private.status_incident_updates
  for each row execute function private.status_incident_updates_append_only();

create trigger status_incident_updates_append_only_truncate
  before truncate on private.status_incident_updates
  for each statement execute function private.status_incident_updates_append_only();

-- -----------------------------------------------------------------------------
-- 3. Medições automáticas
-- -----------------------------------------------------------------------------
create table private.status_samples (
  id bigint generated always as identity primary key,
  component_key text not null,
  measured_at timestamptz not null default now(),
  measured_level text not null,
  level text,
  detail text,
  constraint status_samples_component_key_check
    check (component_key = any (private.status_component_keys())),
  constraint status_samples_measured_level_check
    check (measured_level in ('operational', 'degraded_performance', 'partial_outage', 'major_outage')),
  constraint status_samples_level_check
    check (
      level is null
      or level in ('operational', 'degraded_performance', 'partial_outage', 'major_outage')
    ),
  constraint status_samples_detail_check
    check (detail is null or detail ~ '^[a-z][a-z0-9_]{1,39}$')
);

comment on table private.status_samples is
  'Medições automáticas da página de status, uma por parte por minuto. measured_level = o que a medição viu; level = nível automático depois da histerese (null antes do primeiro nível confirmado); detail = código curto interno (ex.: http_503, fila_atrasada), só para o Console. Retenção curta: 8 dias (private.purge_status_measurements). Nunca vai ao público.';

create index status_samples_component_idx
  on private.status_samples (component_key, measured_at desc);

create index status_samples_measured_at_idx
  on private.status_samples (measured_at);

alter table private.status_samples enable row level security;
revoke all on private.status_samples from public, anon, authenticated;

create table private.status_daily_summaries (
  component_key text not null,
  day date not null,
  good_samples integer not null default 0,
  total_samples integer not null default 0,
  worst_level text not null default 'operational',
  updated_at timestamptz not null default now(),
  constraint status_daily_summaries_pkey primary key (component_key, day),
  constraint status_daily_summaries_component_key_check
    check (component_key = any (private.status_component_keys())),
  constraint status_daily_summaries_counts_check
    check (good_samples >= 0 and total_samples >= good_samples),
  constraint status_daily_summaries_worst_level_check
    check (worst_level in ('operational', 'degraded_performance', 'partial_outage', 'major_outage'))
);

comment on table private.status_daily_summaries is
  'Resumo diário por parte (dia do calendário de São Paulo): medições no ar (operacional ou lentidão) ÷ total = disponibilidade do dia, e o pior nível automático do dia. Conta o nível depois da histerese e ignora as medições feitas durante manutenção em andamento da parte. Retenção: 400 dias. A página mostra 90.';

create index status_daily_summaries_day_idx
  on private.status_daily_summaries (day);

alter table private.status_daily_summaries enable row level security;
revoke all on private.status_daily_summaries from public, anon, authenticated;

create table private.status_component_state (
  component_key text primary key,
  level text,
  candidate_level text,
  candidate_count smallint not null default 0,
  last_measured_level text,
  last_measured_at timestamptz,
  last_detail text,
  changed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint status_component_state_component_key_check
    check (component_key = any (private.status_component_keys())),
  constraint status_component_state_levels_check
    check (
      (level is null or level in ('operational', 'degraded_performance', 'partial_outage', 'major_outage'))
      and (
        candidate_level is null
        or candidate_level in ('operational', 'degraded_performance', 'partial_outage', 'major_outage')
      )
      and (
        last_measured_level is null
        or last_measured_level in ('operational', 'degraded_performance', 'partial_outage', 'major_outage')
      )
    ),
  constraint status_component_state_candidate_count_check
    check (candidate_count between 0 and 10),
  constraint status_component_state_detail_check
    check (last_detail is null or last_detail ~ '^[a-z][a-z0-9_]{1,39}$')
);

comment on table private.status_component_state is
  'Nível automático atual de cada parte com histerese: level só muda depois de 2 medições seguidas iguais e diferentes dele (candidate_level/candidate_count), para a página não piscar. Medição mais velha que 10 minutos não vale no público (sem medição = operacional, nunca vermelho).';

alter table private.status_component_state enable row level security;
revoke all on private.status_component_state from public, anon, authenticated;

create table private.status_probe_state (
  singleton boolean primary key default true,
  request_id bigint,
  sent_at timestamptz,
  last_checked_at timestamptz,
  last_result text,
  last_http_status integer,
  last_duration_ms integer,
  updated_at timestamptz not null default now(),
  constraint status_probe_state_singleton_check check (singleton),
  constraint status_probe_state_last_result_check
    check (
      last_result is null
      or last_result in (
        'ok', 'lento', 'http_erro', 'http_configuracao', 'tempo_esgotado', 'erro_conexao',
        'resposta_invalida', 'sem_resposta', 'sem_url', 'falha_ao_enviar'
      )
    )
);

comment on table private.status_probe_state is
  'Sonda HTTP ao app (/api/status/ping) feita pelo pg_net: request_id da requisição pendente (resposta lida no minuto seguinte em net._http_response) e o último resultado, só para o Console.';

insert into private.status_probe_state (singleton) values (true);

alter table private.status_probe_state enable row level security;
revoke all on private.status_probe_state from public, anon, authenticated;

-- Grava uma medição com histerese e soma no resumo do dia.
create or replace function private.status_record_sample(
  p_component_key text,
  p_measured_level text,
  p_detail text,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state private.status_component_state%rowtype;
  v_level text;
  v_candidate text;
  v_count integer;
  v_changed timestamptz;
  v_day date := (p_now at time zone 'America/Sao_Paulo')::date;
begin
  insert into private.status_component_state (component_key)
  values (p_component_key)
  on conflict (component_key) do nothing;

  select * into v_state
  from private.status_component_state s
  where s.component_key = p_component_key
  for update;

  v_level := v_state.level;
  v_changed := v_state.changed_at;

  if p_measured_level = v_state.level then
    v_candidate := null;
    v_count := 0;
  else
    v_count := case
      when p_measured_level = v_state.candidate_level then v_state.candidate_count + 1
      else 1
    end;

    if v_count >= 2 then
      v_level := p_measured_level;
      v_candidate := null;
      v_count := 0;
      v_changed := p_now;
    else
      v_candidate := p_measured_level;
    end if;
  end if;

  update private.status_component_state s
  set level = v_level,
      candidate_level = v_candidate,
      candidate_count = v_count,
      last_measured_level = p_measured_level,
      last_measured_at = p_now,
      last_detail = p_detail,
      changed_at = v_changed,
      updated_at = now()
  where s.component_key = p_component_key;

  insert into private.status_samples (component_key, measured_at, measured_level, level, detail)
  values (p_component_key, p_now, p_measured_level, v_level, p_detail);

  -- Parada planejada não conta contra a disponibilidade.
  if v_level is not null and not exists (
    select 1
    from private.status_incidents i
    where i.resolved_at is null
      and i.kind = 'maintenance'
      and p_component_key = any (i.component_keys)
      and private.status_effective_status(i.kind, i.status, i.scheduled_for, i.scheduled_until, p_now)
        = 'in_progress'
  ) then
    insert into private.status_daily_summaries as s (
      component_key, day, good_samples, total_samples, worst_level
    )
    values (
      p_component_key,
      v_day,
      case when v_level in ('operational', 'degraded_performance') then 1 else 0 end,
      1,
      v_level
    )
    on conflict (component_key, day) do update
    set good_samples = s.good_samples + excluded.good_samples,
        total_samples = s.total_samples + 1,
        worst_level = private.status_worse_level(s.worst_level, excluded.worst_level),
        updated_at = now();
  end if;

  return v_level;
end;
$$;

comment on function private.status_record_sample(text, text, text, timestamptz) is
  'Grava uma medição automática: histerese (o nível só muda depois de 2 medições seguidas iguais e diferentes do atual), amostra em private.status_samples e soma no resumo do dia de São Paulo — só com nível já confirmado e fora de manutenção em andamento da parte. Devolve o nível automático depois da medição.';

revoke all on function private.status_record_sample(text, text, text, timestamptz) from public, anon, authenticated;

create or replace function private.status_try_jsonb(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or char_length(p_text) > 4096 then
    return null;
  end if;

  return p_text::jsonb;
exception
  when others then
    return null;
end;
$$;

comment on function private.status_try_jsonb(text) is
  'Converte o corpo da resposta da sonda em JSON (até 4 KB); null se não for JSON.';

revoke all on function private.status_try_jsonb(text) from public, anon, authenticated;

create or replace function private.status_collect_measurements(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe private.status_probe_state%rowtype;
  v_status_code integer;
  v_timed_out boolean;
  v_error text;
  v_content text;
  v_created timestamptz;
  v_body jsonb;
  v_duration integer;
  v_result text;
  v_app_level text;
  v_app_detail text;
  v_login_level text;
  v_login_detail text;
  v_recorded integer := 0;
  v_job record;
  v_last_start timestamptz;
  v_finished integer;
  v_failed integer;
  v_level text;
  v_detail text;
  v_lead_oldest timestamptz;
  v_visit_oldest timestamptz;
  v_has_lead_hook boolean;
  v_has_visit_hook boolean;
  v_ok integer;
  v_bad integer;
  v_stuck boolean;
  v_synced timestamptz;
begin
  -- ---------------------------------------------------------------------------
  -- crm, login e leads_capture: resposta da sonda HTTP do minuto anterior
  -- ---------------------------------------------------------------------------
  select * into v_probe
  from private.status_probe_state p
  where p.singleton
  for update;

  if found and v_probe.request_id is not null then
    select r.status_code, r.timed_out, r.error_msg, r.content, r.created
      into v_status_code, v_timed_out, v_error, v_content, v_created
    from net._http_response r
    where r.id = v_probe.request_id;

    if not found then
      -- Resposta não chegou (worker do pg_net parado ou atrasado): não é culpa
      -- do app, então não vira medição.
      v_result := 'sem_resposta';
    else
      v_duration := greatest(0, round(extract(epoch from (v_created - v_probe.sent_at)) * 1000))::integer;
      v_body := private.status_try_jsonb(v_content);

      if coalesce(v_timed_out, false) or coalesce(v_error, '') ilike '%timeout%' then
        v_result := 'tempo_esgotado';
        v_app_level := 'major_outage';
        v_app_detail := 'tempo_esgotado';
      elsif v_status_code is null then
        v_result := 'erro_conexao';
        v_app_level := 'major_outage';
        v_app_detail := 'erro_conexao';
      elsif v_status_code >= 500 then
        v_result := 'http_erro';
        v_app_level := 'major_outage';
        v_app_detail := case
          when v_body ->> 'database' = 'false' then 'banco_fora'
          else 'http_' || v_status_code
        end;
      elsif v_status_code < 200 or v_status_code >= 300 then
        -- 3xx/4xx: endereço errado ou protegido. Problema de configuração, não
        -- queda: não vira medição (aparece só no Console).
        v_result := 'http_configuracao';
      elsif jsonb_typeof(v_body -> 'ok') is distinct from 'boolean' then
        v_result := 'resposta_invalida';
      elsif (v_body ->> 'ok')::boolean is not true then
        v_result := 'http_erro';
        v_app_level := 'major_outage';
        v_app_detail := 'banco_fora';
      elsif v_duration > 3000 then
        v_result := 'lento';
        v_app_level := 'degraded_performance';
        v_app_detail := 'lento';
      else
        v_result := 'ok';
        v_app_level := 'operational';
        v_app_detail := 'ok';
      end if;

      if v_app_level is not null then
        v_login_level := v_app_level;
        v_login_detail := v_app_detail;

        if v_app_level <> 'major_outage' and v_body ->> 'auth' = 'false' then
          v_login_level := 'major_outage';
          v_login_detail := 'auth_fora';
        end if;

        perform private.status_record_sample('crm', v_app_level, v_app_detail, p_now);
        perform private.status_record_sample('leads_capture', v_app_level, v_app_detail, p_now);
        perform private.status_record_sample('login', v_login_level, v_login_detail, p_now);
        v_recorded := v_recorded + 3;
      end if;
    end if;

    update private.status_probe_state p
    set request_id = null,
        last_checked_at = p_now,
        last_result = v_result,
        last_http_status = v_status_code,
        last_duration_ms = v_duration,
        updated_at = now()
    where p.singleton;
  end if;

  -- ---------------------------------------------------------------------------
  -- lead_routing: últimas execuções do job rodizio-de-leads
  -- ---------------------------------------------------------------------------
  begin
    select j.jobid, j.active into v_job
    from cron.job j
    where j.jobname = 'rodizio-de-leads'
    limit 1;

    -- Job ausente ou desligado é configuração (Saúde do sistema), não queda.
    if found and v_job.active then
      select d.start_time into v_last_start
      from cron.job_run_details d
      where d.jobid = v_job.jobid
      order by d.runid desc
      limit 1;

      if v_last_start is null or v_last_start < p_now - interval '10 minutes' then
        v_level := 'major_outage';
        v_detail := 'sem_execucao';
      else
        select count(*), count(*) filter (where x.status = 'failed')
          into v_finished, v_failed
        from (
          select d.status
          from cron.job_run_details d
          where d.jobid = v_job.jobid
            and d.status in ('succeeded', 'failed')
            and d.start_time > p_now - interval '15 minutes'
          order by d.runid desc
          limit 5
        ) x;

        v_level := case
          when v_failed = 0 then 'operational'
          when v_failed <= 2 then 'degraded_performance'
          when v_failed <= 4 then 'partial_outage'
          else 'major_outage'
        end;
        v_detail := case when v_failed = 0 then 'ok' else 'falhas_recentes' end;
      end if;

      perform private.status_record_sample('lead_routing', v_level, v_detail, p_now);
      v_recorded := v_recorded + 1;
    end if;
  exception
    when others then
      null;
  end;

  -- ---------------------------------------------------------------------------
  -- notifications: idade do aviso pendente mais antigo
  -- ---------------------------------------------------------------------------
  begin
    -- Sem o webhook no Vault a fila só anda na rotina diária da Vercel: atraso
    -- esperado, então esse lado não é medido.
    v_has_lead_hook := (
      select count(distinct s.name) = 2
      from vault.secrets s
      where s.name in ('lead_alerts_webhook_url', 'lead_alerts_webhook_secret')
    );
    v_has_visit_hook := (
      select count(distinct s.name) = 2
      from vault.secrets s
      where s.name in ('visit_reminders_webhook_url', 'visit_reminders_webhook_secret')
    );

    if v_has_lead_hook or v_has_visit_hook then
      v_level := 'operational';

      if v_has_lead_hook then
        select min(n.created_at) into v_lead_oldest
        from private.lead_notifications n
        where n.sent_at is null
          and n.attempts < 5;

        if v_lead_oldest < p_now - interval '180 minutes' then
          v_level := private.status_worse_level(v_level, 'partial_outage');
        elsif v_lead_oldest < p_now - interval '60 minutes' then
          v_level := private.status_worse_level(v_level, 'degraded_performance');
        end if;
      end if;

      if v_has_visit_hook then
        select min(n.created_at) into v_visit_oldest
        from private.visit_reminder_notifications n
        where n.sent_at is null
          and n.attempts < 5
          and n.starts_at > p_now;

        if v_visit_oldest < p_now - interval '90 minutes' then
          v_level := private.status_worse_level(v_level, 'partial_outage');
        elsif v_visit_oldest < p_now - interval '30 minutes' then
          v_level := private.status_worse_level(v_level, 'degraded_performance');
        end if;
      end if;

      v_detail := case v_level
        when 'operational' then 'ok'
        when 'degraded_performance' then 'fila_atrasada'
        else 'fila_muito_atrasada'
      end;

      perform private.status_record_sample('notifications', v_level, v_detail, p_now);
      v_recorded := v_recorded + 1;
    end if;
  exception
    when others then
      null;
  end;

  -- ---------------------------------------------------------------------------
  -- integrations: entregas de portais na última hora
  -- ---------------------------------------------------------------------------
  begin
    select
      count(*) filter (where d.status = 'accepted'),
      count(*) filter (where d.status = 'failed')
      into v_ok, v_bad
    from public.lead_integration_deliveries d
    where d.received_at > p_now - interval '60 minutes';

    v_stuck := exists (
      select 1
      from public.lead_integration_deliveries d
      where d.status = 'pending'
        and d.received_at < p_now - interval '60 minutes'
        and d.received_at > p_now - interval '24 hours'
    );

    if v_bad >= 3 and v_bad * 2 >= v_ok + v_bad then
      v_level := 'partial_outage';
      v_detail := 'muitas_falhas';
    elsif v_bad >= 1 and v_bad * 10 >= v_ok + v_bad then
      v_level := 'degraded_performance';
      v_detail := 'falhas_em_proporcao';
    elsif v_stuck then
      v_level := 'degraded_performance';
      v_detail := 'entregas_paradas';
    else
      v_level := 'operational';
      v_detail := 'ok';
    end if;

    perform private.status_record_sample('integrations', v_level, v_detail, p_now);
    v_recorded := v_recorded + 1;
  exception
    when others then
      null;
  end;

  -- ---------------------------------------------------------------------------
  -- caixa_catalog: idade da última carga (nunca "fora do ar")
  -- ---------------------------------------------------------------------------
  begin
    select c.sincronizado_em into v_synced
    from public.caixa_catalog_status c
    limit 1;

    if v_synced is not null then
      if v_synced < p_now - interval '48 hours' then
        v_level := 'degraded_performance';
        v_detail := 'catalogo_desatualizado';
      else
        v_level := 'operational';
        v_detail := 'ok';
      end if;

      perform private.status_record_sample('caixa_catalog', v_level, v_detail, p_now);
      v_recorded := v_recorded + 1;
    end if;
  exception
    when others then
      null;
  end;

  -- billing: sem sinal automático (só incidente/manutenção da equipe).

  return jsonb_build_object('recorded', v_recorded, 'probe', v_result);
end;
$$;

comment on function private.status_collect_measurements(timestamptz) is
  'Passo da rotina status-publico-medicoes que lê os sinais e grava as amostras (private.status_record_sample). Regras: '
  'crm e leads_capture = resposta da sonda HTTP do minuto anterior a /api/status/ping (net._http_response): tempo esgotado (5 s), sem conexão, 5xx ou {"ok": false} = fora do ar; 200 acima de 3 s = lentidão; 200 com {"ok": true} = operacional; 3xx/4xx ou corpo sem "ok" = configuração, sem medição; resposta ausente = sem medição. '
  'login = mesma sonda, e {"auth": false} (health do Auth consultado pelo app) = fora do ar. '
  'lead_routing = job rodizio-de-leads: nenhuma execução em 10 min = fora do ar; das últimas 5 execuções terminadas em 15 min, 1–2 falhas = lentidão, 3–4 = instabilidade parcial, 5 = fora do ar; job ausente ou desligado = sem medição. '
  'notifications = aviso pendente mais antigo (sent_at null, attempts < 5): avisos de lead acima de 60 min = lentidão e de 180 min = instabilidade parcial; lembretes de visita futuros acima de 30 min = lentidão e de 90 min = instabilidade parcial; cada fila só é medida com o seu webhook no Vault; nunca fora do ar. '
  'integrations = lead_integration_deliveries da última hora: 3+ falhas e metade ou mais = instabilidade parcial; 1+ falha e 10% ou mais = lentidão; pendente entre 1 h e 24 h = lentidão; nunca fora do ar. '
  'caixa_catalog = caixa_catalog_status.sincronizado_em há mais de 48 h = lentidão, senão operacional; sem carga = sem medição; nunca fora do ar. '
  'billing = só manual. Um sinal que falhar não grava nada (sem medição, nunca vermelho).';

revoke all on function private.status_collect_measurements(timestamptz) from public, anon, authenticated;

create or replace function private.status_send_probe()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_request_id bigint;
begin
  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'status_probe_url'
  limit 1;

  if v_url is null or v_url !~* '^https://[^[:space:]<>"]+$' then
    update private.status_probe_state p
    set request_id = null,
        last_result = 'sem_url',
        last_http_status = null,
        last_duration_ms = null,
        updated_at = now()
    where p.singleton;

    return false;
  end if;

  begin
    v_request_id := net.http_get(
      url := v_url,
      params := '{}'::jsonb,
      headers := jsonb_build_object('Accept', 'application/json', 'User-Agent', 'status-publico-medicoes'),
      timeout_milliseconds := 5000
    );
  exception
    when others then
      update private.status_probe_state p
      set request_id = null,
          last_result = 'falha_ao_enviar',
          updated_at = now()
      where p.singleton;

      return false;
  end;

  update private.status_probe_state p
  set request_id = v_request_id,
      sent_at = now(),
      updated_at = now()
  where p.singleton;

  return true;
end;
$$;

comment on function private.status_send_probe() is
  'Passo da rotina status-publico-medicoes que dispara a sonda: GET assíncrono (pg_net, timeout 5 s) na URL do segredo status_probe_url do Vault (só https) e guarda o request_id para o minuto seguinte. Sem o segredo, não sonda (last_result sem_url) e nada é marcado como fora do ar.';

revoke all on function private.status_send_probe() from public, anon, authenticated;

create or replace function private.purge_status_measurements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_samples integer;
  v_days integer;
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

  return v_samples + v_days;
end;
$$;

comment on function private.purge_status_measurements() is
  'Retenção das medições da página de status: apaga amostras com mais de 8 dias (até 50.000 por vez) e resumos diários com mais de 400 dias. Chamada de hora em hora pela rotina status-publico-medicoes (minuto 11). Devolve quantas linhas apagou.';

revoke all on function private.purge_status_measurements() from public, anon, authenticated;

create or replace function private.run_status_measurements()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_purged integer := 0;
  v_sent boolean;
begin
  v_result := private.status_collect_measurements(now());

  if extract(minute from now())::integer = 11 then
    v_purged := private.purge_status_measurements();
  end if;

  v_sent := private.status_send_probe();

  return v_result || jsonb_build_object('purged', v_purged, 'probe_sent', v_sent);
end;
$$;

comment on function private.run_status_measurements() is
  'Rotina agendada (pg_cron, job status-publico-medicoes, a cada minuto): 1) lê a resposta da sonda do minuto anterior e os sinais do banco e grava as amostras (private.status_collect_measurements); 2) no minuto 11 de cada hora, aplica a retenção (private.purge_status_measurements); 3) dispara a próxima sonda (private.status_send_probe). A requisição do pg_net só sai depois do COMMIT.';

revoke all on function private.run_status_measurements() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'status-publico-medicoes') then
    perform cron.unschedule('status-publico-medicoes');
  end if;
end;
$$;

select cron.schedule(
  'status-publico-medicoes',
  '* * * * *',
  $cron$ select private.run_status_measurements(); $cron$
);

-- -----------------------------------------------------------------------------
-- 5. RPC pública e consulta mínima da sonda
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
  'Incidente no formato PublicIncident (camelCase), com estado efetivo e atualizações da mais recente para a mais antiga. Sem quem criou.';

revoke all on function private.status_public_incident(private.status_incidents, timestamptz)
  from public, anon, authenticated;

-- Incidentes e manutenções que importam para a página agora: os que tocam a
-- janela de 90 dias e os agendados, com estado e fim efetivos.
create or replace function private.status_events(p_now timestamptz)
returns table (
  id uuid,
  kind text,
  impact text,
  component_keys text[],
  started_at timestamptz,
  scheduled_for timestamptz,
  effective_status text,
  effective_resolved_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with w as (
    select ((p_now at time zone 'America/Sao_Paulo')::date - 89)::timestamp
      at time zone 'America/Sao_Paulo' as window_start
  )
  select
    i.id,
    i.kind,
    i.impact,
    i.component_keys,
    i.started_at,
    i.scheduled_for,
    e.status,
    case
      when e.status in ('resolved', 'completed') then coalesce(i.resolved_at, i.scheduled_until)
    end
  from private.status_incidents i
  cross join w
  cross join lateral (
    select private.status_effective_status(
      i.kind, i.status, i.scheduled_for, i.scheduled_until, p_now
    ) as status
  ) e
  where (i.resolved_at is null or i.resolved_at >= w.window_start)
    and (i.kind <> 'maintenance' or i.status <> 'scheduled' or i.scheduled_until >= w.window_start);
$$;

comment on function private.status_events(timestamptz) is
  'Incidentes e manutenções que tocam os últimos 90 dias (calendário de São Paulo) ou ainda vão acontecer, com estado efetivo e fim efetivo (manutenção concluída pelo relógio termina no fim previsto).';

revoke all on function private.status_events(timestamptz) from public, anon, authenticated;

create or replace function public.get_public_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_today constant date := (v_now at time zone 'America/Sao_Paulo')::date;
  v_first_day constant date := v_today - 89;
  v_components jsonb;
  v_overall text;
  v_last_checked timestamptz;
  v_active jsonb;
  v_upcoming jsonb;
  v_past jsonb;
begin
  with ev as materialized (
    select * from private.status_events(v_now)
  ),
  keys as (
    select k.key, k.ord
    from unnest(private.status_component_keys()) with ordinality as k(key, ord)
  ),
  days as (
    select
      d.day::date as day,
      d.day::date::timestamp at time zone 'America/Sao_Paulo' as day_start,
      (d.day::date + 1)::timestamp at time zone 'America/Sao_Paulo' as day_end
    from generate_series(v_first_day::timestamp, v_today::timestamp, interval '1 day') as d(day)
  ),
  levels as (
    select
      k.key,
      k.ord,
      -- Medição com mais de 10 minutos não vale: sem medição = operacional.
      case when st.last_measured_at >= v_now - interval '10 minutes' then st.level end as measured,
      (
        select private.status_impact_level(ev.impact)
        from ev
        where ev.kind = 'incident'
          and ev.effective_status <> 'resolved'
          and k.key = any (ev.component_keys)
        order by private.status_level_rank(private.status_impact_level(ev.impact)) desc
        limit 1
      ) as incident_level,
      exists (
        select 1
        from ev
        where ev.kind = 'maintenance'
          and ev.effective_status = 'in_progress'
          and k.key = any (ev.component_keys)
      ) as in_maintenance
    from keys k
    left join private.status_component_state st on st.component_key = k.key
  ),
  component_levels as (
    select
      l.key,
      l.ord,
      case
        when l.in_maintenance then
          case
            when private.status_level_rank(coalesce(l.incident_level, 'operational'))
              > private.status_level_rank('under_maintenance')
              then l.incident_level
            else 'under_maintenance'
          end
        else private.status_worse_level(
          coalesce(l.incident_level, 'operational'), coalesce(l.measured, 'operational')
        )
      end as level
    from levels l
  ),
  component_days as (
    select
      k.key,
      d.day,
      s.good_samples,
      s.total_samples,
      private.status_worse_level(
        private.status_worse_level(
          coalesce(s.worst_level, 'operational'),
          (
            select private.status_impact_level(ev.impact)
            from ev
            where ev.kind = 'incident'
              and k.key = any (ev.component_keys)
              and ev.started_at < d.day_end
              and coalesce(ev.effective_resolved_at, v_now) >= d.day_start
            order by private.status_level_rank(private.status_impact_level(ev.impact)) desc
            limit 1
          )
        ),
        (
          select 'under_maintenance'
          from ev
          where ev.kind = 'maintenance'
            and ev.effective_status in ('in_progress', 'completed')
            and k.key = any (ev.component_keys)
            and ev.started_at < d.day_end
            and coalesce(ev.effective_resolved_at, v_now) >= d.day_start
          limit 1
        )
      ) as worst_level,
      coalesce((
        select jsonb_agg(ev.id order by ev.started_at, ev.id)
        from ev
        where k.key = any (ev.component_keys)
          and not (ev.kind = 'maintenance' and ev.effective_status = 'scheduled')
          and ev.started_at < d.day_end
          and coalesce(ev.effective_resolved_at, v_now) >= d.day_start
      ), '[]'::jsonb) as incident_ids
    from keys k
    cross join days d
    left join private.status_daily_summaries s
      on s.component_key = k.key
     and s.day = d.day
  )
  select
    jsonb_agg(
      jsonb_build_object(
        'key', cl.key,
        'name', info.name,
        'description', info.description,
        'level', cl.level,
        'uptime90dPct', (
          select case
            when sum(cd.total_samples) > 0 then
              case
                when sum(cd.good_samples) = sum(cd.total_samples) then 100
                else round(floor(sum(cd.good_samples)::numeric * 10000 / sum(cd.total_samples)) / 100, 2)
              end
          end
          from component_days cd
          where cd.key = cl.key
        ),
        'days', (
          select jsonb_agg(
            jsonb_build_object(
              'date', to_char(cd.day, 'YYYY-MM-DD'),
              'uptimePct', case
                when cd.total_samples > 0 then
                  case
                    when cd.good_samples = cd.total_samples then 100
                    else round(floor(cd.good_samples::numeric * 10000 / cd.total_samples) / 100, 2)
                  end
              end,
              'worstLevel', cd.worst_level,
              'incidentIds', cd.incident_ids
            )
            order by cd.day
          )
          from component_days cd
          where cd.key = cl.key
        )
      )
      order by cl.ord
    ),
    (
      select c2.level
      from component_levels c2
      order by private.status_level_rank(c2.level) desc
      limit 1
    )
  into v_components, v_overall
  from component_levels cl
  join (
    values
      ('crm', 'CRM', 'Telas do sistema: painel, leads, imóveis, clientes, agenda e propostas.'),
      ('login', 'Login e contas', 'Entrar, criar conta, recuperar senha e convites.'),
      ('leads_capture', 'Landing pages e captação', 'Páginas públicas, formulários de contato e páginas dos imóveis.'),
      ('lead_routing', 'Rodízio de leads', 'Distribuição automática dos leads e prazo de primeiro contato.'),
      ('notifications', 'Avisos por e-mail e no celular', 'Aviso de novo lead, lembretes de visita, resumo diário e relatório semanal.'),
      ('integrations', 'Portais e integrações', 'Leads que chegam dos portais e contas conectadas.'),
      ('caixa_catalog', 'Imóveis da Caixa', 'Catálogo de imóveis da Caixa Econômica Federal.'),
      ('billing', 'Assinaturas e pagamentos', 'Planos, cobrança e faturas.')
  ) as info(key, name, description) on info.key = cl.key;

  select max(st.last_measured_at) into v_last_checked
  from private.status_component_state st;

  select coalesce(jsonb_agg(private.status_public_incident(i, v_now) order by i.started_at desc, i.id), '[]'::jsonb)
  into v_active
  from private.status_incidents i
  join private.status_events(v_now) ev on ev.id = i.id
  where ev.effective_status in ('investigating', 'identified', 'monitoring', 'in_progress');

  select coalesce(jsonb_agg(private.status_public_incident(i, v_now) order by i.scheduled_for, i.id), '[]'::jsonb)
  into v_upcoming
  from private.status_incidents i
  join private.status_events(v_now) ev on ev.id = i.id
  where ev.effective_status = 'scheduled';

  select coalesce(jsonb_agg(x.incident order by x.resolved_at desc, x.id), '[]'::jsonb)
  into v_past
  from (
    select private.status_public_incident(i, v_now) as incident, ev.effective_resolved_at as resolved_at, i.id
    from private.status_incidents i
    join private.status_events(v_now) ev on ev.id = i.id
    where ev.effective_status in ('resolved', 'completed')
      and ev.effective_resolved_at >= v_now - interval '14 days'
    order by ev.effective_resolved_at desc, i.id
    limit 50
  ) x;

  return jsonb_build_object(
    'generatedAt', v_now,
    'lastCheckedAt', v_last_checked,
    'overall', coalesce(v_overall, 'operational'),
    'components', coalesce(v_components, '[]'::jsonb),
    'activeIncidents', v_active,
    'upcomingMaintenances', v_upcoming,
    'pastIncidents', v_past
  );
end;
$$;

comment on function public.get_public_status() is
  'Página de status pública (anon e authenticated, sem chave): retrato no formato PublicStatusSnapshot (packages/core/src/status/public.ts). Por parte: nível atual (pior entre incidente em aberto e medição automática dos últimos 10 min; manutenção em andamento mostra under_maintenance e ignora a medição, mas incidente pior vence), disponibilidade de 90 dias e barra de 90 dias (dia de São Paulo: disponibilidade do resumo diário, pior nível entre medição, incidentes e manutenção, ids dos incidentes do dia). Situação geral = pior parte. Incidentes ativos (inclui manutenção em andamento), manutenções agendadas e resolvidos dos últimos 14 dias (até 50). Só dado público: nada de quem criou, filas, rotinas ou detalhes da medição.';

create or replace function public.status_ping()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

comment on function public.status_ping() is
  'Consulta mínima usada por /api/status/ping (sonda da página de status) para saber se o banco responde. Não lê tabela nenhuma.';

revoke all on function public.get_public_status() from public, anon, authenticated;
revoke all on function public.status_ping() from public, anon, authenticated;
grant execute on function public.get_public_status() to anon, authenticated;
grant execute on function public.status_ping() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPCs do Console (chave do servidor, só anon)
-- -----------------------------------------------------------------------------
create or replace function private.status_incident_audit_data(p private.status_incidents)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'tipo', p.kind,
    'titulo', private.platform_audit_mask_text(p.title),
    'impacto', p.impact,
    'estado', p.status,
    'partes', to_jsonb(p.component_keys),
    'inicio', p.started_at,
    'fim', p.resolved_at,
    'inicio_previsto', p.scheduled_for,
    'fim_previsto', p.scheduled_until
  );
$$;

comment on function private.status_incident_audit_data(private.status_incidents) is
  'Antes/depois de um incidente ou manutenção para o registro do console (título mascarado por private.platform_audit_mask_text).';

revoke all on function private.status_incident_audit_data(private.status_incidents) from public, anon, authenticated;

create or replace function private.status_check_maintenance_window(
  p_scheduled_for timestamptz,
  p_scheduled_until timestamptz,
  p_now timestamptz
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_scheduled_for is null
     or p_scheduled_until is null
     or p_scheduled_until <= p_now
     or p_scheduled_until <= p_scheduled_for
     or p_scheduled_until > p_scheduled_for + interval '72 hours'
     or p_scheduled_for > p_now + interval '90 days' then
    raise exception 'Janela da manutenção inválida.' using errcode = '22023';
  end if;
end;
$$;

comment on function private.status_check_maintenance_window(timestamptz, timestamptz, timestamptz) is
  'Recusa (22023) janela de manutenção sem início ou fim, com fim no passado ou antes do início, com mais de 72 h ou começando daqui a mais de 90 dias.';

revoke all on function private.status_check_maintenance_window(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;

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
        'updates', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', u.id, 'status', u.status, 'message', u.message, 'created_at', u.created_at
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
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): incidentes e manutenções do mais novo para o mais antigo (até 200), com estado gravado e efetivo, datas e atualizações.';

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
  v_probe jsonb;
  v_components jsonb;
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

  return jsonb_build_object(
    'generated_at', now(),
    'probe', coalesce(v_probe, jsonb_build_object(
      'url_configured', false, 'job_active', null, 'last_sent_at', null, 'last_checked_at', null,
      'last_result', null, 'last_http_status', null, 'last_duration_ms', null
    )),
    'components', coalesce(v_components, '[]'::jsonb)
  );
end;
$$;

comment on function public.platform_status_overview(text, integer) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): estado da sonda HTTP (se status_probe_url existe no Vault — nunca o valor —, se a rotina está ativa, último resultado, HTTP e duração) e, por parte, o nível automático com histerese, o candidato esperando confirmação e as últimas medições (até 60). Só para o Console.';

create or replace function public.platform_status_create_incident(
  p_server_key text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_kind text,
  p_title text,
  p_impact text,
  p_component_keys text[],
  p_message text,
  p_status text default null,
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
  v_status text;
  v_row private.status_incidents%rowtype;
begin
  perform private.check_platform_server_key(p_server_key);

  if p_kind = 'incident' then
    v_status := coalesce(p_status, 'investigating');

    if v_status not in ('investigating', 'identified', 'monitoring')
       or p_scheduled_for is not null
       or p_scheduled_until is not null then
      raise exception 'Estado inicial ou horário inválido para incidente.' using errcode = '22023';
    end if;
  elsif p_kind = 'maintenance' then
    if p_status is not null then
      raise exception 'Manutenção começa agendada; o horário decide o resto.' using errcode = '22023';
    end if;

    perform private.status_check_maintenance_window(p_scheduled_for, p_scheduled_until, v_now);
    v_status := 'scheduled';
  else
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;

  insert into private.status_incidents (
    kind, title, impact, status, component_keys, started_at, scheduled_for, scheduled_until,
    created_by
  )
  values (
    p_kind,
    btrim(coalesce(p_title, '')),
    p_impact,
    v_status,
    private.status_normalize_component_keys(p_component_keys),
    case when p_kind = 'maintenance' then p_scheduled_for else v_now end,
    p_scheduled_for,
    p_scheduled_until,
    p_actor_user_id
  )
  returning * into v_row;

  insert into private.status_incident_updates (incident_id, status, message, created_by)
  values (
    v_row.id,
    v_status,
    btrim(replace(coalesce(p_message, ''), E'\r\n', E'\n'), E' \n'),
    p_actor_user_id
  );

  perform private.record_platform_audit_event(
    p_actor_user_id,
    p_actor_email,
    case when p_kind = 'incident' then 'incidente.criar' else 'manutencao.agendar' end,
    case when p_kind = 'incident' then 'incidente' else 'manutencao' end,
    v_row.id::text,
    null,
    null,
    null,
    private.status_incident_audit_data(v_row)
  );

  return v_row.id;
end;
$$;

comment on function public.platform_status_create_incident(text, uuid, text, text, text, text, text[], text, text, timestamptz, timestamptz) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: cria incidente (estado inicial investigando, identificado ou monitorando) ou agenda manutenção (janela de até 72 h, fim no futuro, início em até 90 dias) com a primeira atualização, e grava incidente.criar/manutencao.agendar no registro do console na mesma transação. Erros: 42501 chave ou conta; 22023 tipo, estado ou janela inválidos; 23514 título, impacto, partes ou mensagem fora das regras.';

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

  update private.status_incidents i
  set status = p_status,
      started_at = case
        when i.kind = 'maintenance' and p_status in ('in_progress', 'completed')
          then least(i.started_at, v_now)
        else i.started_at
      end,
      resolved_at = case when v_closing then v_now end
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
    )
  );

  return v_update_id;
end;
$$;

comment on function public.platform_status_add_update(text, uuid, text, uuid, text, text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: publica uma atualização (estado + mensagem) e muda o estado do registro; resolvido/concluída encerra (resolved_at). Manutenção que começa antes do previsto passa a ter o início real. Grava incidente.atualizar/incidente.resolver/manutencao.atualizar/manutencao.concluir no registro do console. Erros: 42501 chave ou conta; P0002 inexistente; 22023 encerrado ou estado inválido para o tipo; 23514 mensagem fora das regras.';

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

  update private.status_incidents i
  set title = v_title,
      impact = p_impact,
      component_keys = v_keys,
      scheduled_for = v_for,
      scheduled_until = v_until,
      started_at = case when v_window_changed then v_for else i.started_at end
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
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: edita título, impacto e partes afetadas (encerrado: só o título) e, em manutenção ainda agendada, a janela prevista. Sem mudança, não grava nada; com mudança, grava incidente.editar/manutencao.editar no registro do console. Erros: 42501 chave ou conta; P0002 inexistente; 22023 encerrado ou janela inválida; 23514 campo fora das regras.';

revoke all on function public.platform_status_list_incidents(text, integer) from public, anon, authenticated;
revoke all on function public.platform_status_overview(text, integer) from public, anon, authenticated;
revoke all on function public.platform_status_create_incident(text, uuid, text, text, text, text, text[], text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.platform_status_add_update(text, uuid, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.platform_status_edit_incident(text, uuid, text, uuid, text, text, text[], timestamptz, timestamptz)
  from public, anon, authenticated;

grant execute on function public.platform_status_list_incidents(text, integer) to anon;
grant execute on function public.platform_status_overview(text, integer) to anon;
grant execute on function public.platform_status_create_incident(text, uuid, text, text, text, text, text[], text, text, timestamptz, timestamptz)
  to anon;
grant execute on function public.platform_status_add_update(text, uuid, text, uuid, text, text) to anon;
grant execute on function public.platform_status_edit_incident(text, uuid, text, uuid, text, text, text[], timestamptz, timestamptz)
  to anon;
