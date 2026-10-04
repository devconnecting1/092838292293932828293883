import { describe, expect, it } from "vitest"

import {
  AI_BATCH_PRICE_MULTIPLIER,
  AI_COST_CAP_FRANCHISE_SLACK,
  AI_COST_CAP_PCT,
  AI_DEFAULT_EFFORT,
  AI_DEFAULT_MODEL,
  AI_DEFAULT_REQUEST_PROFILE,
  AI_EXCHANGE_RATES,
  AI_MODEL_CATALOG,
  AI_MODELS,
  AI_MAX_INPUT_TOKENS,
  AI_MAX_OUTPUT_TOKENS,
  AI_MIN_DAILY_CAP_CENTS,
  AI_MIN_WEEKLY_CAP_CENTS,
  AI_TRIAL_COST_CAP_CENTS,
  AI_USAGE_KINDS,
  AI_USAGE_KIND_LABELS,
  AI_UNIT_WEIGHTS,
  AI_MAX_OVERAGE_CAP_CENTS,
  AI_OVERAGE_BILLING_AVAILABLE,
  AI_REQUEST_PROFILES,
  aiCostCapCents,
  aiCostMillicents,
  aiCostUsd,
  aiDailyCapCents,
  aiMessageParams,
  aiModelPrice,
  aiPlanAllowances,
  aiRequestProfile,
  aiTypicalUsageCosts,
  aiUnitsFor,
  aiUsageFromApi,
  aiUsageNoticeLevel,
  aiUsageRatio,
  aiWeeklyCapCents,
  centsToMillicents,
  conversationsWithinCapCents,
  isAiModel,
  isAiRequestTooLarge,
  isAiTrial,
  isAiUsageKind,
  millicentsToCents,
  projectAiCostMillicents,
  resolveAiQuota,
  typicalConversationCostMillicents,
  typicalConversationTokens,
  typicalRequestCostMillicents,
  type AiQuotaState,
} from "./ai-usage"
import { PLANS, TRIAL_AI_CONVERSATIONS, TRIAL_LIMITS } from "./plans"

describe("preços e câmbio", () => {
  it("usa a tabela oficial de cada modelo (conferida em 2026-09-17)", () => {
    expect(AI_MODELS).toEqual(["claude-sonnet-5", "claude-haiku-4-5"])
    expect(AI_MODEL_CATALOG["claude-sonnet-5"].priceUsdPerMtok).toEqual({
      input: 2,
      output: 10,
      cacheRead: 0.2,
      cacheWrite: 2.5,
      cacheWrite1h: 4,
    })
    expect(AI_MODEL_CATALOG["claude-haiku-4-5"].priceUsdPerMtok).toEqual({
      input: 1,
      output: 5,
      cacheRead: 0.1,
      cacheWrite: 1.25,
      cacheWrite1h: 2,
    })
    // Batch API: metade do preço em tudo.
    expect(AI_BATCH_PRICE_MULTIPLIER).toBe(0.5)
  })

  it("cobra entrada, saída, escrita e leitura de cache pela tabela do Sonnet 5 por padrão", () => {
    expect(AI_DEFAULT_MODEL).toBe("claude-sonnet-5")
    expect(aiCostUsd({ inputTokens: 1_000_000 })).toBeCloseTo(2, 10)
    expect(aiCostUsd({ outputTokens: 1_000_000 })).toBeCloseTo(10, 10)
    // Leitura de cache: 10% da entrada. Escrita: 1,25x a entrada.
    expect(aiCostUsd({ cacheReadTokens: 1_000_000 })).toBeCloseTo(0.2, 10)
    expect(aiCostUsd({ cacheWriteTokens: 1_000_000 })).toBeCloseTo(2.5, 10)
  })

  it("o modelo padrão é o mais caro do catálogo (chamada sem modelo nunca mede a menos)", () => {
    const usage = {
      inputTokens: 1_000,
      outputTokens: 1_000,
      cacheReadTokens: 1_000,
      cacheWriteTokens: 1_000,
    }

    for (const model of AI_MODELS) {
      expect(aiCostUsd(usage)).toBeGreaterThanOrEqual(aiCostUsd(usage, { model }))
    }
  })

  it("Haiku 4.5 custa metade do Sonnet 5 e o lote custa metade do preço cheio", () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    }

    expect(aiCostUsd(usage, { model: "claude-sonnet-5" })).toBeCloseTo(14.7, 10)
    expect(aiCostUsd(usage, { model: "claude-haiku-4-5" })).toBeCloseTo(7.35, 10)
    expect(aiCostUsd(usage, { model: "claude-sonnet-5", batch: true })).toBeCloseTo(7.35, 10)
    expect(aiCostUsd(usage, { model: "claude-haiku-4-5", batch: true })).toBeCloseTo(3.675, 10)
  })

  it("recusa modelo desconhecido em vez de medir com preço errado", () => {
    expect(isAiModel("claude-haiku-4-5")).toBe(true)
    expect(isAiModel("gpt-4o")).toBe(false)
    expect(isAiModel("")).toBe(false)
    expect(() => aiModelPrice("claude-inexistente")).toThrow(/desconhecido/)
    expect(() => aiCostMillicents({ inputTokens: 1 }, { model: "gpt-4o" as never })).toThrow(
      /desconhecido/
    )
  })

  it("ignora tokens ausentes, negativos ou inválidos", () => {
    expect(aiCostUsd({})).toBe(0)
    expect(aiCostUsd({ inputTokens: -100, outputTokens: Number.NaN })).toBe(0)
  })

  it("converte em millicents arredondando para cima (nunca contar menos do que custou)", () => {
    // 1.000 tokens de entrada = US$ 0,002 = R$ 0,0112 a 5,60 = 1,12 centavo.
    expect(aiCostMillicents({ inputTokens: 1_000 }, { rate: 5.6 })).toBe(1_120)
    // 1 token de saída custa fração mínima, mas nunca zero.
    expect(aiCostMillicents({ outputTokens: 1 }, { rate: 5.6 })).toBeGreaterThan(0)
    // Câmbio inválido cai no padrão em vez de zerar o custo.
    expect(aiCostMillicents({ inputTokens: 1_000 }, { rate: 0 })).toBe(
      aiCostMillicents({ inputTokens: 1_000 })
    )
  })

  it("dá os mesmos millicents que o banco (supabase/tests/ia_modelos_lote_teste_gratis.sql)", () => {
    const request = { inputTokens: 2_000, outputTokens: 900 }

    expect(typicalConversationCostMillicents()).toBe(55_293)
    expect(aiCostMillicents(request, { model: "claude-sonnet-5" })).toBe(7_368)
    expect(aiCostMillicents(request, { model: "claude-haiku-4-5" })).toBe(3_684)
    expect(aiCostMillicents(request, { model: "claude-sonnet-5", batch: true })).toBe(3_684)
    expect(aiCostMillicents(request, { model: "claude-haiku-4-5", batch: true })).toBe(1_842)
    expect(
      aiCostMillicents({ outputTokens: 1_000_000 }, { model: "claude-haiku-4-5", batch: true })
    ).toBe(1_416_875)
  })

  it("o câmbio padrão é o dólar de cartão, mais caro que o PTAX", () => {
    expect(AI_EXCHANGE_RATES.card).toBeGreaterThan(AI_EXCHANGE_RATES.ptax)
    expect(
      aiCostMillicents({ inputTokens: 100_000 }, { rate: AI_EXCHANGE_RATES.card })
    ).toBeGreaterThan(aiCostMillicents({ inputTokens: 100_000 }, { rate: AI_EXCHANGE_RATES.ptax }))
  })

  it("converte entre centavos e millicents", () => {
    expect(centsToMillicents(1335)).toBe(1_335_000)
    expect(millicentsToCents(1_335_000)).toBe(1335)
    expect(millicentsToCents(1_499)).toBe(1)
  })
})

describe("tetos por plano", () => {
  it("usa o menor entre 20% do preço de tabela e a franquia com 25% de folga", () => {
    expect(AI_COST_CAP_PCT).toBe(0.2)
    expect(AI_COST_CAP_FRANCHISE_SLACK).toBe(1.25)
    // Corretor não tem IA: teto zero, e nenhum excedente muda isso.
    expect(PLANS.corretor.limits.ai_conversations).toBe(0)
    expect(aiCostCapCents("corretor")).toBe(0)
    // Mesmos números de private.ai_cost_cap_cents (migração plan_prices_increase_ai_caps).
    // Depois do aumento de preço de 17/09/2026 os três são o lado da FRANQUIA.
    expect(aiCostCapCents("imobiliaria")).toBe(3456)
    expect(aiCostCapCents("equipe")).toBe(13824)
    expect(aiCostCapCents("rede")).toBe(34559)
    expect(aiCostCapCents("trial")).toBe(0)

    for (const plan of ["imobiliaria", "equipe", "rede"] as const) {
      const byPrice = Math.round(PLANS[plan].prices.month * AI_COST_CAP_PCT)
      const byFranchise = Math.ceil(
        (PLANS[plan].limits.ai_conversations * typicalConversationCostMillicents() * 1.25) / 1000
      )
      expect(aiCostCapCents(plan), plan).toBe(Math.min(byPrice, byFranchise))
    }
  })

  it("teste grátis não tem IA: franquia e teto zero", () => {
    expect(TRIAL_AI_CONVERSATIONS).toBe(0)
    expect(TRIAL_LIMITS.ai_conversations).toBe(0)
    expect(AI_TRIAL_COST_CAP_CENTS).toBe(0)
    expect(aiDailyCapCents(AI_TRIAL_COST_CAP_CENTS)).toBe(0)
    expect(aiWeeklyCapCents(AI_TRIAL_COST_CAP_CENTS)).toBe(0)
  })

  it("todo plano com IA segue com lucro no pior caso (teto no máximo 20% do preço)", () => {
    for (const allowance of aiPlanAllowances()) {
      const price = PLANS[allowance.plan as keyof typeof PLANS].prices.month
      expect(allowance.cycleCapCents, allowance.plan).toBeLessThanOrEqual(
        Math.round(price * AI_COST_CAP_PCT)
      )
    }
  })

  it("recorta o teto do ciclo em dia (1/15) e semana (1/4)", () => {
    expect(aiDailyCapCents(3735)).toBe(249)
    expect(aiWeeklyCapCents(3735)).toBe(934)
    expect(aiDailyCapCents(22350)).toBe(1490)
    expect(aiWeeklyCapCents(22350)).toBe(5588)
    expect(aiDailyCapCents(-10)).toBe(0)
  })

  it("respeita o piso das janelas curtas sem passar do teto do ciclo", () => {
    // Teto pequeno: 1/15 de R$ 6,00 não pagaria nem uma conversa.
    expect(aiDailyCapCents(600)).toBe(AI_MIN_DAILY_CAP_CENTS)
    expect(aiWeeklyCapCents(600)).toBe(AI_MIN_WEEKLY_CAP_CENTS)
    expect(aiDailyCapCents(20)).toBe(20)
    expect(aiWeeklyCapCents(20)).toBe(20)
  })

  it("recorta os tetos novos em dia e semana", () => {
    expect(aiDailyCapCents(3456)).toBe(231)
    expect(aiWeeklyCapCents(3456)).toBe(864)
    expect(aiDailyCapCents(13824)).toBe(922)
    expect(aiWeeklyCapCents(34559)).toBe(8640)
  })

  it("a franquia anunciada cabe no teto em reais com a conversa típica (pior caso)", () => {
    for (const allowance of aiPlanAllowances()) {
      expect(allowance.franchiseCostCents).toBeLessThanOrEqual(allowance.cycleCapCents)
      expect(allowance.conversationsWithinCap).toBeGreaterThanOrEqual(allowance.conversations)
    }

    expect(
      aiPlanAllowances().map((a) => [a.plan, a.cycleCapCents, a.conversationsWithinCap])
    ).toEqual([
      ["corretor", 0, 0],
      ["imobiliaria", 3456, 62],
      ["equipe", 13824, 250],
      ["rede", 34559, 625],
    ])
    expect(conversationsWithinCapCents(AI_TRIAL_COST_CAP_CENTS)).toBe(0)
  })

  it("o teto do dia comporta ao menos uma conversa típica em todo plano com IA", () => {
    const withAi = aiPlanAllowances().filter((allowance) => allowance.conversations !== 0)
    const caps = withAi.map((a) => a.cycleCapCents)

    expect(withAi).toHaveLength(3)

    for (const cap of caps) {
      expect(centsToMillicents(aiDailyCapCents(cap))).toBeGreaterThanOrEqual(
        typicalConversationCostMillicents()
      )
    }
  })

  it("o plano sem IA não tem teto nenhum a gastar", () => {
    const corretor = aiPlanAllowances().find((allowance) => allowance.plan === "corretor")

    expect(corretor?.conversations).toBe(0)
    expect(corretor?.cycleCapCents).toBe(0)
    expect(corretor?.dailyCapCents).toBe(0)
    expect(corretor?.weeklyCapCents).toBe(0)
    expect(corretor?.conversationsWithinCap).toBe(0)
  })
})

describe("tipos de uso e peso", () => {
  it("descreve e pesa todos os tipos", () => {
    expect(Object.keys(AI_USAGE_KIND_LABELS)).toEqual([...AI_USAGE_KINDS])
    expect(Object.keys(AI_UNIT_WEIGHTS)).toEqual([...AI_USAGE_KINDS])
    expect(isAiUsageKind("conversation")).toBe(true)
    expect(isAiUsageKind("qualquer")).toBe(false)
  })

  it("multiplica as unidades pelo peso do tipo", () => {
    expect(aiUnitsFor("conversation")).toBe(AI_UNIT_WEIGHTS.conversation)
    expect(aiUnitsFor("listing_copy", 3)).toBe(3 * AI_UNIT_WEIGHTS.listing_copy)
    expect(aiUnitsFor("reply_suggestion", -2)).toBe(0)
  })
})

describe("tamanho da requisição", () => {
  it("recusa entrada ou saída acima do teto por chamada", () => {
    expect(isAiRequestTooLarge({ inputTokens: AI_MAX_INPUT_TOKENS })).toBe(false)
    expect(isAiRequestTooLarge({ inputTokens: AI_MAX_INPUT_TOKENS + 1 })).toBe(true)
    expect(isAiRequestTooLarge({ outputTokens: AI_MAX_OUTPUT_TOKENS + 1 })).toBe(true)
  })
})

const CONVERSATION_COST = typicalConversationCostMillicents()

function state(overrides: Partial<AiQuotaState> = {}): AiQuotaState {
  return {
    planKey: "imobiliaria",
    billingState: "active",
    conversationsLimit: PLANS.imobiliaria.limits.ai_conversations,
    conversationsUsed: 0,
    costMillicents: 0,
    dayCostMillicents: 0,
    weekCostMillicents: 0,
    overageCapCents: 0,
    ...overrides,
  }
}

const request = { kind: "conversation" as const, estimatedCostMillicents: CONVERSATION_COST }

describe("resolveAiQuota", () => {
  it("libera dentro da franquia e do teto", () => {
    const decision = resolveAiQuota(state(), request)

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBeNull()
    expect(decision.inOverage).toBe(false)
    expect(decision.conversationsRemaining).toBe(50)
    expect(decision.effectiveCapMillicents).toBe(centsToMillicents(3456))
  })

  it("teste grátis não tem IA: local ou criado na Stripe, com franquia gravada ou não", () => {
    const local = resolveAiQuota(
      state({ planKey: "trial", billingState: "trialing", conversationsLimit: 10 }),
      request
    )
    const stripe = resolveAiQuota(
      state({ planKey: "equipe", billingState: "trialing", conversationsLimit: 200 }),
      request
    )

    for (const decision of [local, stripe]) {
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe("feature_unavailable")
      expect(decision.conversationsLimit).toBe(0)
      expect(decision.planCapMillicents).toBe(0)
      expect(decision.effectiveCapMillicents).toBe(0)
      expect(decision.dayCapMillicents).toBe(0)
    }

    expect(isAiTrial({ planKey: "trial", billingState: "active" })).toBe(true)
    expect(isAiTrial({ planKey: "equipe", billingState: "active" })).toBe(false)
  })

  it("bloqueia fora de trialing/active (carência, modo leitura, inadimplência)", () => {
    for (const billingState of ["grace", "read_only"] as const) {
      const decision = resolveAiQuota(state({ billingState }), request)
      expect(decision.allowed).toBe(false)
      expect(decision.reason).toBe("billing_blocked")
    }
  })

  it("bloqueia quando o plano não inclui IA (franquia 0)", () => {
    expect(resolveAiQuota(state({ conversationsLimit: 0 }), request).reason).toBe(
      "feature_unavailable"
    )
  })

  it("bloqueia pelo teto do dia antes de qualquer outro teto", () => {
    const decision = resolveAiQuota(
      state({ dayCostMillicents: centsToMillicents(aiDailyCapCents(3456)) }),
      request
    )

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("daily_cost_cap")
  })

  it("bloqueia pelo teto da semana", () => {
    const decision = resolveAiQuota(
      state({ weekCostMillicents: centsToMillicents(aiWeeklyCapCents(3456)) }),
      request
    )

    expect(decision.reason).toBe("weekly_cost_cap")
  })

  it("bloqueia pelo teto do ciclo mesmo com conversas sobrando na franquia", () => {
    const decision = resolveAiQuota(
      state({ conversationsUsed: 1, costMillicents: centsToMillicents(3456) }),
      request
    )

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("cycle_cost_cap")
    expect(decision.conversationsRemaining).toBe(49)
    expect(decision.inOverage).toBe(true)
  })

  it("bloqueia ao acabar a franquia quando não há teto de excedente", () => {
    const decision = resolveAiQuota(state({ conversationsUsed: 100 }), request)

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("quota_exhausted")
    expect(decision.conversationsRemaining).toBe(0)
  })

  it("ignora excedente gravado enquanto não houver como cobrá-lo", () => {
    // Sem preço na Stripe, excedente autorizado seria gasto nosso sem receita.
    // A quota tem que parar exatamente no teto do plano, mesmo com valor gravado.
    expect(AI_OVERAGE_BILLING_AVAILABLE).toBe(false)
    expect(AI_MAX_OVERAGE_CAP_CENTS).toBe(0)

    const decisao = resolveAiQuota(
      state({ conversationsUsed: 100, overageCapCents: 200_000 }),
      request
    )

    expect(decisao.overageCapMillicents).toBe(0)
    expect(decisao.effectiveCapMillicents).toBe(centsToMillicents(3456))
    expect(decisao.allowed).toBe(false)
    // Sem excedente, nada estende a franquia esgotada.
    expect(decisao.reason).toBe("quota_exhausted")
  })

  it("o teto do plano é o limite absoluto de gasto, em qualquer escala", () => {
    // A garantia que sustenta "sem prejuízo": nenhuma combinação de estado
    // permite gastar acima do teto do plano (no máximo 20% do preço de tabela).
    for (const plano of ["imobiliaria", "equipe", "rede"] as const) {
      const teto = aiCostCapCents(plano)
      const decisao = resolveAiQuota(
        {
          planKey: plano,
          billingState: "active",
          conversationsLimit: -1,
          conversationsUsed: 0,
          costMillicents: centsToMillicents(teto),
          dayCostMillicents: 0,
          weekCostMillicents: 0,
          overageCapCents: 500_000,
        },
        { kind: "conversation", estimatedCostMillicents: 1 }
      )

      expect(decisao.allowed, plano).toBe(false)
      expect(decisao.effectiveCapMillicents, plano).toBe(centsToMillicents(teto))
    }
  })

  it("franquia ilimitada ainda respeita o teto em reais", () => {
    const decision = resolveAiQuota(
      state({ conversationsLimit: -1, costMillicents: centsToMillicents(3456) }),
      request
    )

    expect(decision.conversationsRemaining).toBeNull()
    expect(decision.reason).toBe("cycle_cost_cap")
  })

  it("cobra a estimativa antes da chamada, então duas requisições simultâneas não furam o teto", () => {
    const almostFull = centsToMillicents(3456) - CONVERSATION_COST
    const first = resolveAiQuota(state({ costMillicents: almostFull }), request)
    // A segunda chega depois de a primeira já ter debitado a estimativa.
    const second = resolveAiQuota(
      state({ costMillicents: almostFull + CONVERSATION_COST }),
      request
    )

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(false)
  })
})

describe("projeção e avisos", () => {
  it("projeta o custo do ciclo por volume", () => {
    expect(projectAiCostMillicents({ conversations: 100 })).toBe(100 * CONVERSATION_COST)
    expect(projectAiCostMillicents({})).toBe(0)
  })

  it("assume 8 turnos com cache lido nos turnos seguintes", () => {
    expect(typicalConversationTokens()).toEqual({
      inputTokens: 1_200,
      outputTokens: 3_560,
      cacheWriteTokens: 20_800,
      cacheReadTokens: 37_800,
    })
  })

  it("usa a maior fração entre conversas e reais", () => {
    expect(
      aiUsageRatio({
        conversationsLimit: 100,
        conversationsUsed: 50,
        costMillicents: 900,
        capMillicents: 1000,
      })
    ).toBe(0.9)

    expect(
      aiUsageRatio({
        conversationsLimit: -1,
        conversationsUsed: 500,
        costMillicents: 0,
        capMillicents: 0,
      })
    ).toBe(0)
  })

  it("avisa em 80% e em 100%", () => {
    expect(aiUsageNoticeLevel(0.79)).toBeNull()
    expect(aiUsageNoticeLevel(0.8)).toBe("80")
    expect(aiUsageNoticeLevel(0.99)).toBe("80")
    expect(aiUsageNoticeLevel(1)).toBe("100")
    expect(aiUsageNoticeLevel(Number.NaN)).toBeNull()
  })
})

describe("uso devolvido pela API", () => {
  it("lê entrada, saída (com raciocínio) e leitura de cache como vieram", () => {
    expect(
      aiUsageFromApi({
        input_tokens: 120,
        output_tokens: 450,
        cache_read_input_tokens: 3_000,
        cache_creation_input_tokens: 0,
      })
    ).toEqual({ inputTokens: 120, outputTokens: 450, cacheReadTokens: 3_000, cacheWriteTokens: 0 })
  })

  it("converte escrita de 1 hora em tokens de 5 min pelo preço (nunca mede a menos)", () => {
    const apiUsage = {
      cache_creation_input_tokens: 2_000,
      cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 1_500 },
    }

    for (const model of AI_MODELS) {
      const usage = aiUsageFromApi(apiUsage, model)
      const price = AI_MODEL_CATALOG[model].priceUsdPerMtok

      // 1.500 × (1 h / 5 min = 1,6 nos dois modelos) = 2.400 equivalentes, mais os 500 de 5 min.
      expect(usage.cacheWriteTokens, model).toBe(2_900)
      expect(aiCostUsd(usage, { model }), model).toBeCloseTo(
        (500 * price.cacheWrite + 1_500 * price.cacheWrite1h) / 1_000_000,
        10
      )
    }
  })

  it("sem detalhe por duração, trata toda escrita como 1 hora", () => {
    expect(aiUsageFromApi({ cache_creation_input_tokens: 1_000 }).cacheWriteTokens).toBe(1_600)
    // Detalhe que não fecha com o total: a diferença também conta como 1 hora.
    expect(
      aiUsageFromApi({
        cache_creation_input_tokens: 1_000,
        cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 0 },
      }).cacheWriteTokens
    ).toBe(400 + 960)
  })

  it("ignora usage ausente ou com valores inválidos", () => {
    expect(aiUsageFromApi(null)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(aiUsageFromApi({ input_tokens: -5, output_tokens: null }).inputTokens).toBe(0)
  })
})

describe("perfil de chamada por tipo de uso", () => {
  it("todo tipo cabe no teto de saída e manda effort explícito quando o modelo aceita", () => {
    for (const kind of AI_USAGE_KINDS) {
      const profile = AI_REQUEST_PROFILES[kind]
      const definition = AI_MODEL_CATALOG[profile.model]

      expect(profile.maxTokens).toBeGreaterThan(0)
      expect(profile.maxTokens).toBeLessThanOrEqual(AI_MAX_OUTPUT_TOKENS)

      // Effort só onde o modelo aceita (Haiku 4.5 devolve 400), e nunca `high`.
      if (definition.supportsEffort) {
        expect(["low", "medium"], kind).toContain(profile.effort)
      } else {
        expect(profile.effort, kind).toBeNull()
      }

      // Raciocínio adaptativo só onde o modelo tem.
      if (!definition.adaptiveThinking) {
        expect(profile.thinking, kind).toBe("off")
      }
    }
  })

  it("conversa e anúncio no Sonnet 5; resumo e sugestão no Haiku 4.5 sem raciocínio", () => {
    expect(AI_REQUEST_PROFILES.conversation).toMatchObject({
      model: "claude-sonnet-5",
      effort: "low",
      thinking: "adaptive",
      batchable: false,
    })
    expect(AI_REQUEST_PROFILES.listing_copy).toMatchObject({
      model: "claude-sonnet-5",
      effort: "medium",
      thinking: "adaptive",
      batchable: true,
    })
    for (const kind of ["conversation_summary", "reply_suggestion"] as const) {
      expect(AI_REQUEST_PROFILES[kind], kind).toMatchObject({
        model: "claude-haiku-4-5",
        effort: null,
        thinking: "off",
      })
    }
  })

  it("uso sem perfil próprio cai em medium, nunca no high da API", () => {
    expect(AI_DEFAULT_EFFORT).toBe("medium")
    expect(AI_DEFAULT_REQUEST_PROFILE).toMatchObject({
      model: "claude-sonnet-5",
      effort: "medium",
      thinking: "adaptive",
    })
    expect(aiRequestProfile("qualquer")).toBe(AI_DEFAULT_REQUEST_PROFILE)
    expect(aiRequestProfile(undefined)).toBe(AI_DEFAULT_REQUEST_PROFILE)
    expect(aiRequestProfile("listing_copy")).toBe(AI_REQUEST_PROFILES.listing_copy)
  })

  it("monta os campos da Messages API sem mandar o que o modelo recusa", () => {
    expect(aiMessageParams(AI_REQUEST_PROFILES.conversation)).toEqual({
      model: "claude-sonnet-5",
      max_tokens: AI_MAX_OUTPUT_TOKENS,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    })
    expect(aiMessageParams(AI_DEFAULT_REQUEST_PROFILE).output_config).toEqual({ effort: "medium" })
    expect(aiMessageParams(AI_REQUEST_PROFILES.reply_suggestion)).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: AI_MAX_OUTPUT_TOKENS,
    })
    // Perfil Sonnet sem effort ainda recebe o padrão explícito.
    expect(aiMessageParams({ ...AI_DEFAULT_REQUEST_PROFILE, effort: null }).output_config).toEqual({
      effort: AI_DEFAULT_EFFORT,
    })
  })

  it("custo típico por tipo de uso no modelo do perfil", () => {
    expect(aiTypicalUsageCosts()).toEqual([
      {
        kind: "conversation",
        model: "claude-sonnet-5",
        effort: "low",
        costMillicents: 55_293,
        batchCostMillicents: null,
      },
      {
        kind: "listing_copy",
        model: "claude-sonnet-5",
        effort: "medium",
        costMillicents: 7_368,
        batchCostMillicents: 3_684,
      },
      {
        kind: "conversation_summary",
        model: "claude-haiku-4-5",
        effort: null,
        costMillicents: 3_684,
        batchCostMillicents: 1_842,
      },
      {
        kind: "reply_suggestion",
        model: "claude-haiku-4-5",
        effort: null,
        costMillicents: 3_684,
        batchCostMillicents: null,
      },
    ])
    // A projeção de avulsos continua no pior caso (Sonnet 5 sem lote).
    expect(typicalRequestCostMillicents()).toBe(7_368)
  })
})
