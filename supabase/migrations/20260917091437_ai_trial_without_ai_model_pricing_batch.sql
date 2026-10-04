-- =============================================================================
-- IA: teste grátis sem IA, preço por modelo, Batch API e teto pela franquia
-- =============================================================================
-- Decisões do dono em 17/09/2026 (regra de sempre: nunca ter prejuízo com IA):
--
--  1. Teste grátis SEM IA. private.billing_trial_defaults passa a gravar
--     ai_conversations = 0, as contas em teste local são corrigidas e
--     private.ai_quota_context devolve franquia 0 e teto 0 em QUALQUER conta
--     'trialing' (inclusive teste criado na Stripe). reserve_ai_usage recusa com
--     'feature_unavailable' antes de tocar na linha do ciclo. A IA começa quando
--     a imobiliária assina.
--  2. Preço por modelo. Conversa e anúncio continuam no Claude Sonnet 5; resumo
--     e sugestão de resposta passam para o Claude Haiku 4.5 (metade do preço).
--     private.ai_models() é o catálogo, private.ai_pricing(p_model) devolve o
--     preço de UM modelo e recusa (22023) modelo desconhecido: nunca subcobrar.
--  3. Batch API: 50% de desconto em entrada, saída e cache (os multiplicadores
--     de cache se somam ao desconto do lote). reserve_ai_usage e settle_ai_usage
--     recebem p_model e p_batch. Chamada antiga, sem esses campos, continua
--     valendo e é medida como Sonnet 5 sem lote — o mais caro dos dois.
--  4. Teto por plano = menor valor entre 20% do preço de tabela mensal e
--     franquia × conversa típica × 1,25, arredondado para cima em centavos:
--     Imobiliária R$ 49,80 → R$ 34,56; Equipe R$ 119,80 e Rede R$ 298,00 (os
--     20% já são o menor); Corretor, teste grátis e plano desconhecido: R$ 0.
--
-- Fonte oficial (conferida em 2026-09-17):
--   https://platform.claude.com/docs/en/about-claude/pricing
--   Sonnet 5: entrada 2,00; cache 5 min 2,50; cache 1 h 4,00; leitura 0,20; saída 10,00
--   Haiku 4.5: entrada 1,00; cache 5 min 1,25; cache 1 h 2,00; leitura 0,10; saída 5,00
--   Batch API: 50% de desconto (Sonnet 5 1/5; Haiku 4.5 0,50/2,50)
--
-- FONTE ÚNICA DOS NÚMEROS: packages/core/src/billing/ai-usage.ts
-- (AI_MODEL_CATALOG, AI_BATCH_PRICE_MULTIPLIER, AI_EXCHANGE_RATE_DEFAULT e
-- aiCostCapCents). As constantes abaixo são cópia; a tela Console → Custos de IA
-- confere banco x core e marca "Diferente" quando não batem.

-- -----------------------------------------------------------------------------
-- 1. Catálogo de modelos e preço por modelo
-- -----------------------------------------------------------------------------

create or replace function private.ai_models()
returns table (
  model text,
  label text,
  usd_per_mtok_input numeric,
  usd_per_mtok_output numeric,
  usd_per_mtok_cache_read numeric,
  usd_per_mtok_cache_write numeric,
  usd_per_mtok_cache_write_1h numeric
)
language sql
immutable
set search_path = ''
as $$
  values
    ('claude-sonnet-5'::text, 'Claude Sonnet 5'::text,
     2::numeric, 10::numeric, 0.2::numeric, 2.5::numeric, 4::numeric),
    ('claude-haiku-4-5'::text, 'Claude Haiku 4.5'::text,
     1::numeric, 5::numeric, 0.1::numeric, 1.25::numeric, 2::numeric);
$$;

comment on function private.ai_models() is
  'Catálogo de modelos de IA com preço oficial em US$ por milhão de tokens (tabela conferida em 2026-09-17 em platform.claude.com/docs/en/about-claude/pricing). O banco mede a escrita de cache pelo preço de 5 min; a de 1 h chega convertida pelo servidor (aiUsageFromApi). Espelho de AI_MODEL_CATALOG em packages/core/src/billing/ai-usage.ts.';

-- Modelo assumido quando a chamada não informa: o mais caro do catálogo.
create or replace function private.ai_default_model()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'claude-sonnet-5'::text;
$$;

comment on function private.ai_default_model() is
  'Modelo usado quando reserve_ai_usage/settle_ai_usage não recebem p_model (chamada antiga): claude-sonnet-5, o mais caro do catálogo, para nunca medir a menos. Espelho de AI_DEFAULT_MODEL no core.';

-- A assinatura muda (ganha p_model e batch_multiplier): troca a função inteira.
-- Quem chama private.ai_pricing() sem argumento continua recebendo o Sonnet 5.
drop function private.ai_pricing();

create function private.ai_pricing(
  p_model text default null,
  out model text,
  out usd_per_mtok_input numeric,
  out usd_per_mtok_output numeric,
  out usd_per_mtok_cache_read numeric,
  out usd_per_mtok_cache_write numeric,
  out exchange_rate numeric,
  out batch_multiplier numeric
)
language plpgsql
immutable
set search_path = ''
as $$
begin
  select m.model, m.usd_per_mtok_input, m.usd_per_mtok_output,
         m.usd_per_mtok_cache_read, m.usd_per_mtok_cache_write
  into model, usd_per_mtok_input, usd_per_mtok_output,
       usd_per_mtok_cache_read, usd_per_mtok_cache_write
  from private.ai_models() m
  where m.model = coalesce(p_model, private.ai_default_model());

  -- Modelo fora do catálogo não tem preço: recusar é a única forma de nunca
  -- medir uma chamada por menos do que ela custou.
  if not found then
    raise exception 'Modelo de IA desconhecido.' using errcode = '22023', detail = 'p_model';
  end if;

  -- Câmbio: PTAX do dia + 10% (IOF e spread do cartão). AI_EXCHANGE_RATE_DEFAULT.
  exchange_rate := 5.6675;
  -- Batch API: metade do preço em tudo (entrada, saída e cache). AI_BATCH_PRICE_MULTIPLIER.
  batch_multiplier := 0.5;
end;
$$;

comment on function private.ai_pricing(text) is
  'Preço de UM modelo de IA (US$ por milhão de tokens), câmbio usado para converter em reais (5,6675 = PTAX + 10%) e multiplicador da Batch API (0,5). Sem argumento: claude-sonnet-5. Modelo fora de private.ai_models(): erro 22023 (nunca subcobrar). Espelho de packages/core/src/billing/ai-usage.ts.';

-- Custo em millicents, arredondado para cima (nunca contar menos do que custou),
-- agora pelo preço do modelo e com o desconto da Batch API.
drop function private.ai_cost_millicents(bigint, bigint, bigint, bigint);

create function private.ai_cost_millicents(
  p_input bigint,
  p_output bigint,
  p_cache_read bigint,
  p_cache_write bigint,
  p_model text default null,
  p_batch boolean default false
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select ceil(
    (greatest(coalesce(p_input, 0), 0) * p.usd_per_mtok_input
      + greatest(coalesce(p_output, 0), 0) * p.usd_per_mtok_output
      + greatest(coalesce(p_cache_read, 0), 0) * p.usd_per_mtok_cache_read
      + greatest(coalesce(p_cache_write, 0), 0) * p.usd_per_mtok_cache_write)
    / 1000000::numeric * p.exchange_rate * 100000::numeric
    * case when coalesce(p_batch, false) then p.batch_multiplier else 1::numeric end
  )::bigint
  from private.ai_pricing(p_model) p;
$$;

comment on function private.ai_cost_millicents(bigint, bigint, bigint, bigint, text, boolean) is
  'Custo em milésimos de centavo dos tokens informados, pelo preço do modelo (null = claude-sonnet-5) e com o desconto da Batch API quando p_batch. Arredonda para cima. Modelo desconhecido: erro 22023. Espelho de aiCostMillicents no core.';

revoke all on function private.ai_models() from public, anon, authenticated;
revoke all on function private.ai_default_model() from public, anon, authenticated;
revoke all on function private.ai_pricing(text) from public, anon, authenticated;
revoke all on function private.ai_cost_millicents(bigint, bigint, bigint, bigint, text, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Teto por plano e teste grátis sem IA
-- -----------------------------------------------------------------------------

-- Menor valor entre 20% do preço de tabela mensal e franquia × conversa típica
-- (R$ 0,55293, AI_TYPICAL_CONVERSATION no Sonnet 5) × 1,25, para cima em centavos:
--   imobiliaria: min(4.980; ceil(50 × 55,293 × 1,25) = 3.456)   = 3.456
--   equipe:      min(11.980; ceil(200 × 55,293 × 1,25) = 13.824) = 11.980
--   rede:        min(29.800; ceil(500 × 55,293 × 1,25) = 34.559) = 29.800
-- Valor calculado por aiCostCapCents no core: mude lá e copie para cá.
create or replace function private.ai_cost_cap_cents(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan
    when 'corretor' then 0          -- plano sem IA: nada a autorizar
    when 'imobiliaria' then 3456    -- franquia 50 × conversa típica × 1,25 (< 20% de R$ 249,00)
    when 'equipe' then 11980        -- 20% de R$ 599,00 (< franquia 200 × típica × 1,25)
    when 'rede' then 29800          -- 20% de R$ 1.490,00 (< franquia 500 × típica × 1,25)
    else 0                          -- teste grátis (sem IA) e plano desconhecido: falha fechada
  end;
$$;

comment on function private.ai_cost_cap_cents(text) is
  'Teto de custo de IA por ciclo mensal, em centavos, por imobiliária: menor valor entre 20% do preço de tabela mensal e franquia × conversa típica × 1,25 (Imobiliária 3.456, Equipe 11.980, Rede 29.800). É o MÁXIMO que o banco deixa gastar, não o gasto esperado. Corretor, teste grátis e plano desconhecido = 0. Calculado por aiCostCapCents em packages/core/src/billing/ai-usage.ts.';

-- Teste grátis: os limites e recursos do Equipe, menos a IA (TRIAL_LIMITS no core).
create or replace function private.billing_trial_defaults(out limits jsonb, out features text[])
language sql
stable
set search_path = ''
as $$
  select
    '{"users": 5, "landing_pages": 1, "owned_listings": 50, "photos_per_listing": 10, "pipelines": 10, "ai_conversations": 0}'::jsonb,
    array[
      'feature_properties', 'feature_condominiums', 'feature_listing_score',
      'feature_capture_public_form', 'feature_keys', 'feature_proposals', 'feature_clients',
      'feature_calendar_tasks', 'feature_leads_kanban', 'feature_multiple_pipelines',
      'feature_landing_pages', 'feature_portal_feed_vrsync', 'feature_team_roles_invites',
      'feature_tenant_subdomain', 'feature_data_export',
      'feature_assisted_migration'
    ]::text[];
$$;

revoke all on function private.billing_trial_defaults() from public, anon, authenticated;

-- Contas em teste local já criadas carregam a franquia antiga (10) no jsonb.
-- Só a chave ai_conversations muda; nenhum outro limite, recurso ou dado.
update public.billing_accounts as b
set limits = b.limits || '{"ai_conversations": 0}'::jsonb
where b.plan_key = 'trial'
  and b.limits -> 'ai_conversations' is distinct from '0'::jsonb;

-- Ciclo, franquia e tetos vigentes. Qualquer conta 'trialing' (teste local ou
-- teste criado na Stripe) sai com franquia 0 e tetos 0: sem IA até assinar.
create or replace function private.ai_quota_context(p_organization_id uuid, p_at timestamptz)
returns table (
  period_start timestamptz,
  period_end timestamptz,
  plan_key text,
  billing_state text,
  conversations_limit integer,
  plan_cap_millicents bigint,
  overage_cap_millicents bigint,
  effective_cap_millicents bigint,
  day_cap_millicents bigint,
  week_cap_millicents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.period_start,
    s.period_start + interval '1 month',
    b.plan_key,
    s.billing_state,
    case
      when s.billing_state = 'trialing' then 0
      -- Convenção de limits: chave ausente ou não numérica = ilimitado (null → -1).
      else coalesce(
        case
          when jsonb_typeof(b.limits -> 'ai_conversations') = 'number'
               and (b.limits ->> 'ai_conversations') ~ '^(-1|[0-9]{1,9})$'
            then (b.limits ->> 'ai_conversations')::integer
        end,
        -1
      )
    end,
    s.plan_cap_cents::bigint * 1000,
    s.overage_cap_cents::bigint * 1000,
    (s.plan_cap_cents + s.overage_cap_cents)::bigint * 1000,
    private.ai_daily_cap_cents(s.plan_cap_cents + s.overage_cap_cents)::bigint * 1000,
    private.ai_weekly_cap_cents(s.plan_cap_cents + s.overage_cap_cents)::bigint * 1000
  from public.billing_accounts b
  cross join lateral (
    select
      private.ai_period_start(coalesce(b.current_period_end, b.trial_ends_at), p_at) as period_start,
      st.billing_state,
      case when st.billing_state = 'trialing' then 0
           else private.ai_cost_cap_cents(b.plan_key) end as plan_cap_cents,
      case when st.billing_state = 'trialing' then 0
           else b.ai_overage_cap_cents end as overage_cap_cents
    from (
      select case
        when b.platform_blocked_at is not null then 'read_only'
        else private.billing_state_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end, p_at)
      end as billing_state
    ) st
  ) s
  where b.organization_id = p_organization_id;
$$;

revoke all on function private.ai_quota_context(uuid, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Reserva guarda o modelo e o lote
-- -----------------------------------------------------------------------------
alter table private.ai_usage_requests
  add column model text not null default 'claude-sonnet-5',
  add column batch boolean not null default false;

comment on column private.ai_usage_requests.model is
  'Modelo da chamada (private.ai_models). O acerto usa este modelo quando settle_ai_usage não informa outro.';
comment on column private.ai_usage_requests.batch is
  'true quando a chamada vai pela Batch API (metade do preço). O acerto usa este valor quando settle_ai_usage não informa outro.';

-- -----------------------------------------------------------------------------
-- 4. RPCs do servidor com modelo e lote (chamada antiga continua valendo)
-- -----------------------------------------------------------------------------
-- Troca a assinatura em vez de criar sobrecarga: duas versões com argumentos
-- padrão deixariam a chamada antiga ambígua no PostgREST.
drop function public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer);

-- reserve_ai_usage: a verificação que TODA feature de IA tem que chamar ANTES de
-- acionar o modelo. Mesma regra de antes (migração ai_usage_metering), com:
--   p_model  modelo da chamada (null = claude-sonnet-5); fora do catálogo → 22023;
--   p_batch  true quando vai pela Batch API (estimativa com 50% de desconto).
-- Ordem dos cortes (igual a resolveAiQuota no core):
--   1. assinatura fora de trialing/active; 2. teste grátis ou plano sem IA
--   (feature_unavailable); 3. tamanho; 4. rajada; 5. dia; 6. semana;
--   7. ciclo (plano + excedente); 8. franquia.
-- Retorno: o mesmo jsonb de antes, mais model e batch.
create function public.reserve_ai_usage(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_kind text default null,
  p_units integer default 1,
  p_user_id uuid default null,
  p_contact_key text default null,
  p_digest text default null,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_cache_read_tokens integer default 0,
  p_cache_write_tokens integer default 0,
  p_model text default null,
  p_batch boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  ctx record;
  v_row public.ai_usage_periods%rowtype;
  v_now constant timestamptz := now();
  v_today date;
  v_week date;
  v_units integer;
  v_estimate bigint;
  v_model text;
  v_batch boolean;
  v_allowed boolean := true;
  v_reason text := null;
  v_in_overage boolean := false;
  v_reservation uuid := null;
  v_response text := null;
  v_notify text := null;
  v_ratio numeric;
  v_recent integer;
  v_day_cost bigint;
  v_week_cost bigint;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select * into l from private.ai_limits();

  if p_kind is null
     or p_kind not in ('conversation', 'listing_copy', 'conversation_summary', 'reply_suggestion') then
    perform private.billing_invalid_field('p_kind');
  end if;

  if p_units is null or p_units < 1 or p_units > 100 then
    perform private.billing_invalid_field('p_units');
  end if;

  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0
     or coalesce(p_cache_read_tokens, 0) < 0 or coalesce(p_cache_write_tokens, 0) < 0 then
    perform private.billing_invalid_field('p_input_tokens');
  end if;

  if p_contact_key is not null and p_contact_key !~ '^[a-f0-9]{64}$' then
    perform private.billing_invalid_field('p_contact_key');
  end if;

  if p_digest is not null and p_digest !~ '^[a-f0-9]{64}$' then
    perform private.billing_invalid_field('p_digest');
  end if;

  -- Modelo fora do catálogo não tem preço: recusa antes de qualquer conta.
  if p_model is not null
     and not exists (select 1 from private.ai_models() m where m.model = p_model) then
    perform private.billing_invalid_field('p_model');
  end if;

  v_model := coalesce(p_model, private.ai_default_model());
  v_batch := coalesce(p_batch, false);

  select * into ctx from private.ai_quota_context(p_organization_id, v_now);

  if not found then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  v_today := (v_now at time zone 'America/Sao_Paulo')::date;
  v_week := (date_trunc('week', v_now at time zone 'America/Sao_Paulo'))::date;

  -- Estimativa cobrada antes da chamada, com piso: estimativa zerada não pode
  -- furar o teto. O acerto (settle_ai_usage) devolve a diferença.
  v_estimate := greatest(
    private.ai_cost_millicents(
      coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
      coalesce(p_cache_read_tokens, 0), coalesce(p_cache_write_tokens, 0),
      v_model, v_batch
    ),
    l.min_reservation_millicents
  );

  -- Cortes que não dependem do consumo acumulado (sem tocar na linha do ciclo).
  if ctx.billing_state not in ('trialing', 'active') then
    v_allowed := false;
    v_reason := 'billing_blocked';
  elsif ctx.billing_state = 'trialing' or ctx.conversations_limit = 0 then
    -- Teste grátis não tem IA (a IA começa quando a imobiliária assina) e o
    -- plano sem franquia também não: nenhum token é gasto.
    v_allowed := false;
    v_reason := 'feature_unavailable';
  elsif coalesce(p_input_tokens, 0) > l.max_input_tokens
        or coalesce(p_output_tokens, 0) > l.max_output_tokens then
    v_allowed := false;
    v_reason := 'request_too_large';
  end if;

  if v_allowed then
    -- Trava a linha do ciclo: daqui até o commit, esta imobiliária é serializada.
    insert into public.ai_usage_periods (organization_id, period_start, period_end)
    values (p_organization_id, ctx.period_start, ctx.period_end)
    on conflict (organization_id, period_start) do update
    set period_end = excluded.period_end
    returning * into v_row;
  else
    -- Já bloqueado antes de qualquer contagem: só lê, sem criar linha.
    select * into v_row
    from public.ai_usage_periods p
    where p.organization_id = p_organization_id
      and p.period_start = ctx.period_start;
  end if;

  if v_row.organization_id is null then
    v_row.conversations := 0;
    v_row.requests := 0;
    v_row.cost_millicents := 0;
    v_row.day_cost_millicents := 0;
    v_row.week_cost_millicents := 0;
  end if;

  -- Rolagem das janelas curtas.
  v_day_cost := case when v_row.day_start = v_today then v_row.day_cost_millicents else 0 end;
  v_week_cost := case when v_row.week_start = v_week then v_row.week_cost_millicents else 0 end;

  -- Deduplicação: requisição idêntica já respondida na janela devolve a mesma
  -- resposta, sem cobrar nada e sem chamar o modelo.
  if v_allowed and p_digest is not null then
    select r.response into v_response
    from private.ai_usage_requests r
    where r.organization_id = p_organization_id
      and r.digest = p_digest
      and r.response is not null
      and r.settled_at is not null
      and r.created_at > v_now - make_interval(mins => l.dedupe_minutes)
    order by r.created_at desc
    limit 1;
  end if;

  -- Rajada: impede laço automatizado queimando o teto do dia em segundos.
  if v_allowed and v_response is null then
    select count(*)::integer into v_recent
    from private.ai_usage_requests r
    where r.organization_id = p_organization_id
      and r.created_at > v_now - interval '1 minute';

    if v_recent >= l.organization_per_minute then
      v_allowed := false;
      v_reason := 'rate_limited_organization';
    elsif p_user_id is not null then
      select count(*)::integer into v_recent
      from private.ai_usage_requests r
      where r.organization_id = p_organization_id
        and r.user_id = p_user_id
        and r.created_at > v_now - interval '1 minute';

      if v_recent >= l.user_per_minute then
        v_allowed := false;
        v_reason := 'rate_limited_user';
      end if;
    end if;
  end if;

  -- Unidades da franquia: uma janela de 24 h com o mesmo contato conta UMA vez.
  v_units := private.ai_unit_weight(p_kind) * p_units;

  if p_kind = 'conversation' and p_contact_key is not null then
    v_units := case
      when exists (
        select 1
        from private.ai_conversation_windows w
        where w.organization_id = p_organization_id
          and w.contact_key = p_contact_key
          and w.period_start = ctx.period_start
          and w.expires_at > v_now
      ) then 0
      else private.ai_unit_weight(p_kind)
    end;
  end if;

  -- Tetos, na ordem: dia, semana, ciclo (plano + excedente) e franquia.
  v_in_overage :=
    (ctx.conversations_limit > 0 and v_row.conversations + v_units > ctx.conversations_limit)
    or (v_row.cost_millicents + v_estimate > ctx.plan_cap_millicents);

  if v_allowed and v_response is null then
    if v_day_cost + v_estimate > ctx.day_cap_millicents then
      v_allowed := false;
      v_reason := 'daily_cost_cap';
    elsif v_week_cost + v_estimate > ctx.week_cap_millicents then
      v_allowed := false;
      v_reason := 'weekly_cost_cap';
    elsif v_row.cost_millicents + v_estimate > ctx.effective_cap_millicents then
      v_allowed := false;
      v_reason := case when ctx.overage_cap_millicents > 0 then 'overage_cap' else 'cycle_cost_cap' end;
    elsif ctx.conversations_limit > 0
          and v_row.conversations + v_units > ctx.conversations_limit
          and ctx.overage_cap_millicents = 0 then
      v_allowed := false;
      v_reason := 'quota_exhausted';
    end if;
  end if;

  if v_allowed and v_response is null then
    insert into private.ai_usage_requests (
      organization_id, period_start, kind, user_id, digest, units,
      estimated_millicents, day_start, week_start, model, batch
    )
    values (
      p_organization_id, ctx.period_start, p_kind, p_user_id, p_digest, v_units,
      v_estimate, v_today, v_week, v_model, v_batch
    )
    returning id into v_reservation;

    v_day_cost := v_day_cost + v_estimate;
    v_week_cost := v_week_cost + v_estimate;

    update public.ai_usage_periods p
    set conversations = p.conversations + v_units,
        requests = p.requests + 1,
        cost_millicents = p.cost_millicents + v_estimate,
        day_start = v_today,
        day_cost_millicents = v_day_cost,
        week_start = v_week,
        week_cost_millicents = v_week_cost,
        updated_at = v_now
    where p.organization_id = p_organization_id
      and p.period_start = ctx.period_start
    returning * into v_row;

    if p_kind = 'conversation' and p_contact_key is not null then
      if v_units > 0 then
        insert into private.ai_conversation_windows (
          organization_id, contact_key, period_start, opened_at, expires_at, requests
        )
        values (
          p_organization_id, p_contact_key, ctx.period_start, v_now,
          v_now + make_interval(hours => l.conversation_hours), 1
        )
        on conflict (organization_id, contact_key) do update
        set period_start = excluded.period_start,
            opened_at = excluded.opened_at,
            expires_at = excluded.expires_at,
            requests = 1;
      else
        update private.ai_conversation_windows w
        set requests = w.requests + 1
        where w.organization_id = p_organization_id
          and w.contact_key = p_contact_key;
      end if;
    end if;
  end if;

  -- Aviso de franquia: a maior fração entre conversas e reais, um de cada por ciclo.
  v_ratio := greatest(
    case when ctx.conversations_limit > 0
      then v_row.conversations::numeric / ctx.conversations_limit else 0 end,
    case when ctx.effective_cap_millicents > 0
      then v_row.cost_millicents::numeric / ctx.effective_cap_millicents else 0 end
  );

  if v_ratio >= 1 and v_row.notified_100_at is null then
    v_notify := '100';
    update public.ai_usage_periods p
    set notified_100_at = v_now, notified_80_at = coalesce(p.notified_80_at, v_now)
    where p.organization_id = p_organization_id and p.period_start = ctx.period_start;
  elsif v_ratio >= l.warning_ratio and v_row.notified_80_at is null then
    v_notify := '80';
    update public.ai_usage_periods p
    set notified_80_at = v_now
    where p.organization_id = p_organization_id and p.period_start = ctx.period_start;
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'duplicate', v_response is not null,
    'response', v_response,
    'reservation_id', v_reservation,
    'in_overage', v_in_overage,
    'model', v_model,
    'batch', v_batch,
    'period_start', ctx.period_start,
    'period_end', ctx.period_end,
    'plan_key', ctx.plan_key,
    'billing_state', ctx.billing_state,
    'conversations_limit', ctx.conversations_limit,
    'conversations_used', v_row.conversations,
    'conversations_remaining',
      case when ctx.conversations_limit < 0 then null
           else greatest(0, ctx.conversations_limit - v_row.conversations) end,
    'cost_cents', round(v_row.cost_millicents / 1000.0)::integer,
    'plan_cap_cents', (ctx.plan_cap_millicents / 1000)::integer,
    'overage_cap_cents', (ctx.overage_cap_millicents / 1000)::integer,
    'effective_cap_cents', (ctx.effective_cap_millicents / 1000)::integer,
    'remaining_cents',
      greatest(0, round((ctx.effective_cap_millicents - v_row.cost_millicents) / 1000.0))::integer,
    'day_cost_cents', round(v_day_cost / 1000.0)::integer,
    'day_cap_cents', (ctx.day_cap_millicents / 1000)::integer,
    'week_cost_cents', round(v_week_cost / 1000.0)::integer,
    'week_cap_cents', (ctx.week_cap_millicents / 1000)::integer,
    'estimated_cost_cents', round(v_estimate / 1000.0)::integer,
    'notify', v_notify
  );
end;
$$;

comment on function public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer, text, boolean) is
  'Servidor Next (chave publishable + billing_server_key): reserva o custo estimado de uma chamada de IA ANTES de acionar o modelo e decide se libera. p_model (null = claude-sonnet-5, fora do catálogo = 22023) e p_batch (Batch API, metade do preço) entram na estimativa. Teste grátis e plano sem franquia: feature_unavailable.';

revoke all on function public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer, text, boolean) to anon;

drop function public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text);

-- settle_ai_usage: acerto depois da chamada, SEMPRE (inclusive falha ou
-- cancelamento). Troca a estimativa pelo custo real, pelo preço do modelo usado:
--   p_model  null = o modelo gravado na reserva; fora do catálogo → 22023;
--   p_batch  null = o valor gravado na reserva.
-- Idempotente: a mesma reserva só é acertada uma vez.
create function public.settle_ai_usage(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_reservation_id uuid default null,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_cache_read_tokens integer default 0,
  p_cache_write_tokens integer default 0,
  p_status text default 'ok',
  p_response text default null,
  p_model text default null,
  p_batch boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  ctx record;
  v_request private.ai_usage_requests%rowtype;
  v_row public.ai_usage_periods%rowtype;
  v_now constant timestamptz := now();
  v_today date;
  v_week date;
  v_model text;
  v_batch boolean;
  v_actual bigint;
  v_delta bigint;
  v_notify text := null;
  v_ratio numeric;
begin
  if not private.billing_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('ok', 'failed', 'aborted') then
    perform private.billing_invalid_field('p_status');
  end if;

  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0
     or coalesce(p_cache_read_tokens, 0) < 0 or coalesce(p_cache_write_tokens, 0) < 0 then
    perform private.billing_invalid_field('p_input_tokens');
  end if;

  if p_model is not null
     and not exists (select 1 from private.ai_models() m where m.model = p_model) then
    perform private.billing_invalid_field('p_model');
  end if;

  select * into l from private.ai_limits();

  select * into v_request
  from private.ai_usage_requests r
  where r.id = p_reservation_id
    and r.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Reserva de IA não encontrada.' using errcode = 'P0002';
  end if;

  if v_request.settled_at is not null then
    return jsonb_build_object('settled', false, 'reason', 'already_settled');
  end if;

  v_model := coalesce(p_model, v_request.model);
  v_batch := coalesce(p_batch, v_request.batch);

  v_actual := private.ai_cost_millicents(
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
    coalesce(p_cache_read_tokens, 0), coalesce(p_cache_write_tokens, 0),
    v_model, v_batch
  );
  v_delta := v_actual - v_request.estimated_millicents;

  update private.ai_usage_requests r
  set settled_at = v_now,
      status = p_status,
      model = v_model,
      batch = v_batch,
      response = case
        when p_status = 'ok' and r.digest is not null and p_response is not null
          then left(p_response, l.response_max_length)
      end
  where r.id = v_request.id;

  v_today := (v_now at time zone 'America/Sao_Paulo')::date;
  v_week := (date_trunc('week', v_now at time zone 'America/Sao_Paulo'))::date;

  update public.ai_usage_periods p
  set input_tokens = p.input_tokens + greatest(coalesce(p_input_tokens, 0), 0),
      output_tokens = p.output_tokens + greatest(coalesce(p_output_tokens, 0), 0),
      cache_read_tokens = p.cache_read_tokens + greatest(coalesce(p_cache_read_tokens, 0), 0),
      cache_write_tokens = p.cache_write_tokens + greatest(coalesce(p_cache_write_tokens, 0), 0),
      cost_millicents = greatest(0, p.cost_millicents + v_delta),
      day_cost_millicents = case
        when p.day_start = v_today then greatest(0, p.day_cost_millicents + v_delta)
        else p.day_cost_millicents end,
      week_cost_millicents = case
        when p.week_start = v_week then greatest(0, p.week_cost_millicents + v_delta)
        else p.week_cost_millicents end,
      updated_at = v_now
  where p.organization_id = p_organization_id
    and p.period_start = v_request.period_start
  returning * into v_row;

  if not found then
    return jsonb_build_object('settled', true, 'reason', 'period_missing');
  end if;

  select * into ctx from private.ai_quota_context(p_organization_id, v_now);

  if found then
    v_ratio := greatest(
      case when ctx.conversations_limit > 0
        then v_row.conversations::numeric / ctx.conversations_limit else 0 end,
      case when ctx.effective_cap_millicents > 0
        then v_row.cost_millicents::numeric / ctx.effective_cap_millicents else 0 end
    );

    if v_ratio >= 1 and v_row.notified_100_at is null then
      v_notify := '100';
      update public.ai_usage_periods p
      set notified_100_at = v_now, notified_80_at = coalesce(p.notified_80_at, v_now)
      where p.organization_id = p_organization_id and p.period_start = v_row.period_start;
    elsif v_ratio >= l.warning_ratio and v_row.notified_80_at is null then
      v_notify := '80';
      update public.ai_usage_periods p
      set notified_80_at = v_now
      where p.organization_id = p_organization_id and p.period_start = v_row.period_start;
    end if;
  end if;

  return jsonb_build_object(
    'settled', true,
    'reason', null,
    'model', v_model,
    'batch', v_batch,
    'cost_cents', round(v_row.cost_millicents / 1000.0)::integer,
    'actual_cost_cents', round(v_actual / 1000.0)::integer,
    'conversations_used', v_row.conversations,
    'period_start', v_row.period_start,
    'period_end', v_row.period_end,
    'notify', v_notify
  );
end;
$$;

comment on function public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text, text, boolean) is
  'Servidor Next (chave publishable + billing_server_key): acerta a reserva de IA depois da chamada, pelo preço do modelo usado (p_model; null = o da reserva; fora do catálogo = 22023) e com o desconto da Batch API (p_batch; null = o da reserva). Idempotente.';

revoke all on function public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text, text, boolean) to anon;

-- -----------------------------------------------------------------------------
-- 5. Console: os dois modelos e o desconto do lote em platform_ai_costs
-- -----------------------------------------------------------------------------
create or replace function public.platform_ai_costs(p_server_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now constant timestamptz := now();
  v_pricing jsonb;
  v_models jsonb;
  v_caps jsonb;
  v_organizations jsonb;
  v_accounts integer;
  v_with_ai integer;
begin
  perform private.check_platform_server_key(p_server_key);

  -- `pricing` continua sendo o modelo padrão (o mais caro), com câmbio e lote.
  select jsonb_build_object(
    'model', p.model,
    'usd_per_mtok_input', p.usd_per_mtok_input,
    'usd_per_mtok_output', p.usd_per_mtok_output,
    'usd_per_mtok_cache_read', p.usd_per_mtok_cache_read,
    'usd_per_mtok_cache_write', p.usd_per_mtok_cache_write,
    'exchange_rate', p.exchange_rate,
    'batch_multiplier', p.batch_multiplier
  )
  into v_pricing
  from private.ai_pricing() p;

  select coalesce(jsonb_agg(jsonb_build_object(
    'model', m.model,
    'label', m.label,
    'usd_per_mtok_input', m.usd_per_mtok_input,
    'usd_per_mtok_output', m.usd_per_mtok_output,
    'usd_per_mtok_cache_read', m.usd_per_mtok_cache_read,
    'usd_per_mtok_cache_write', m.usd_per_mtok_cache_write,
    'usd_per_mtok_cache_write_1h', m.usd_per_mtok_cache_write_1h
  ) order by m.usd_per_mtok_output desc, m.model), '[]'::jsonb)
  into v_models
  from private.ai_models() m;

  select jsonb_object_agg(k.plan_key, private.ai_cost_cap_cents(k.plan_key))
  into v_caps
  from unnest(array['trial', 'corretor', 'imobiliaria', 'equipe', 'rede']) as k(plan_key);

  with ctx as (
    select
      b.organization_id,
      o.name,
      c.period_start,
      c.period_end,
      c.plan_key,
      c.billing_state,
      c.conversations_limit,
      c.plan_cap_millicents,
      c.effective_cap_millicents
    from public.billing_accounts b
    join public.organizations o on o.id = b.organization_id
    cross join lateral private.ai_quota_context(b.organization_id, v_now) c
  ),
  org_usage as (
    select
      ctx.*,
      (
        select jsonb_build_object(
          'period_start', p.period_start,
          'period_end', p.period_end,
          'conversations', p.conversations,
          'requests', p.requests,
          'input_tokens', p.input_tokens,
          'output_tokens', p.output_tokens,
          'cache_read_tokens', p.cache_read_tokens,
          'cache_write_tokens', p.cache_write_tokens,
          'cost_millicents', p.cost_millicents
        )
        from public.ai_usage_periods p
        where p.organization_id = ctx.organization_id
          and p.period_start = ctx.period_start
      ) as current_usage,
      (
        select jsonb_build_object(
          'period_start', p.period_start,
          'period_end', p.period_end,
          'conversations', p.conversations,
          'requests', p.requests,
          'input_tokens', p.input_tokens,
          'output_tokens', p.output_tokens,
          'cache_read_tokens', p.cache_read_tokens,
          'cache_write_tokens', p.cache_write_tokens,
          'cost_millicents', p.cost_millicents
        )
        from public.ai_usage_periods p
        where p.organization_id = ctx.organization_id
          and (ctx.period_start is null or p.period_start < ctx.period_start)
        order by p.period_start desc
        limit 1
      ) as previous_usage
    from ctx
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'organization_id', u.organization_id,
      'organization_name', u.name,
      'plan_key', u.plan_key,
      'billing_state', u.billing_state,
      'conversations_limit', u.conversations_limit,
      'plan_cap_cents', (u.plan_cap_millicents / 1000)::integer,
      'effective_cap_cents', (u.effective_cap_millicents / 1000)::integer,
      'current_period_start', u.period_start,
      'current_period_end', u.period_end,
      'current', u.current_usage,
      'previous', u.previous_usage
    ) order by coalesce((u.current_usage ->> 'cost_millicents')::bigint, 0) desc, u.name)
      filter (where u.current_usage is not null or u.previous_usage is not null), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where u.conversations_limit <> 0)::integer
  into v_organizations, v_accounts, v_with_ai
  from org_usage u;

  return jsonb_build_object(
    'generated_at', v_now,
    'pricing', v_pricing,
    'models', v_models,
    'plan_caps_cents', v_caps,
    'organizations_total', v_accounts,
    'organizations_with_ai', v_with_ai,
    'organizations', v_organizations
  );
end;
$$;

comment on function public.platform_ai_costs(text) is
  'Servidor Next (chave publishable + PLATFORM_SERVER_KEY), depois de conferir o e-mail da equipe: custo real de IA por imobiliária no ciclo atual (o da trava, private.ai_quota_context) e no anterior, com tokens, conversas, requisições e cost_millicents exatamente como gravados; teto do plano atual; preço do modelo padrão com câmbio e multiplicador da Batch API (private.ai_pricing), preço de todos os modelos (private.ai_models) e tetos por plano (private.ai_cost_cap_cents). Conta em teste grátis aparece sem IA. Só números, sem conteúdo de conversa.';
