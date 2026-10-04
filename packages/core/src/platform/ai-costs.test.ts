import { describe, expect, it } from "vitest"

import {
  AI_EXCHANGE_RATE_DEFAULT,
  aiCostCapCents,
  typicalConversationCostMillicents,
  typicalConversationTokens,
} from "../billing/ai-usage"
import {
  AI_COST_MIN_SAMPLE_CONVERSATIONS,
  aiCapRatio,
  buildAiCostRow,
  calibrateAiConversation,
  checkAiPricing,
  EMPTY_AI_USAGE,
  formatAiMillicents,
  formatAiRatio,
  isAiCostCycle,
  parsePlatformAiCosts,
  summarizeAiCosts,
  type AiCostOrganization,
} from "./ai-costs"

function period(overrides: Record<string, unknown> = {}) {
  return {
    period_start: "2026-09-01T12:00:00+00:00",
    period_end: "2026-10-01T12:00:00+00:00",
    conversations: 10,
    requests: 40,
    input_tokens: 1_000,
    output_tokens: 2_000,
    cache_read_tokens: 3_000,
    cache_write_tokens: 4_000,
    cost_millicents: 500_000,
    ...overrides,
  }
}

function organization(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: "00000000-0000-4000-8000-000000000001",
    organization_name: "Imobiliária Alfa",
    plan_key: "imobiliaria",
    billing_state: "active",
    conversations_limit: 50,
    plan_cap_cents: 4980,
    effective_cap_cents: 4980,
    current_period_start: "2026-09-01T12:00:00+00:00",
    current_period_end: "2026-10-01T12:00:00+00:00",
    current: period(),
    previous: period({
      period_start: "2026-08-01T12:00:00+00:00",
      period_end: "2026-09-01T12:00:00+00:00",
      cost_millicents: 1_000_000,
      conversations: 20,
    }),
    ...overrides,
  }
}

function payload(organizations: unknown[] = [organization()]) {
  return {
    generated_at: "2026-09-17T12:00:00+00:00",
    pricing: {
      model: "claude-sonnet-5",
      usd_per_mtok_input: 2,
      usd_per_mtok_output: 10,
      usd_per_mtok_cache_read: 0.2,
      usd_per_mtok_cache_write: 2.5,
      exchange_rate: 5.6675,
      batch_multiplier: 0.5,
    },
    models: [
      {
        model: "claude-sonnet-5",
        label: "Claude Sonnet 5",
        usd_per_mtok_input: 2,
        usd_per_mtok_output: 10,
        usd_per_mtok_cache_read: 0.2,
        usd_per_mtok_cache_write: 2.5,
        usd_per_mtok_cache_write_1h: 4,
      },
      {
        model: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        usd_per_mtok_input: 1,
        usd_per_mtok_output: 5,
        usd_per_mtok_cache_read: 0.1,
        usd_per_mtok_cache_write: 1.25,
        usd_per_mtok_cache_write_1h: 2,
      },
    ],
    plan_caps_cents: { trial: 0, corretor: 0, imobiliaria: 3456, equipe: 13824, rede: 34559 },
    organizations_total: 3,
    organizations_with_ai: 2,
    organizations,
  }
}

function parsed(organizations?: unknown[]) {
  const snapshot = parsePlatformAiCosts(payload(organizations))

  if (!snapshot) {
    throw new Error("payload de teste inválido")
  }

  return snapshot
}

describe("parsePlatformAiCosts", () => {
  it("lê o retrato do banco sem mexer nos números", () => {
    const snapshot = parsed()

    expect(snapshot.pricing?.exchangeRate).toBe(5.6675)
    expect(snapshot.organizationsTotal).toBe(3)
    expect(snapshot.organizations[0]?.current).toEqual({
      periodStart: "2026-09-01T12:00:00+00:00",
      periodEnd: "2026-10-01T12:00:00+00:00",
      conversations: 10,
      requests: 40,
      inputTokens: 1_000,
      outputTokens: 2_000,
      cacheReadTokens: 3_000,
      cacheWriteTokens: 4_000,
      costMillicents: 500_000,
    })
    expect(snapshot.organizations[0]?.previous?.costMillicents).toBe(1_000_000)
  })

  it("lê os dois modelos e o desconto do lote", () => {
    const snapshot = parsed()

    expect(snapshot.pricing?.batchMultiplier).toBe(0.5)
    expect(snapshot.models.map((model) => model.model)).toEqual([
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ])
    expect(snapshot.models[1]?.usdPerMtokCacheWrite1h).toBe(2)
  })

  it("formato inesperado volta null; preço ausente não derruba o resto", () => {
    expect(parsePlatformAiCosts(null)).toBeNull()
    expect(parsePlatformAiCosts({ ...payload(), organizations: "x" })).toBeNull()
    expect(parsePlatformAiCosts({ ...payload(), pricing: { model: 1 } })?.pricing).toBeNull()
    // Banco anterior à medição por modelo: sem `models` e sem `batch_multiplier`.
    const legacy: Record<string, unknown> = {
      ...payload(),
      pricing: { ...payload().pricing, batch_multiplier: undefined },
    }
    delete legacy.models
    const old = parsePlatformAiCosts(legacy)
    expect(old?.models).toEqual([])
    expect(old?.pricing?.batchMultiplier).toBeNull()
  })

  it("contagem negativa é recusada", () => {
    expect(
      parsePlatformAiCosts(payload([organization({ current: period({ requests: -1 }) })]))
    ).toBeNull()
  })
})

describe("cálculos por imobiliária", () => {
  it("% do teto e aviso a partir de 80%", () => {
    expect(aiCapRatio(3_984_000, 4980)).toBe(0.8)
    expect(aiCapRatio(100, 0)).toBeNull()

    const [org] = parsed([
      organization({ current: period({ cost_millicents: 3_984_000, conversations: 8 }) }),
    ]).organizations
    const row = buildAiCostRow(org as AiCostOrganization, "atual")

    expect(row?.costCents).toBe(3984)
    expect(row?.capRatio).toBe(0.8)
    expect(row?.overWarning).toBe(true)
    expect(row?.costPerConversationMillicents).toBe(498_000)
  })

  it("abaixo de 80% não avisa; plano sem teto nunca avisa", () => {
    const [below, noCap] = parsed([
      organization({ current: period({ cost_millicents: 3_983_000 }) }),
      organization({
        organization_id: "00000000-0000-4000-8000-000000000002",
        plan_key: "corretor",
        plan_cap_cents: 0,
        effective_cap_cents: 0,
        current: period({ cost_millicents: 10_000, conversations: 0 }),
      }),
    ]).organizations

    expect(buildAiCostRow(below as AiCostOrganization, "atual")?.overWarning).toBe(false)
    const row = buildAiCostRow(noCap as AiCostOrganization, "atual")
    expect(row?.capRatio).toBeNull()
    expect(row?.overWarning).toBe(false)
    expect(row?.costPerConversationMillicents).toBeNull()
  })

  it("sem consumo no ciclo não gera linha", () => {
    const [org] = parsed([organization({ previous: null })]).organizations
    expect(buildAiCostRow(org as AiCostOrganization, "anterior")).toBeNull()
  })
})

describe("summarizeAiCosts", () => {
  const snapshot = parsed([
    organization(),
    organization({
      organization_id: "00000000-0000-4000-8000-000000000002",
      organization_name: "Beta Imóveis",
      plan_key: "equipe",
      plan_cap_cents: 11980,
      effective_cap_cents: 11980,
      current: period({ cost_millicents: 11_000_000, conversations: 30, requests: 90 }),
      previous: null,
    }),
    organization({
      organization_id: "00000000-0000-4000-8000-000000000003",
      organization_name: "Gama",
      current: null,
    }),
  ])

  it("total do ciclo atual soma só quem consumiu nele, do mais caro para o mais barato", () => {
    const summary = summarizeAiCosts(snapshot, "atual")

    expect(summary.rows.map((row) => row.organizationName)).toEqual([
      "Beta Imóveis",
      "Imobiliária Alfa",
    ])
    expect(summary.totals.costMillicents).toBe(11_500_000)
    expect(summary.totals.conversations).toBe(40)
    expect(summary.totals.requests).toBe(130)
    expect(summary.totalCostCents).toBe(11_500)
    expect(summary.totalCapCents).toBe(4980 + 11980)
    expect(summary.totalCapRatio).toBeCloseTo(11_500 / (4980 + 11980), 4)
    expect(summary.overWarning.map((row) => row.organizationName)).toEqual(["Beta Imóveis"])
  })

  it("ciclo anterior usa a linha anterior", () => {
    const summary = summarizeAiCosts(snapshot, "anterior")

    expect(summary.rows.map((row) => row.organizationName)).toEqual(["Gama", "Imobiliária Alfa"])
    expect(summary.totals.costMillicents).toBe(2_000_000)
  })

  it("imobiliária sem consumo em nenhum ciclo some da lista", () => {
    expect(summarizeAiCosts(parsed([]), "atual")).toMatchObject({
      rows: [],
      totalCostCents: 0,
      totalCapRatio: null,
      calibration: { status: "sem_dados" },
    })
  })
})

describe("calibrateAiConversation", () => {
  const estimated = typicalConversationCostMillicents(AI_EXCHANGE_RATE_DEFAULT)

  function totals(conversations: number, costMillicents: number) {
    return { ...EMPTY_AI_USAGE, conversations, costMillicents }
  }

  it("compara a média medida com a conversa típica ao câmbio do banco", () => {
    const result = calibrateAiConversation(totals(100, estimated * 100))

    expect(result.status).toBe("dentro")
    expect(result.measuredMillicents).toBe(estimated)
    expect(result.deviation).toBe(0)
    expect(result.estimatedTokens).toEqual(typicalConversationTokens())
  })

  it("mais de 15% acima pede revisão da estimativa", () => {
    const result = calibrateAiConversation(totals(100, Math.round(estimated * 1.3) * 100))
    expect(result.status).toBe("acima")
    expect(result.deviation).toBeCloseTo(0.3, 3)
    expect(result.message).toContain("30% a mais")
  })

  it("mais de 15% abaixo permite recalibrar para baixo", () => {
    const result = calibrateAiConversation(totals(50, Math.round(estimated * 0.5) * 50))
    expect(result.status).toBe("abaixo")
    expect(result.message).toContain("50% a menos")
  })

  it("amostra pequena não recomenda mudar nada", () => {
    const result = calibrateAiConversation(
      totals(AI_COST_MIN_SAMPLE_CONVERSATIONS - 1, estimated * 10)
    )
    expect(result.status).toBe("amostra_pequena")
  })

  it("câmbio diferente muda a estimativa na mesma proporção", () => {
    const low = calibrateAiConversation(totals(0, 0), 5)
    const high = calibrateAiConversation(totals(0, 0), 10)
    expect(high.estimatedMillicents / low.estimatedMillicents).toBeCloseTo(2, 2)
  })

  it("tokens por conversa medidos", () => {
    const result = calibrateAiConversation({
      ...EMPTY_AI_USAGE,
      conversations: 4,
      inputTokens: 4_000,
      outputTokens: 1_002,
      cacheReadTokens: 0,
      cacheWriteTokens: 8,
      costMillicents: 1,
    })
    expect(result.measuredTokens).toEqual({
      inputTokens: 1_000,
      outputTokens: 251,
      cacheReadTokens: 0,
      cacheWriteTokens: 2,
    })
  })
})

describe("checkAiPricing", () => {
  it("banco e core iguais", () => {
    const check = checkAiPricing(parsed())

    expect(check.exchangeRateMatches).toBe(true)
    expect(check.batchMultiplierMatches).toBe(true)
    expect(check.pricesMatch).toBe(true)
    expect(check.models.map((model) => [model.model, model.matches])).toEqual([
      ["claude-sonnet-5", true],
      ["claude-haiku-4-5", true],
    ])
    expect(check.planCaps.every((cap) => cap.matches)).toBe(true)
    expect(check.planCaps.find((cap) => cap.planKey === "rede")?.coreCents).toBe(
      aiCostCapCents("rede")
    )
  })

  it("mostra franquia e conversas que cabem em cada teto (teste grátis sem IA)", () => {
    const caps = checkAiPricing(parsed()).planCaps

    expect(
      caps.map((cap) => [
        cap.planKey,
        cap.databaseCents,
        cap.conversations,
        cap.conversationsWithinCap,
      ])
    ).toEqual([
      ["corretor", 0, 0, 0],
      ["trial", 0, 0, 0],
      ["imobiliaria", 3456, 50, 62],
      ["equipe", 13824, 200, 250],
      ["rede", 34559, 500, 625],
    ])
  })

  it("aponta modelo com preço diferente, modelo só no banco e lote divergente", () => {
    const base = payload()
    const snapshot = parsePlatformAiCosts({
      ...base,
      pricing: { ...base.pricing, batch_multiplier: 1 },
      models: [
        { ...base.models[0], usd_per_mtok_output: 15 },
        {
          model: "claude-desconhecido",
          label: "Desconhecido",
          usd_per_mtok_input: 0,
          usd_per_mtok_output: 0,
          usd_per_mtok_cache_read: 0,
          usd_per_mtok_cache_write: 0,
          usd_per_mtok_cache_write_1h: 0,
        },
      ],
    })

    if (!snapshot) throw new Error("payload inválido")

    const check = checkAiPricing(snapshot)
    expect(check.batchMultiplierMatches).toBe(false)
    expect(check.pricesMatch).toBe(false)
    expect(
      check.models.map((model) => [model.model, model.matches, model.database !== null])
    ).toEqual([
      ["claude-sonnet-5", false, true],
      ["claude-haiku-4-5", false, false],
      ["claude-desconhecido", false, true],
    ])
  })

  it("resumo traz o custo típico por tipo de uso ao câmbio do banco", () => {
    const summary = summarizeAiCosts(parsed(), "atual")

    expect(summary.typicalCosts.map((cost) => [cost.kind, cost.model])).toEqual([
      ["conversation", "claude-sonnet-5"],
      ["listing_copy", "claude-sonnet-5"],
      ["conversation_summary", "claude-haiku-4-5"],
      ["reply_suggestion", "claude-haiku-4-5"],
    ])
  })

  it("aponta câmbio e teto divergentes", () => {
    const snapshot = parsePlatformAiCosts({
      ...payload(),
      pricing: { ...payload().pricing, exchange_rate: 5.6 },
      plan_caps_cents: { equipe: 8985, desconhecido: 10 },
    })

    if (!snapshot) throw new Error("payload inválido")

    const check = checkAiPricing(snapshot)
    expect(check.exchangeRateMatches).toBe(false)
    expect(check.databaseExchangeRate).toBe(5.6)
    expect(check.planCaps).toMatchObject([
      {
        planKey: "desconhecido",
        databaseCents: 10,
        coreCents: null,
        matches: false,
        conversations: null,
      },
      {
        planKey: "equipe",
        databaseCents: 8985,
        coreCents: aiCostCapCents("equipe"),
        matches: false,
        conversations: 200,
      },
    ])
  })
})

describe("formatação", () => {
  it("millicents em reais, com 4 casas abaixo de um centavo", () => {
    expect(formatAiMillicents(450_123)).toBe("R$ 4,50")
    expect(formatAiMillicents(420)).toBe("R$ 0,0042")
    expect(formatAiMillicents(0)).toBe("R$ 0,00")
    expect(formatAiMillicents(Number.NaN)).toBe("R$ 0,00")
  })

  it("porcentagem", () => {
    expect(formatAiRatio(0.8)).toBe("80%")
    expect(formatAiRatio(0.054)).toBe("5,4%")
    expect(formatAiRatio(null)).toBe("—")
  })

  it("ciclos", () => {
    expect(isAiCostCycle("anterior")).toBe(true)
    expect(isAiCostCycle("outro")).toBe(false)
  })
})
