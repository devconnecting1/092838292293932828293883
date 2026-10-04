-- =============================================================================
-- Página de status: sinal automático de "Assinaturas e pagamentos" (webhook da
-- Stripe) e textos honestos
-- =============================================================================
-- Até aqui billing era "só manual": o banco não sabia se o webhook da Stripe
-- estava funcionando (o erro ficava só nos logs da Vercel) e a página pública
-- mostrava "Operacional" sem medir nada. Agora, sem custo novo:
--
--  1. private.status_billing_webhook_deliveries: cada entrega recebida por
--     /api/webhooks/stripe vira uma linha só com o RESULTADO — instante,
--     ok | config_ausente | assinatura_invalida | erro_processamento e o tipo
--     do evento (só quando a assinatura conferiu). Nunca payload, id de
--     cliente, assinatura, organização ou valor. Retenção: 14 dias.
--  2. public.record_billing_webhook_delivery (BILLING_SERVER_KEY, EXECUTE só
--     anon): gravação feita pela rota depois de responder à Stripe. Falha de
--     configuração repetida grava no máximo uma linha a cada 10 s enquanto não
--     houver entrega ok depois dela (o endpoint é público).
--  3. private.status_billing_webhook_signal: regra da medição (janela de 2 h):
--     config_ausente ou assinatura_invalida sem nenhuma ok depois dela →
--     instabilidade parcial; mais da metade das entregas processadas (ok +
--     erro_processamento, mínimo 3) com erro → lentidão; senão operacional;
--     nenhuma entrega na janela → sem medição (nunca queda). Entra na rotina
--     status-publico-medicoes como as outras partes (histerese de 2 medições)
--     e, com isso, nos incidentes automáticos.
--  4. private.status_component_signal_configured: a parte tem sinal automático
--     ligado? (sonda com status_probe_url, rotina do rodízio ativa, webhook de
--     avisos no Vault, entrega do webhook da Stripe nos últimos 14 dias...).
--     get_public_status passa a devolver automaticSignal por parte, para a
--     página dizer "Sem medição automática · acompanhado pela equipe" ou
--     "Aguardando a primeira medição" em vez de "Sem medição nos últimos 90
--     dias".
--  5. platform_status_overview: billing deixa de ser "manual", cada parte traz
--     signal_configured e o Console recebe a última entrega do webhook, o
--     motivo, as contagens das últimas 2 h e as 10 entregas mais recentes.
--  6. private.purge_status_measurements apaga as entregas com mais de 14 dias.
--
-- Stripe: cada nova tentativa de entrega gera assinatura e carimbo de data e
-- hora novos; as bibliotecas toleram 5 min; em produção a Stripe tenta por até
-- 3 dias e na área restrita 3 vezes em poucas horas
-- (https://docs.stripe.com/webhooks). Espelho das regras em
-- packages/core/src/status/billing-webhook.ts (mudou aqui, mude lá).

-- -----------------------------------------------------------------------------
-- 1. Entregas do webhook da Stripe (só o resultado)
-- -----------------------------------------------------------------------------
create table private.status_billing_webhook_deliveries (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  outcome text not null,
  event_type text,
  constraint status_billing_webhook_deliveries_outcome_check
    check (outcome in ('ok', 'config_ausente', 'assinatura_invalida', 'erro_processamento')),
  constraint status_billing_webhook_deliveries_event_type_check
    check (
      event_type is null
      or (
        outcome in ('ok', 'erro_processamento')
        and char_length(event_type) between 3 and 80
        and event_type ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'
      )
    )
);

comment on table private.status_billing_webhook_deliveries is
  'Resultado de cada entrega recebida pelo webhook da Stripe (/api/webhooks/stripe), para a medição automática de "Assinaturas e pagamentos" na página de status. Só instante, resultado e tipo do evento: nunca payload, assinatura, id de cliente/assinatura/organização ou valor. Escrita só por public.record_billing_webhook_delivery (BILLING_SERVER_KEY). Retenção: 14 dias (private.purge_status_measurements). Sem acesso direto (RLS sem política).';
comment on column private.status_billing_webhook_deliveries.received_at is
  'Quando a rota gravou o resultado (logo depois de responder à Stripe).';
comment on column private.status_billing_webhook_deliveries.outcome is
  'ok (assinatura conferiu e o evento foi processado ou ignorado de propósito); config_ausente (STRIPE_SECRET_KEY ou STRIPE_WEBHOOK_SECRET ausente ou inválida no servidor); assinatura_invalida (cabeçalho Stripe-Signature recente, mas não confere com STRIPE_WEBHOOK_SECRET); erro_processamento (assinatura conferiu, mas a sincronização falhou).';
comment on column private.status_billing_webhook_deliveries.event_type is
  'Tipo do evento da Stripe (ex.: invoice.paid), só quando a assinatura conferiu (ok ou erro_processamento). Null nos demais: o corpo não verificado não é lido.';

create index status_billing_webhook_deliveries_received_idx
  on private.status_billing_webhook_deliveries (received_at, id);

alter table private.status_billing_webhook_deliveries enable row level security;
revoke all on private.status_billing_webhook_deliveries from public, anon, authenticated;

create or replace function public.record_billing_webhook_delivery(
  p_server_key text,
  p_outcome text,
  p_event_type text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_outcome is null
     or p_outcome not in ('ok', 'config_ausente', 'assinatura_invalida', 'erro_processamento') then
    raise exception 'Resultado inválido.' using errcode = '22023';
  end if;

  -- Tipo só de evento verificado e no formato da Stripe; fora disso, a entrega
  -- vale sem o tipo (nunca perde o resultado).
  v_event_type := case
    when p_outcome in ('ok', 'erro_processamento') then nullif(btrim(coalesce(p_event_type, '')), '')
  end;

  if v_event_type is not null
     and (char_length(v_event_type) not between 3 and 80 or v_event_type !~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$') then
    v_event_type := null;
  end if;

  -- Endpoint público: a mesma falha de configuração, repetida em rajada, grava
  -- no máximo uma linha a cada 10 s enquanto nenhuma entrega ok vier depois.
  if p_outcome in ('config_ausente', 'assinatura_invalida') and exists (
    select 1
    from private.status_billing_webhook_deliveries d
    where d.outcome = p_outcome
      and d.received_at > now() - interval '10 seconds'
      and not exists (
        select 1
        from private.status_billing_webhook_deliveries o
        where o.outcome = 'ok'
          and (o.received_at, o.id) > (d.received_at, d.id)
      )
  ) then
    return false;
  end if;

  insert into private.status_billing_webhook_deliveries (outcome, event_type)
  values (p_outcome, v_event_type);

  return true;
end;
$$;

comment on function public.record_billing_webhook_delivery(text, text, text) is
  'Rota /api/webhooks/stripe (chave publishable + BILLING_SERVER_KEY, sem sessão), depois de responder à Stripe: grava o resultado da entrega (ok, config_ausente, assinatura_invalida ou erro_processamento) e o tipo do evento só quando a assinatura conferiu (formato inválido vira null). config_ausente/assinatura_invalida iguais há menos de 10 s, sem ok depois, não gravam de novo (devolve false). Nunca recebe payload, ids ou valores. Erros: 42501 chave; 22023 resultado inválido.';

revoke all on function public.record_billing_webhook_delivery(text, text, text) from public, anon, authenticated;
grant execute on function public.record_billing_webhook_delivery(text, text, text) to anon;

-- -----------------------------------------------------------------------------
-- 2. Regra da medição e sinal configurado
-- -----------------------------------------------------------------------------
create or replace function private.status_billing_webhook_signal(p_now timestamptz)
returns table (level text, detail text)
language sql
stable
set search_path = ''
as $$
  with w as (
    select d.id, d.received_at, d.outcome
    from private.status_billing_webhook_deliveries d
    where d.received_at > p_now - interval '2 hours'
      and d.received_at <= p_now
  ),
  last_ok as (
    select w.received_at, w.id
    from w
    where w.outcome = 'ok'
    order by w.received_at desc, w.id desc
    limit 1
  ),
  last_bad as (
    select w.received_at, w.id, w.outcome
    from w
    where w.outcome in ('config_ausente', 'assinatura_invalida')
    order by w.received_at desc, w.id desc
    limit 1
  ),
  agg as (
    select
      count(*) as total,
      count(*) filter (where w.outcome in ('ok', 'erro_processamento')) as processed,
      count(*) filter (where w.outcome = 'erro_processamento') as errors
    from w
  ),
  verdict as (
    select
      case
        when b.id is not null and (o.id is null or (o.received_at, o.id) < (b.received_at, b.id))
          then b.outcome
        when a.processed >= 3 and a.errors * 2 > a.processed then 'erro_processamento'
      end as problem
    from agg a
    left join last_bad b on true
    left join last_ok o on true
    where a.total > 0
  )
  select
    case v.problem
      when 'config_ausente' then 'partial_outage'
      when 'assinatura_invalida' then 'partial_outage'
      when 'erro_processamento' then 'degraded_performance'
      else 'operational'
    end,
    case v.problem
      when 'config_ausente' then 'webhook_config_ausente'
      when 'assinatura_invalida' then 'webhook_assinatura_invalida'
      when 'erro_processamento' then 'webhook_erros_processamento'
      else 'ok'
    end
  from verdict v;
$$;

comment on function private.status_billing_webhook_signal(timestamptz) is
  'Medição de "Assinaturas e pagamentos" pelas entregas do webhook da Stripe nas últimas 2 h (até p_now): config_ausente ou assinatura_invalida sem nenhuma entrega ok depois dela (instante e ordem de gravação) = instabilidade parcial (webhook_config_ausente/webhook_assinatura_invalida); com 3 ou mais entregas processadas (ok + erro_processamento) e mais da metade com erro_processamento = lentidão (webhook_erros_processamento); senão operacional (ok). Nenhuma entrega na janela = nenhuma linha (sem medição, nunca queda). Nunca fora do ar. Igual a billingWebhookSignal no core.';

create or replace function private.status_component_signal_configured(p_key text, p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_key in ('crm', 'login', 'leads_capture') then exists (
      select 1 from vault.secrets s where s.name = 'status_probe_url'
    )
    when p_key = 'lead_routing' then exists (
      select 1 from cron.job j where j.jobname = 'rodizio-de-leads' and j.active
    )
    when p_key = 'notifications' then (
      select count(distinct s.name) = 2
      from vault.secrets s
      where s.name in ('lead_alerts_webhook_url', 'lead_alerts_webhook_secret')
    ) or (
      select count(distinct s.name) = 2
      from vault.secrets s
      where s.name in ('visit_reminders_webhook_url', 'visit_reminders_webhook_secret')
    )
    when p_key in ('integrations', 'caixa_catalog') then true
    when p_key = 'billing' then exists (
      select 1
      from private.status_billing_webhook_deliveries d
      where d.received_at > p_now - interval '14 days'
    )
    else false
  end;
$$;

comment on function private.status_component_signal_configured(text, timestamptz) is
  'A parte tem sinal automático ligado (mesmo que ainda sem medição)? crm, login e leads_capture: segredo status_probe_url no Vault; lead_routing: rotina rodizio-de-leads ativa; notifications: os dois segredos de um dos webhooks de avisos; integrations e caixa_catalog: sempre; billing: alguma entrega do webhook da Stripe registrada nos últimos 14 dias. Só olha nomes de segredo, nunca valores.';

revoke all on function private.status_billing_webhook_signal(timestamptz) from public, anon, authenticated;
revoke all on function private.status_component_signal_configured(text, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Rotina de medição: billing passa a ser medido
-- -----------------------------------------------------------------------------
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

  -- ---------------------------------------------------------------------------
  -- billing: entregas do webhook da Stripe nas últimas 2 h
  -- ---------------------------------------------------------------------------
  begin
    select s.level, s.detail into v_level, v_detail
    from private.status_billing_webhook_signal(p_now) s;

    -- Sem entrega na janela, a função não devolve linha: sem medição.
    if found then
      perform private.status_record_sample('billing', v_level, v_detail, p_now);
      v_recorded := v_recorded + 1;
    end if;
  exception
    when others then
      null;
  end;

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
  'billing = entregas do webhook da Stripe nas últimas 2 h (private.status_billing_webhook_signal): config_ausente ou assinatura_invalida sem ok depois = instabilidade parcial; 3+ processadas e mais da metade com erro_processamento = lentidão; nenhuma entrega = sem medição; nunca fora do ar. '
  'Um sinal que falhar não grava nada (sem medição, nunca vermelho).';

-- -----------------------------------------------------------------------------
-- 4. RPC pública: sinal automático por parte
-- -----------------------------------------------------------------------------
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
        'automaticSignal', private.status_component_signal_configured(cl.key, v_now),
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
  'Página de status pública (anon e authenticated, sem chave): retrato no formato PublicStatusSnapshot (packages/core/src/status/public.ts). Por parte: nível atual (pior entre incidente em aberto e medição automática dos últimos 10 min; manutenção em andamento mostra under_maintenance e ignora a medição, mas incidente pior vence), disponibilidade de 90 dias e barra de 90 dias (dia de São Paulo: disponibilidade do resumo diário, pior nível entre medição, incidentes e manutenção, ids dos incidentes do dia). automaticSignal = a parte tem sinal automático ligado (private.status_component_signal_configured), para a página dizer se falta medição ou se só a equipe acompanha. Situação geral = pior parte. Incidentes ativos (inclui manutenção em andamento), manutenções agendadas e resolvidos dos últimos 14 dias (até 50). Só dado público: nada de quem criou, filas, rotinas ou detalhes da medição.';

-- -----------------------------------------------------------------------------
-- 5. Console: webhook da Stripe e sinal configurado
-- -----------------------------------------------------------------------------
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
  v_billing_webhook jsonb;
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
      'source', 'automatic',
      'signal_configured', private.status_component_signal_configured(k.key, v_now),
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

  select jsonb_build_object(
    'last_received_at', l.received_at,
    'last_outcome', l.outcome,
    'last_event_type', l.event_type,
    'last_ok_at', (
      select max(d.received_at)
      from private.status_billing_webhook_deliveries d
      where d.outcome = 'ok'
    ),
    'last_problem_at', p.received_at,
    'last_problem_outcome', p.outcome,
    'counts_2h', (
      select jsonb_build_object(
        'ok', count(*) filter (where d.outcome = 'ok'),
        'config_ausente', count(*) filter (where d.outcome = 'config_ausente'),
        'assinatura_invalida', count(*) filter (where d.outcome = 'assinatura_invalida'),
        'erro_processamento', count(*) filter (where d.outcome = 'erro_processamento')
      )
      from private.status_billing_webhook_deliveries d
      where d.received_at > v_now - interval '2 hours'
    ),
    'recent', coalesce((
      select jsonb_agg(
        jsonb_build_object('received_at', r.received_at, 'outcome', r.outcome, 'event_type', r.event_type)
        order by r.received_at desc, r.id desc
      )
      from (
        select d.id, d.received_at, d.outcome, d.event_type
        from private.status_billing_webhook_deliveries d
        order by d.received_at desc, d.id desc
        limit 10
      ) r
    ), '[]'::jsonb)
  )
  into v_billing_webhook
  from (select 1) as one
  left join lateral (
    select d.received_at, d.outcome, d.event_type
    from private.status_billing_webhook_deliveries d
    order by d.received_at desc, d.id desc
    limit 1
  ) l on true
  left join lateral (
    select d.received_at, d.outcome
    from private.status_billing_webhook_deliveries d
    where d.outcome <> 'ok'
    order by d.received_at desc, d.id desc
    limit 1
  ) p on true;

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
    'alerts', v_alerts,
    'billing_webhook', v_billing_webhook
  );
end;
$$;

comment on function public.platform_status_overview(text, integer) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY): estado da sonda HTTP (se status_probe_url existe no Vault — nunca o valor —, se a rotina está ativa, último resultado, HTTP e duração); por parte, o nível automático com histerese, se o sinal automático está ligado (signal_configured), o candidato e as últimas medições (até 60); a última passada da automação de incidentes (e o código do último erro); os fornecedores (indicador e leitura); e a fila do aviso por e-mail (segredos do webhook existem?, pendentes, expirados em 7 dias, e-mails usados em 24 h e a trava); e o webhook da Stripe (última entrega com resultado e tipo, última ok, último problema, contagens das últimas 2 h e as 10 mais recentes — nunca payload). Só para o Console.';

-- -----------------------------------------------------------------------------
-- 6. Retenção
-- -----------------------------------------------------------------------------
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
  v_webhook integer;
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

  delete from private.status_billing_webhook_deliveries d
  where d.id in (
    select x.id
    from private.status_billing_webhook_deliveries x
    where x.received_at < now() - interval '14 days'
    order by x.received_at
    limit 50000
  );

  get diagnostics v_webhook = row_count;

  update private.status_vendor_state s
  set indicator = null,
      description = null,
      updated_at = now()
  where s.checked_at < now() - interval '1 day'
    and (s.indicator is not null or s.description is not null);

  return v_samples + v_days + v_alerts + v_webhook;
end;
$$;

comment on function private.purge_status_measurements() is
  'Retenção da página de status: apaga amostras com mais de 8 dias (até 50.000 por vez), resumos diários com mais de 400 dias, avisos por e-mail enviados ou expirados há mais de 30 dias e entregas do webhook da Stripe com mais de 14 dias (até 50.000 por vez); expira avisos pendentes com mais de 6 h e esquece o indicador de fornecedor sem leitura há 1 dia. Chamada de hora em hora pela rotina status-publico-medicoes (minuto 11). Devolve quantas linhas apagou.';
