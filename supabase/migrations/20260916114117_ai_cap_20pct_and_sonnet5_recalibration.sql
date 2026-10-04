-- =============================================================================
-- Teto de IA recalibrado para o comportamento real do Claude Sonnet 5
-- =============================================================================
-- Decisão do dono em 16/09/2026, depois de conferir a documentação oficial
-- (platform.claude.com/docs: pricing, effort, thinking, prompt caching):
--
--   - O Sonnet 5 raciocina por padrão (cobrado como saída), gera ~30% mais
--     tokens que o modelo anterior e reenvia o histórico a cada mensagem. A
--     conversa típica foi recalculada de R$ 0,21 para ~R$ 0,55 (estimativa
--     conservadora, AI_TYPICAL_CONVERSATION no core).
--   - Com 15%, Equipe e Rede batiam o teto antes da franquia anunciada. O teto
--     passa a 20% do preço de tabela mensal: Imobiliária R$ 49,80, Equipe
--     R$ 119,80, Rede R$ 298,00. Todo plano segue com lucro no pior caso.
--   - Teste grátis: R$ 3,00 → R$ 6,00, o custo das 10 conversas prometidas.
--   - Piso do teto diário: R$ 0,50 → R$ 1,00, para caber uma conversa típica.
--
-- Duas correções que vieram junto:
--   - private.ai_pricing() usava câmbio 5,60, enquanto o core usa 5,6675
--     (PTAX 5,1523 + 10%). O banco media ~1,2% abaixo do custo real.
--   - private.ai_limits().max_overage_cap_cents passa a 0, espelhando
--     AI_MAX_OVERAGE_CAP_CENTS: set_ai_overage_cap recusa com 22023 em vez de
--     estourar no CHECK da tabela (migração ai_overage_requires_billing).

create or replace function private.ai_cost_cap_cents(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan
    when 'corretor' then 0          -- plano sem IA: nada a autorizar
    when 'imobiliaria' then 4980    -- 20% de R$ 249,00
    when 'equipe' then 11980        -- 20% de R$ 599,00
    when 'rede' then 29800          -- 20% de R$ 1.490,00
    else 600                        -- teste grátis (e plano desconhecido): R$ 6,00
  end;
$$;

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
returns record
language sql
immutable
set search_path = ''
as $$
  select 12000, 1500, 10, 4, 10, 24, 15, 4, 100, 150, 1400::bigint, 0, 0.8::numeric, 8000;
$$;

create or replace function private.ai_pricing(
  out model text,
  out usd_per_mtok_input numeric,
  out usd_per_mtok_output numeric,
  out usd_per_mtok_cache_read numeric,
  out usd_per_mtok_cache_write numeric,
  out exchange_rate numeric
)
returns record
language sql
immutable
set search_path = ''
as $$
  select 'claude-sonnet-5', 2::numeric, 10::numeric, 0.2::numeric, 2.5::numeric, 5.6675::numeric;
$$;
