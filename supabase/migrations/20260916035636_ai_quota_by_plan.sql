-- Franquia de IA por plano, decidida pelo dono em 2026-09-16:
--   Corretor  → sem IA (franquia 0 e teto de custo 0)
--   Imobiliária → 50 conversas/ciclo
--   Equipe      → 200
--   Rede        → 500
--
-- Duas travas, na ordem em que cortam:
--   1. franquia 0  → reserve_ai_usage devolve 'feature_unavailable' antes de
--      tocar na linha do ciclo (nenhum token é gasto);
--   2. teto em reais 0 → mesmo que alguém grave uma franquia por engano no
--      jsonb `limits`, não há centavo autorizado no plano Corretor.
--
-- Espelho de packages/core/src/billing: PLANS[*].limits.ai_conversations e
-- aiCostCapCents (AI_COST_CAP_PCT = 0,15 sobre o preço de tabela mensal).

create or replace function private.ai_cost_cap_cents(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan
    when 'corretor' then 0         -- plano sem IA: nada a autorizar
    when 'imobiliaria' then 3735   -- 15% de R$ 249,00
    when 'equipe' then 8985        -- 15% de R$ 599,00
    when 'rede' then 22350         -- 15% de R$ 1.490,00
    else 300                       -- teste grátis (e plano desconhecido): R$ 3,00
  end;
$$;

revoke all on function private.ai_cost_cap_cents(text) from public, anon, authenticated;

comment on function private.ai_cost_cap_cents(text) is
  'Teto de custo de IA por ciclo, em centavos, sempre sobre o preço de tabela mensal do plano (nunca sobre o valor com desconto do Indique e ganhe). Corretor = 0: plano sem IA.';

-- As assinaturas existentes carregam a franquia antiga no jsonb `limits`
-- (gravado a partir de PLANS quando a assinatura foi criada). Só a chave
-- ai_conversations é reescrita; nenhum outro limite, recurso ou dado muda.
update public.billing_accounts as b
set limits = b.limits || jsonb_build_object('ai_conversations', p.quota)
from (values
  ('corretor', 0),
  ('imobiliaria', 50),
  ('equipe', 200),
  ('rede', 500)
) as p(plan_key, quota)
-- Sem cast do valor antigo de propósito: `limits` é jsonb livre e um valor
-- inesperado ali derrubaria a migração. Reescrever sempre é idempotente.
where b.plan_key = p.plan_key
  and b.limits -> 'ai_conversations' is distinct from to_jsonb(p.quota);
