-- =============================================================================
-- 1600 - Medição e corte de IA (o custo trava antes da conversa)
-- =============================================================================
-- Regra do dono: o produto não pode ter prejuízo com IA em nenhum plano, em
-- nenhuma hipótese. Por isso a trava principal é um TETO DE CUSTO EM REAIS por
-- ciclo, acima de qualquer contagem de conversa: a franquia de conversas é o
-- rótulo comercial, o teto em reais é o que garante a margem.
--
--  1. Constantes (preço do modelo, câmbio, tetos, limites de rajada)
--  2. billing_accounts.ai_overage_cap_cents (teto de excedente da imobiliária)
--  3. Tabelas: public.ai_usage_periods (1 linha por imobiliária por ciclo),
--     private.ai_usage_requests (reserva + deduplicação, efêmera) e
--     private.ai_conversation_windows (janela de 24 h por contato)
--  4. RLS e grants (sessão só LÊ o consumo; escrita só pelas RPCs)
--  5. Helpers: ciclo mensal ancorado na assinatura, custo, tetos e decisão
--  6. RPCs do servidor (ai_server_key = billing_server_key): reserve_ai_usage
--     e settle_ai_usage
--  7. RPCs com sessão: get_ai_usage_overview e set_ai_overage_cap
--  8. Limpeza agendada (pg_cron)
--
-- Espelho de packages/core/src/billing/ai-usage.ts: ao mudar preço, câmbio,
-- porcentagem do teto, pesos ou limites, mude nos DOIS lugares (os testes do
-- core conferem os números).
--
-- Unidade de custo: MILÉSIMO DE CENTAVO (millicent). Uma requisição avulsa
-- custa fração de centavo; arredondar cada uma para o centavo inflaria a conta
-- do cliente em até ~20%. As RPCs e a tela expõem centavos.

-- -----------------------------------------------------------------------------
-- 1. Constantes
-- -----------------------------------------------------------------------------

-- Modelo fixo: claude-sonnet-5 (contexto de 1M). Preço oficial consultado em
-- 2026-09-16, em US$ por milhão de tokens: entrada 2,00; saída 10,00; leitura
-- de cache 0,20 (10% da entrada); escrita de cache 2,50 (1,25x a entrada).
-- Preço muda: confira antes de reajustar planos.
-- Câmbio configurável: PTAX do dia 5,1490; dólar efetivo de cartão 5,60. O
-- padrão é o de cartão — superestimar o câmbio protege a margem.
create or replace function private.ai_pricing(
  out model text,
  out usd_per_mtok_input numeric,
  out usd_per_mtok_output numeric,
  out usd_per_mtok_cache_read numeric,
  out usd_per_mtok_cache_write numeric,
  out exchange_rate numeric
)
language sql
immutable
set search_path = ''
as $$
  select 'claude-sonnet-5', 2::numeric, 10::numeric, 0.2::numeric, 2.5::numeric, 5.6::numeric;
$$;

comment on function private.ai_pricing() is
  'Preço do modelo de IA (US$ por milhão de tokens, tabela de 2026-09-16) e câmbio usado para converter em reais. Espelho de AI_PRICE_USD_PER_MTOK/AI_EXCHANGE_RATES em packages/core/src/billing/ai-usage.ts.';

-- Limites de uso. Espelho das constantes do core.
create or replace function private.ai_limits(
  out max_input_tokens integer,
  out max_output_tokens integer,
  out organization_per_minute integer,
  out user_per_minute integer,
  out dedupe_minutes integer,
  out conversation_hours integer,
  out daily_divisor integer,
  out weekly_divisor integer,
  out min_daily_cap_cents integer,
  out min_weekly_cap_cents integer,
  out min_reservation_millicents bigint,
  out max_overage_cap_cents integer,
  out warning_ratio numeric,
  out response_max_length integer
)
language sql
immutable
set search_path = ''
as $$
  select 12000, 1500, 10, 4, 10, 24, 15, 4, 50, 150, 1400::bigint, 500000, 0.8::numeric, 8000;
$$;

comment on function private.ai_limits() is
  'Tetos por requisição, rajada por minuto, janelas de deduplicação e de conversa, divisores das janelas curtas e teto máximo de excedente. Espelho de packages/core/src/billing/ai-usage.ts.';

-- Teto de custo do ciclo por plano, em centavos: 15% do PREÇO DE TABELA MENSAL.
-- Sempre o preço de tabela, nunca o valor cobrado:
--   * Indique e ganhe: quem acumula 100% de desconto paga R$ 0, mas as
--     indicações dele pagam; usar o valor com desconto deixaria esse cliente
--     sem IA nenhuma;
--   * no plano anual a franquia continua mensal (o ciclo de IA é mensal,
--     ancorado no dia da assinatura), então o teto também é mensal.
-- Espelho de aiCostCapCents no core (AI_COST_CAP_PCT = 0,15).
create or replace function private.ai_cost_cap_cents(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan
    when 'corretor' then 1335      -- 15% de R$ 89,00
    when 'imobiliaria' then 3735   -- 15% de R$ 249,00
    when 'equipe' then 8985        -- 15% de R$ 599,00
    when 'rede' then 22350         -- 15% de R$ 1.490,00
    else 300                       -- teste grátis (e plano desconhecido): R$ 3,00
  end;
$$;

-- Teto do dia (1/15 do ciclo) e da semana (1/4), com piso e nunca acima do
-- ciclo: sem o piso, num teto pequeno a fração diária não pagaria nem uma
-- conversa e o corte do dia viraria o corte real.
create or replace function private.ai_daily_cap_cents(p_cycle_cap_cents integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(
    greatest(coalesce(p_cycle_cap_cents, 0), 0),
    greatest(ceil(greatest(coalesce(p_cycle_cap_cents, 0), 0)::numeric / l.daily_divisor)::integer,
             l.min_daily_cap_cents)
  )
  from private.ai_limits() l;
$$;

create or replace function private.ai_weekly_cap_cents(p_cycle_cap_cents integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(
    greatest(coalesce(p_cycle_cap_cents, 0), 0),
    greatest(ceil(greatest(coalesce(p_cycle_cap_cents, 0), 0)::numeric / l.weekly_divisor)::integer,
             l.min_weekly_cap_cents)
  )
  from private.ai_limits() l;
$$;

-- Custo em millicents dos tokens informados, arredondado para cima (nunca
-- contar menos do que custou).
create or replace function private.ai_cost_millicents(
  p_input bigint,
  p_output bigint,
  p_cache_read bigint,
  p_cache_write bigint
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
  )::bigint
  from private.ai_pricing() p;
$$;

-- Peso de cada tipo na franquia (espelho de AI_UNIT_WEIGHTS no core). Tipo
-- desconhecido nunca chega aqui: a RPC valida antes.
create or replace function private.ai_unit_weight(p_kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'conversation' then 1
    when 'listing_copy' then 1
    when 'conversation_summary' then 1
    when 'reply_suggestion' then 1
    else 1
  end;
$$;

revoke all on function private.ai_pricing() from public, anon, authenticated;
revoke all on function private.ai_limits() from public, anon, authenticated;
revoke all on function private.ai_cost_cap_cents(text) from public, anon, authenticated;
revoke all on function private.ai_daily_cap_cents(integer) from public, anon, authenticated;
revoke all on function private.ai_weekly_cap_cents(integer) from public, anon, authenticated;
revoke all on function private.ai_cost_millicents(bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function private.ai_unit_weight(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Teto de excedente, junto da conta de cobrança
-- -----------------------------------------------------------------------------
alter table public.billing_accounts
  add column ai_overage_cap_cents integer not null default 0
    constraint billing_accounts_ai_overage_cap_cents_check
      check (ai_overage_cap_cents between 0 and 500000);

comment on column public.billing_accounts.ai_overage_cap_cents is
  'Teto de excedente de IA por ciclo, em centavos, definido pela imobiliária (0 = não permitir excedente). Somado ao teto do plano. Gravado só pela RPC set_ai_overage_cap (dono ou gerente).';

-- Membros leem o teto (cartão de uso de IA na assinatura).
grant select (ai_overage_cap_cents) on public.billing_accounts to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Tabelas
-- -----------------------------------------------------------------------------

-- Consumo: UMA linha por imobiliária por ciclo (nunca uma linha por
-- requisição). As janelas de dia e semana moram na mesma linha e são zeradas
-- quando o dia/semana vira (fuso America/Sao_Paulo: "por dia" é o dia do
-- corretor, não o dia UTC).
create table public.ai_usage_periods (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  conversations integer not null default 0
    constraint ai_usage_periods_conversations_check check (conversations >= 0),
  requests integer not null default 0
    constraint ai_usage_periods_requests_check check (requests >= 0),
  input_tokens bigint not null default 0
    constraint ai_usage_periods_input_tokens_check check (input_tokens >= 0),
  output_tokens bigint not null default 0
    constraint ai_usage_periods_output_tokens_check check (output_tokens >= 0),
  cache_read_tokens bigint not null default 0
    constraint ai_usage_periods_cache_read_tokens_check check (cache_read_tokens >= 0),
  cache_write_tokens bigint not null default 0
    constraint ai_usage_periods_cache_write_tokens_check check (cache_write_tokens >= 0),
  cost_millicents bigint not null default 0
    constraint ai_usage_periods_cost_millicents_check check (cost_millicents >= 0),
  day_start date,
  day_cost_millicents bigint not null default 0
    constraint ai_usage_periods_day_cost_check check (day_cost_millicents >= 0),
  week_start date,
  week_cost_millicents bigint not null default 0
    constraint ai_usage_periods_week_cost_check check (week_cost_millicents >= 0),
  notified_80_at timestamptz,
  notified_100_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_usage_periods_pkey primary key (organization_id, period_start),
  constraint ai_usage_periods_period_check check (period_end > period_start)
);

comment on table public.ai_usage_periods is
  'Consumo de IA por imobiliária e por ciclo de cobrança (1 linha por ciclo). Conversas e requisições são a franquia comercial; tokens e cost_millicents são o custo real. Escrita só pelas RPCs reserve_ai_usage/settle_ai_usage.';
comment on column public.ai_usage_periods.cost_millicents is
  'Custo estimado do ciclo em milésimos de centavo (1.000 = R$ 0,01). Inclui as reservas ainda não acertadas.';
comment on column public.ai_usage_periods.conversations is
  'Unidades da franquia consumidas: uma janela de 24 h com o mesmo contato conta 1; cada requisição avulsa conta o peso do tipo.';

-- Reserva e deduplicação: linhas EFÊMERAS (limpas pelo cron). Existem para
-- (a) tornar o acerto idempotente, (b) contar a rajada do último minuto e
-- (c) devolver a resposta de uma requisição idêntica sem chamar o modelo.
create table private.ai_usage_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period_start timestamptz not null,
  kind text not null,
  user_id uuid,
  digest text
    constraint ai_usage_requests_digest_format check (digest ~ '^[a-f0-9]{64}$'),
  units integer not null default 0,
  estimated_millicents bigint not null default 0,
  day_start date not null,
  week_start date not null,
  status text,
  response text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

comment on table private.ai_usage_requests is
  'Reservas de IA em voo e deduplicação (janela de minutos). Efêmera: private.cleanup_ai_usage_requests apaga o que passou de 2 dias. O consumo acumulado fica em public.ai_usage_periods.';

create index ai_usage_requests_organization_created_idx
  on private.ai_usage_requests (organization_id, created_at desc);
create index ai_usage_requests_user_created_idx
  on private.ai_usage_requests (organization_id, user_id, created_at desc)
  where user_id is not null;
create index ai_usage_requests_digest_idx
  on private.ai_usage_requests (organization_id, digest, created_at desc)
  where digest is not null;
create index ai_usage_requests_created_at_idx
  on private.ai_usage_requests (created_at);

-- Janela de conversa: 1 linha por contato (não por mensagem). "Conversa" = 24 h
-- com o mesmo contato, o padrão do WhatsApp. contact_key é um hash do contato
-- calculado pelo servidor: o telefone nunca entra aqui.
create table private.ai_conversation_windows (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_key text not null
    constraint ai_conversation_windows_contact_key_format check (contact_key ~ '^[a-f0-9]{64}$'),
  period_start timestamptz not null,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  requests integer not null default 0,
  constraint ai_conversation_windows_pkey primary key (organization_id, contact_key)
);

comment on table private.ai_conversation_windows is
  'Janela de 24 h por contato que define quando uma nova conversa de IA é contada. contact_key é hash (sha-256) do contato; o telefone nunca é gravado.';

create index ai_conversation_windows_expires_at_idx
  on private.ai_conversation_windows (expires_at);

-- -----------------------------------------------------------------------------
-- 4. RLS e grants
-- -----------------------------------------------------------------------------
alter table public.ai_usage_periods enable row level security;

create policy "ai_usage_periods: membros leem"
  on public.ai_usage_periods for select to authenticated
  using (private.is_member(organization_id));

-- Nenhuma escrita com sessão: quem grava são as RPCs (security definer).
revoke all on public.ai_usage_periods from public, anon, authenticated;
grant select on public.ai_usage_periods to authenticated;

alter table private.ai_usage_requests enable row level security;
revoke all on table private.ai_usage_requests from public, anon, authenticated;

alter table private.ai_conversation_windows enable row level security;
revoke all on table private.ai_conversation_windows from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Helpers do ciclo
-- -----------------------------------------------------------------------------

-- Início do ciclo mensal de IA: o ciclo acompanha a ASSINATURA, não o mês
-- civil. A âncora é current_period_end (ou trial_ends_at enquanto não há
-- assinatura), recuada de mês em mês até cair antes de p_at. No plano mensal
-- coincide com a fatura; no anual a franquia continua virando todo mês, no
-- mesmo dia do ciclo.
create or replace function private.ai_period_start(p_anchor timestamptz, p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_months integer;
  v_start timestamptz;
begin
  if p_anchor is null or p_at is null then
    return null;
  end if;

  v_months := (extract(year from p_at)::integer - extract(year from p_anchor)::integer) * 12
    + (extract(month from p_at)::integer - extract(month from p_anchor)::integer);
  v_start := p_anchor + make_interval(months => v_months);

  -- Ajuste de no máximo um passo em cada direção (dia do mês e fim de mês).
  while v_start > p_at loop
    v_months := v_months - 1;
    v_start := p_anchor + make_interval(months => v_months);
  end loop;

  while v_start + interval '1 month' <= p_at loop
    v_months := v_months + 1;
    v_start := p_anchor + make_interval(months => v_months);
  end loop;

  return v_start;
end;
$$;

revoke all on function private.ai_period_start(timestamptz, timestamptz) from public, anon, authenticated;

-- Ciclo, franquia e tetos vigentes da imobiliária. Sem linha em
-- billing_accounts: read_only e franquia zero (falha fechada).
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
    private.ai_period_start(coalesce(b.current_period_end, b.trial_ends_at), p_at),
    private.ai_period_start(coalesce(b.current_period_end, b.trial_ends_at), p_at) + interval '1 month',
    b.plan_key,
    private.billing_state_at(b.status, b.plan_key, b.trial_ends_at, b.current_period_end, p_at),
    -- Convenção de limits: chave ausente ou não numérica = ilimitado (null → -1).
    coalesce(
      case
        when jsonb_typeof(b.limits -> 'ai_conversations') = 'number'
             and (b.limits ->> 'ai_conversations') ~ '^(-1|[0-9]{1,9})$'
          then (b.limits ->> 'ai_conversations')::integer
      end,
      -1
    ),
    private.ai_cost_cap_cents(b.plan_key)::bigint * 1000,
    b.ai_overage_cap_cents::bigint * 1000,
    (private.ai_cost_cap_cents(b.plan_key) + b.ai_overage_cap_cents)::bigint * 1000,
    private.ai_daily_cap_cents(private.ai_cost_cap_cents(b.plan_key) + b.ai_overage_cap_cents)::bigint * 1000,
    private.ai_weekly_cap_cents(private.ai_cost_cap_cents(b.plan_key) + b.ai_overage_cap_cents)::bigint * 1000
  from public.billing_accounts b
  where b.organization_id = p_organization_id;
$$;

revoke all on function private.ai_quota_context(uuid, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. RPCs do servidor (chave billing_server_key, a mesma do módulo de cobrança)
-- -----------------------------------------------------------------------------

-- 6a. reserve_ai_usage: a verificação que TODA feature de IA tem que chamar
-- ANTES de acionar o modelo. Uma ida ao banco; cobra a estimativa na hora
-- (duas requisições simultâneas não furam o teto, porque a linha do ciclo fica
-- travada) e o acerto devolve a diferença depois.
--
-- Ordem dos cortes (igual a resolveAiQuota no core):
--   1. assinatura fora de trialing/active (carência, modo leitura, inadimplência);
--   2. tamanho da requisição acima do teto por chamada;
--   3. rajada por organização e por usuário no último minuto;
--   4. teto do dia; 5. teto da semana; 6. teto do ciclo (plano + excedente);
--   7. franquia de conversas (só passa dela com teto de excedente ligado).
--
-- Deduplicação: com p_digest, uma requisição idêntica já respondida na janela
-- devolve duplicate = true com a resposta guardada, sem cobrar nada e sem
-- chamar o modelo (não há reserva para acertar).
--
-- Retorno jsonb:
--   { allowed, reason, duplicate, response, reservation_id, in_overage,
--     period_start, period_end, conversations_limit, conversations_used,
--     conversations_remaining, cost_cents, plan_cap_cents, overage_cap_cents,
--     effective_cap_cents, remaining_cents, day_cost_cents, day_cap_cents,
--     week_cost_cents, week_cap_cents, estimated_cost_cents, notify }
--   reason: billing_blocked | feature_unavailable | request_too_large |
--           rate_limited_organization | rate_limited_user | daily_cost_cap |
--           weekly_cost_cap | cycle_cost_cap | quota_exhausted | overage_cap
--   notify: '80' | '100' | null (reservado aqui, no máximo um de cada por ciclo)
-- Erros: 42501 chave; 22023 campo inválido; P0002 imobiliária sem conta de billing.
create or replace function public.reserve_ai_usage(
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
  p_cache_write_tokens integer default 0
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
      coalesce(p_cache_read_tokens, 0), coalesce(p_cache_write_tokens, 0)
    ),
    l.min_reservation_millicents
  );

  -- Cortes que não dependem do consumo acumulado (sem tocar na linha do ciclo).
  if ctx.billing_state not in ('trialing', 'active') then
    v_allowed := false;
    v_reason := 'billing_blocked';
  elsif ctx.conversations_limit = 0 then
    v_allowed := false;
    v_reason := 'feature_unavailable';
  elsif coalesce(p_input_tokens, 0) > l.max_input_tokens
        or coalesce(p_output_tokens, 0) > l.max_output_tokens then
    v_allowed := false;
    v_reason := 'request_too_large';
  end if;

  if v_allowed then
    -- Trava a linha do ciclo: daqui até o commit, esta imobiliária é serializada.
    -- O upsert com DO UPDATE (e não DO NOTHING) garante a trava mesmo quando duas
    -- requisições abrem o ciclo ao mesmo tempo: a segunda espera e lê a linha.
    insert into public.ai_usage_periods (organization_id, period_start, period_end)
    values (p_organization_id, ctx.period_start, ctx.period_end)
    on conflict (organization_id, period_start) do update
    set period_end = excluded.period_end
    returning * into v_row;
  else
    -- Já bloqueado antes de qualquer contagem: só lê, para não criar linha nem
    -- gerar escrita a cada tentativa de quem está sem acesso.
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
      -- Sem excedente ligado, o corte é o teto do plano; com excedente, o somado.
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
      estimated_millicents, day_start, week_start
    )
    values (
      p_organization_id, ctx.period_start, p_kind, p_user_id, p_digest, v_units,
      v_estimate, v_today, v_week
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
        -- Conversa nova: abre (ou reabre) a janela de 24 h deste contato.
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
        -- Mesma conversa: só conta mais uma mensagem, sem consumir a franquia.
        update private.ai_conversation_windows w
        set requests = w.requests + 1
        where w.organization_id = p_organization_id
          and w.contact_key = p_contact_key;
      end if;
    end if;
  end if;

  -- Aviso de franquia: a maior fração entre conversas e reais. Reservado aqui,
  -- dentro da trava, então sai no máximo um de cada por ciclo.
  v_ratio := greatest(
    case when ctx.conversations_limit > 0
      then v_row.conversations::numeric / ctx.conversations_limit else 0 end,
    case when ctx.effective_cap_millicents > 0
      then v_row.cost_millicents::numeric / ctx.effective_cap_millicents else 0 end
  );

  if v_ratio >= 1 and v_row.notified_100_at is null then
    v_notify := '100';
    update public.ai_usage_periods p
    -- Marca também o de 80% para não mandar o aviso menor depois do maior.
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

revoke all on function public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(text, uuid, text, integer, uuid, text, text, integer, integer, integer, integer) to anon, authenticated;

-- 6b. settle_ai_usage: acerto depois da chamada, SEMPRE — inclusive quando o
-- modelo falhou ou o usuário cancelou (se o modelo gerou, o custo existiu e tem
-- que ser contado). Troca a estimativa pelo custo real e guarda os tokens.
-- Idempotente: a mesma reserva só é acertada uma vez.
-- p_status: ok | failed | aborted. p_response só é guardado quando ok (deduplicação).
-- Erros: 42501 chave; 22023 campo inválido; P0002 reserva inexistente.
create or replace function public.settle_ai_usage(
  p_server_key text default null,
  p_organization_id uuid default null,
  p_reservation_id uuid default null,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_cache_read_tokens integer default 0,
  p_cache_write_tokens integer default 0,
  p_status text default 'ok',
  p_response text default null
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

  v_actual := private.ai_cost_millicents(
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
    coalesce(p_cache_read_tokens, 0), coalesce(p_cache_write_tokens, 0)
  );
  v_delta := v_actual - v_request.estimated_millicents;

  update private.ai_usage_requests r
  set settled_at = v_now,
      status = p_status,
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
      -- O acerto entra na janela corrente; se o dia/semana já virou, só o ciclo muda.
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

  -- O custo real pode empurrar o ciclo para 80%/100% depois da chamada.
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
    'cost_cents', round(v_row.cost_millicents / 1000.0)::integer,
    'actual_cost_cents', round(v_actual / 1000.0)::integer,
    'conversations_used', v_row.conversations,
    'period_start', v_row.period_start,
    'period_end', v_row.period_end,
    'notify', v_notify
  );
end;
$$;

revoke all on function public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.settle_ai_usage(text, uuid, uuid, integer, integer, integer, integer, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. RPCs com sessão
-- -----------------------------------------------------------------------------

-- 7a. get_ai_usage_overview: consumo do ciclo para a tela de assinatura.
-- Só membro ativo (senão 42501). Nunca cria linha: ciclo sem uso volta zerado.
create or replace function public.get_ai_usage_overview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ctx record;
  v_row public.ai_usage_periods%rowtype;
  v_now constant timestamptz := now();
  v_today date;
  v_week date;
  v_day_cost bigint;
  v_week_cost bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.is_member(p_organization_id) then
    raise exception 'Você não tem acesso a esta imobiliária.' using errcode = '42501';
  end if;

  select * into ctx from private.ai_quota_context(p_organization_id, v_now);

  if not found then
    return null;
  end if;

  select * into v_row
  from public.ai_usage_periods p
  where p.organization_id = p_organization_id
    and p.period_start = ctx.period_start;

  v_today := (v_now at time zone 'America/Sao_Paulo')::date;
  v_week := (date_trunc('week', v_now at time zone 'America/Sao_Paulo'))::date;
  v_day_cost := case when v_row.day_start = v_today then v_row.day_cost_millicents else 0 end;
  v_week_cost := case when v_row.week_start = v_week then v_row.week_cost_millicents else 0 end;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'model', (select p.model from private.ai_pricing() p),
    'period_start', ctx.period_start,
    'period_end', ctx.period_end,
    'plan_key', ctx.plan_key,
    'billing_state', ctx.billing_state,
    'conversations_limit', ctx.conversations_limit,
    'conversations_used', coalesce(v_row.conversations, 0),
    'requests', coalesce(v_row.requests, 0),
    'input_tokens', coalesce(v_row.input_tokens, 0),
    'output_tokens', coalesce(v_row.output_tokens, 0),
    'cache_read_tokens', coalesce(v_row.cache_read_tokens, 0),
    'cache_write_tokens', coalesce(v_row.cache_write_tokens, 0),
    'cost_cents', round(coalesce(v_row.cost_millicents, 0) / 1000.0)::integer,
    'plan_cap_cents', (ctx.plan_cap_millicents / 1000)::integer,
    'overage_cap_cents', (ctx.overage_cap_millicents / 1000)::integer,
    'effective_cap_cents', (ctx.effective_cap_millicents / 1000)::integer,
    'day_cost_cents', round(coalesce(v_day_cost, 0) / 1000.0)::integer,
    'day_cap_cents', (ctx.day_cap_millicents / 1000)::integer,
    'week_cost_cents', round(coalesce(v_week_cost, 0) / 1000.0)::integer,
    'week_cap_cents', (ctx.week_cap_millicents / 1000)::integer,
    'max_overage_cap_cents', (select l.max_overage_cap_cents from private.ai_limits() l),
    'notified_80_at', v_row.notified_80_at,
    'notified_100_at', v_row.notified_100_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.get_ai_usage_overview(uuid) from public, anon, authenticated;
grant execute on function public.get_ai_usage_overview(uuid) to authenticated;

-- 7b. set_ai_overage_cap: dono ou gerente define o teto de excedente em
-- centavos (0 = não permitir excedente). Continua valendo no modo leitura:
-- é uma trava de gasto, não uma escrita de negócio. Devolve o valor anterior.
-- Erros: 42501 sem sessão, sem acesso ou sem papel; 22023 valor fora da faixa.
create or replace function public.set_ai_overage_cap(
  p_organization_id uuid,
  p_cents integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous integer;
  v_max integer;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  if p_organization_id is null or not private.has_role(p_organization_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'Você não tem acesso a esta imobiliária.' using errcode = '42501';
  end if;

  select l.max_overage_cap_cents into v_max from private.ai_limits() l;

  if p_cents is null or p_cents < 0 or p_cents > v_max then
    perform private.billing_invalid_field('p_cents');
  end if;

  select b.ai_overage_cap_cents into v_previous
  from public.billing_accounts b
  where b.organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Imobiliária não encontrada.' using errcode = 'P0002';
  end if;

  if v_previous <> p_cents then
    update public.billing_accounts b
    set ai_overage_cap_cents = p_cents
    where b.organization_id = p_organization_id;
  end if;

  return v_previous;
end;
$$;

revoke all on function public.set_ai_overage_cap(uuid, integer) from public, anon, authenticated;
grant execute on function public.set_ai_overage_cap(uuid, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Limpeza agendada
-- -----------------------------------------------------------------------------

-- Reservas e deduplicação são efêmeras (janela real: minutos). Apaga com folga.
create or replace function private.cleanup_ai_usage_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
  v_windows integer;
begin
  delete from private.ai_usage_requests
  where created_at < now() - interval '2 days';

  get diagnostics v_deleted = row_count;

  delete from private.ai_conversation_windows
  where expires_at < now() - interval '7 days';

  get diagnostics v_windows = row_count;

  return v_deleted + v_windows;
end;
$$;

comment on function private.cleanup_ai_usage_requests() is
  'Rotina agendada (pg_cron, job limpeza-ia, a cada 30 min): apaga private.ai_usage_requests com mais de 2 dias (janela real: minutos) e private.ai_conversation_windows vencidas há mais de 7 dias. O consumo acumulado em public.ai_usage_periods nunca é apagado.';

revoke all on function private.cleanup_ai_usage_requests() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'limpeza-ia') then
      perform cron.unschedule('limpeza-ia');
    end if;

    perform cron.schedule('limpeza-ia', '*/30 * * * *', 'select private.cleanup_ai_usage_requests();');
  end if;
end;
$$;
