-- =============================================================================
-- Aumento de preço dos planos: tetos de IA recalculados
-- =============================================================================
-- Decisão do dono em 17/09/2026. Preço de tabela MENSAL (o anual continua sendo
-- 10 mensalidades, 2 meses grátis):
--   Corretor    R$    89,00 → R$   115,00
--   Imobiliária R$   249,00 → R$   320,00
--   Equipe      R$   599,00 → R$   775,00
--   Rede        R$ 1.490,00 → R$ 1.930,00
-- Assento extra (R$ 49/59/69/79) e adicionais (+10 imóveis por R$ 19 etc.) não
-- mudam.
--
-- O banco NÃO guarda preço de plano: a tabela de preços vive só em
-- packages/core/src/billing/plans.ts, e o servidor grava a partir dela os
-- `limits` e `features` de billing_accounts. O único número do banco que depende
-- do preço é o teto de custo de IA.
--
-- Teto = menor valor entre 20% do preço de tabela mensal e franquia × conversa
-- típica (R$ 0,55293, AI_TYPICAL_CONVERSATION no Sonnet 5) × 1,25, para cima em
-- centavos:
--   imobiliaria: min(20% de   320,00 =  6.400; ceil( 50 × 55,293 × 1,25) =  3.456) =  3.456
--   equipe:      min(20% de   775,00 = 15.500; ceil(200 × 55,293 × 1,25) = 13.824) = 13.824
--   rede:        min(20% de 1.930,00 = 38.600; ceil(500 × 55,293 × 1,25) = 34.559) = 34.559
--
-- Com o preço novo os TRÊS planos caem no lado da FRANQUIA: 20% do preço passou
-- a sobrar em todo plano, então quem manda no teto é o custo da franquia
-- anunciada — que não mudou. Sobem só Equipe (11.980 → 13.824) e Rede
-- (29.800 → 34.559), que antes eram capados pelos 20% do preço antigo;
-- Imobiliária continua 3.456 (já era a franquia).
--
-- Valor calculado por aiCostCapCents em packages/core/src/billing/ai-usage.ts:
-- mude lá e copie para cá. A tela Console → Custos de IA confere banco x core.

create or replace function private.ai_cost_cap_cents(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan
    when 'corretor' then 0          -- plano sem IA: nada a autorizar
    when 'imobiliaria' then 3456    -- franquia  50 × conversa típica × 1,25 (< 20% de R$ 320,00)
    when 'equipe' then 13824        -- franquia 200 × conversa típica × 1,25 (< 20% de R$ 775,00)
    when 'rede' then 34559          -- franquia 500 × conversa típica × 1,25 (< 20% de R$ 1.930,00)
    else 0                          -- teste grátis (sem IA) e plano desconhecido: falha fechada
  end;
$$;

revoke all on function private.ai_cost_cap_cents(text) from public, anon, authenticated;

comment on function private.ai_cost_cap_cents(text) is
  'Teto de custo de IA por ciclo mensal, em centavos, por imobiliária: menor valor entre 20% do preço de tabela mensal e franquia × conversa típica × 1,25 (Imobiliária 3.456, Equipe 13.824, Rede 34.559 — com os preços de 17/09/2026 os três caem no lado da franquia). É o MÁXIMO que o banco deixa gastar, não o gasto esperado. Corretor, teste grátis e plano desconhecido = 0. Calculado por aiCostCapCents em packages/core/src/billing/ai-usage.ts.';
