import { describe, expect, it } from "vitest"

import { FEATURE_KEYS, featuresForPlan } from "./features"
import { LIMIT_KEYS } from "./limits"
import {
  ADDONS,
  AI_OVERAGE_NOTE,
  AI_TRIAL_NOTE,
  ANNUAL_BOLETO_NOTE,
  ANNUAL_BOLETO_PLANS,
  BILLING_INTERVALS,
  GRACE_DAYS,
  PLAN_CONDITIONS,
  PLAN_KEYS,
  PLANS,
  IMPORTED_LISTINGS_NOTE,
  OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT,
  OWNED_LISTING_RELEASED_STATUS_TEXT,
  OWNED_LISTINGS_NOTE,
  TRIAL_AI_CONVERSATIONS,
  TRIAL_DAYS,
  TRIAL_LIMITS,
  MAX_OWNED_LISTING_PACKS,
  OWNED_LISTINGS_ADDON_KEY,
  OWNED_LISTINGS_PACK_PRICE,
  OWNED_LISTINGS_PACK_SIZE,
  addonLookupKey,
  clampExtraSeats,
  clampOwnedListingPacks,
  isBillingInterval,
  isBillingPlanKey,
  isPlanKey,
  maxExtraSeats,
  parseAddonLookupKey,
  parseLookupKey,
  planTotal,
  priceLookupKey,
  seatLookupKey,
} from "./plans"

describe("PLANS", () => {
  it("segue a tabela de preços do contrato, em centavos", () => {
    expect(PLANS.corretor.prices).toEqual({ month: 11500, year: 115000 })
    expect(PLANS.imobiliaria.prices).toEqual({ month: 32000, year: 320000 })
    expect(PLANS.equipe.prices).toEqual({ month: 77500, year: 775000 })
    expect(PLANS.rede.prices).toEqual({ month: 193000, year: 1930000 })

    // O assento sobe junto com o plano, de propósito: quem tem operação maior
    // paga pelo tamanho dela, e é quem mais consome suporte humano.
    expect(PLANS.corretor.seatPrice).toEqual({ month: 4900, year: 49000 })
    expect(PLANS.imobiliaria.seatPrice).toEqual({ month: 5900, year: 59000 })
    expect(PLANS.equipe.seatPrice).toEqual({ month: 6900, year: 69000 })
    expect(PLANS.rede.seatPrice).toEqual({ month: 7900, year: 79000 })
    for (let i = 1; i < PLAN_KEYS.length; i += 1) {
      const anterior = PLANS[PLAN_KEYS[i - 1]!].seatPrice.month
      expect(PLANS[PLAN_KEYS[i]!].seatPrice.month).toBeGreaterThan(anterior)
    }
  })

  it("publica exatamente 1 landing page em todos os planos", () => {
    // Decisão do dono: não vendemos página extra; os 9 modelos ficam
    // disponíveis em qualquer plano e o cliente troca quando quiser.
    for (const plan of PLAN_KEYS) {
      expect(PLANS[plan].limits.landing_pages, plan).toBe(1)
    }
    expect(ADDONS.map((addon) => addon.key)).not.toContain("landing_pages")
  })

  it("cobra o anual como 10 mensalidades (2 meses grátis)", () => {
    for (const plan of PLAN_KEYS) {
      expect(PLANS[plan].prices.year).toBe(PLANS[plan].prices.month * 10)
      expect(PLANS[plan].seatPrice.year).toBe(PLANS[plan].seatPrice.month * 10)
    }
  })

  it("segue os limites da tabela do contrato", () => {
    expect(PLANS.corretor.limits).toEqual({
      users: 1,
      landing_pages: 1,
      owned_listings: 5,
      photos_per_listing: 10,
      pipelines: 1,
      ai_conversations: 0,
      whatsapp_numbers: 1,
      rental_contracts: 0,
      esign_docs: 5,
      branches: 1,
    })
    expect(PLANS.imobiliaria.limits).toEqual({
      users: 3,
      landing_pages: 1,
      owned_listings: 20,
      photos_per_listing: 10,
      pipelines: 3,
      ai_conversations: 50,
      whatsapp_numbers: 1,
      rental_contracts: 20,
      esign_docs: 15,
      branches: 1,
    })
    expect(PLANS.equipe.limits).toEqual({
      users: 5,
      landing_pages: 1,
      owned_listings: 50,
      photos_per_listing: 10,
      pipelines: 10,
      ai_conversations: 200,
      whatsapp_numbers: 3,
      rental_contracts: 100,
      esign_docs: 40,
      branches: 1,
    })
    expect(PLANS.rede.limits).toEqual({
      users: 10,
      landing_pages: 1,
      owned_listings: 150,
      photos_per_listing: 10,
      pipelines: -1,
      ai_conversations: 500,
      whatsapp_numbers: 10,
      rental_contracts: 300,
      esign_docs: 100,
      branches: 5,
    })
  })

  it("mantém usuários, chave e teto coerentes", () => {
    expect(PLANS.corretor.usersMax).toBe(2)
    for (const plan of PLAN_KEYS) {
      const definition = PLANS[plan]
      expect(definition.key).toBe(plan)
      expect(definition.limits.users).toBe(definition.usersIncluded)
      expect(Object.keys(definition.limits).sort()).toEqual([...LIMIT_KEYS].sort())
      if (plan !== "corretor") {
        expect(definition.usersMax).toBe(-1)
      }
    }
  })

  it("deriva os recursos de FEATURES, na ordem do catálogo", () => {
    for (const plan of PLAN_KEYS) {
      expect(PLANS[plan].features).toEqual(featuresForPlan(plan))
      const order = PLANS[plan].features.map((feature) => FEATURE_KEYS.indexOf(feature))
      expect(order).toEqual([...order].sort((a, b) => a - b))
    }
  })

  it("traz textos de venda em pt-BR com o preço formatado", () => {
    expect(PLANS.corretor.name).toBe("Corretor")
    expect(PLANS.imobiliaria.name).toBe("Imobiliária")
    expect(PLANS.imobiliaria.highlight).toBe(true)
    expect(PLANS.equipe.benefits.map((benefit) => benefit.text)).toContain(
      "5 usuários incluídos, extra por R$ 69/mês"
    )
    // O Corretor não tem IA: o cartão não pode prometer conversa nenhuma.
    expect(PLANS.corretor.limits.ai_conversations).toBe(0)
    expect(PLANS.corretor.benefits.map((benefit) => benefit.text).join(" ")).not.toMatch(/IA/)
    expect(PLANS.corretor.benefits).toContainEqual({
      text: "5 documentos com assinatura eletrônica por mês",
      status: "soon",
    })
    expect(PLANS.rede.benefits.map((benefit) => benefit.text)).toEqual(
      expect.arrayContaining([
        "150 imóveis à venda ou para alugar com fotos hospedadas por nós, até 10 fotos cada",
        "1 landing page no ar, com todos os modelos disponíveis",
        "500 conversas de IA e 10 números de WhatsApp",
      ])
    )

    for (const plan of PLAN_KEYS) {
      const definition = PLANS[plan]
      expect(definition.audience.trim()).not.toBe("")
      expect(definition.description.trim()).not.toBe("")
      expect(definition.benefits.length).toBeGreaterThan(4)
      expect(definition.support.trim()).not.toBe("")
    }
  })
})

describe("imóveis com foto nos textos de venda", () => {
  it("nunca chama imóvel de ilimitado e mostra o limite do plano primeiro", () => {
    for (const plan of PLAN_KEYS) {
      const definition = PLANS[plan]
      const texts = definition.benefits.map((benefit) => benefit.text)

      expect(texts[0], plan).toBe(
        `${definition.limits.owned_listings} imóveis à venda ou para alugar com fotos hospedadas por nós, até ${definition.limits.photos_per_listing} fotos cada`
      )
      for (const text of texts) {
        expect(text, plan).not.toMatch(/imóve[li]s?[^.]*ilimitad|ilimitad[^.]*imóve/i)
        expect(text, plan).not.toMatch(/nunca por imóvel/i)
      }
    }

    for (const text of [...PLAN_CONDITIONS, ...ADDONS.map((addon) => addon.description)]) {
      expect(text).not.toMatch(/imóveis ilimitados|sem limite de quantidade|nunca por imóvel/i)
    }
  })

  it("diz que vendido, alugado e inativo não contam, com os rótulos da tela de imóveis", () => {
    expect(OWNED_LISTING_RELEASED_STATUS_TEXT).toBe("vendido, alugado ou inativo")
    expect(OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT).toBe("vendidos, alugados e inativos")
    expect(OWNED_LISTINGS_NOTE).toBe(
      "O limite de imóveis do plano vale só para imóveis à venda ou para alugar com fotos hospedadas por nós: imóvel sem foto ou marcado como vendido, alugado ou inativo não conta"
    )
  })
})

describe("teste grátis", () => {
  it("dura 14 dias com 7 de carência", () => {
    expect(TRIAL_DAYS).toBe(14)
    expect(GRACE_DAYS).toBe(7)
  })

  it("usa os limites do Equipe, sem IA (a IA começa quando a imobiliária assina)", () => {
    expect(TRIAL_AI_CONVERSATIONS).toBe(0)
    expect(TRIAL_LIMITS).toEqual({ ...PLANS.equipe.limits, ai_conversations: 0 })
    expect(TRIAL_LIMITS).toMatchObject({
      users: 5,
      landing_pages: 1,
      owned_listings: 50,
      photos_per_listing: 10,
      pipelines: 10,
      ai_conversations: 0,
      esign_docs: 40,
    })
  })

  it("avisa nas condições que o teste não tem IA", () => {
    expect(AI_TRIAL_NOTE).toBe(
      "O teste grátis tem os recursos do plano Equipe, menos a IA: a IA começa quando você assina"
    )
    expect(PLAN_CONDITIONS).toContain(AI_TRIAL_NOTE)
    for (const text of PLAN_CONDITIONS) {
      expect(text).not.toMatch(/teste[^.]*\d+ conversas de IA/i)
    }
  })
})

describe("ADDONS e condições", () => {
  it("lista os add-ons com preço formatado e só o de imóveis à venda", () => {
    expect(ADDONS.map((addon) => addon.key)).toEqual([
      "ai_conversations",
      "rental",
      "esign",
      "owned_listings",
      "branch",
      "launches",
    ])
    for (const addon of ADDONS) {
      expect(addon.status).toBe(addon.key === OWNED_LISTINGS_ADDON_KEY ? "available" : "soon")
      expect(addon.plans.length).toBeGreaterThan(0)
      expect(addon.priceLabel).toContain("R$")
    }
    expect(ADDONS[0]?.priceLabel).toBe(
      "+100 por R$ 119/mês · +500 por R$ 490/mês · +2.000 por R$ 1.990/mês"
    )
    expect(ADDONS.find((addon) => addon.key === "esign")?.priceLabel).toBe(
      "20 documentos por R$ 29/mês · 100 por R$ 149/mês"
    )
    expect(ADDONS.find((addon) => addon.key === "owned_listings")?.priceLabel).toBe(
      "+10 imóveis por R$ 19/mês"
    )
    expect(ADDONS.find((addon) => addon.key === "branch")?.priceLabel).toBe("R$ 190/mês por loja")
    expect(ADDONS.find((addon) => addon.key === "rental")?.priceLabel).toBe(
      "R$ 1,90 por contrato ativo/mês (mínimo de R$ 19/mês no Corretor)"
    )
    expect(ADDONS.find((addon) => addon.key === "branch")?.plans).toEqual(["rede"])
    // Excedente de IA só onde existe franquia de IA.
    expect(ADDONS.find((addon) => addon.key === "ai_conversations")?.plans).toEqual([
      "imobiliaria",
      "equipe",
      "rede",
    ])
    expect(ADDONS.find((addon) => addon.key === "launches")?.plans).toEqual([
      "imobiliaria",
      "equipe",
    ])
  })

  it("exibe as condições comerciais", () => {
    expect(PLAN_CONDITIONS[0]).toBe("14 dias de teste grátis, sem cartão")
    expect(PLAN_CONDITIONS.length).toBeGreaterThanOrEqual(8)
  })

  it("exibe as regras de imóveis próprios, excedente de IA e boleto no anual", () => {
    expect(PLAN_CONDITIONS).toEqual(
      expect.arrayContaining([
        IMPORTED_LISTINGS_NOTE,
        OWNED_LISTINGS_NOTE,
        AI_OVERAGE_NOTE,
        ANNUAL_BOLETO_NOTE,
      ])
    )
    // Foto baixada por link na importação conta; só não conta a que fica na origem.
    expect(IMPORTED_LISTINGS_NOTE).toBe(
      "Imóvel com fotos só em link para o site de origem não conta no limite; fotos trazidas por link na importação de planilhas são copiadas para cá e contam"
    )
    for (const text of [...PLAN_CONDITIONS, ...ADDONS.map((addon) => addon.description)]) {
      expect(text).not.toMatch(/importados? por XML ou API/i)
    }
    expect(ANNUAL_BOLETO_NOTE).toBe(
      "No plano anual, o boleto é a forma sugerida e sai mais barato para os dois lados; o cartão continua disponível"
    )
    // Boleto é taxa fixa (R$ 3,45) e cartão é percentual: no anual vale para todos.
    expect(ANNUAL_BOLETO_PLANS).toEqual(PLAN_KEYS)
    expect(ADDONS.find((addon) => addon.key === "ai_conversations")?.description).toContain(
      AI_OVERAGE_NOTE
    )
    expect(ADDONS.find((addon) => addon.key === "owned_listings")?.description).toContain(
      IMPORTED_LISTINGS_NOTE
    )
    // Nenhum add-on cobra implantação: todo mundo usa o endereço incluso no plano.
    expect(ADDONS.map((addon) => addon.key)).not.toContain("custom_domain")
    expect(PLAN_CONDITIONS).toContain("Sem fidelidade e sem taxa de implantação")
    for (const text of [...PLAN_CONDITIONS, ...ADDONS.map((addon) => addon.description)]) {
      expect(text).not.toMatch(/\bR2\b/)
    }
  })
})

describe("guards", () => {
  it("reconhece chaves de plano e intervalo", () => {
    expect(isPlanKey("equipe")).toBe(true)
    expect(isPlanKey("trial")).toBe(false)
    expect(isPlanKey(undefined)).toBe(false)
    expect(isBillingPlanKey("trial")).toBe(true)
    expect(isBillingPlanKey("ouro")).toBe(false)
    expect(isBillingInterval("month")).toBe(true)
    expect(isBillingInterval("monthly")).toBe(false)
  })
})

describe("lookup keys", () => {
  it("monta as chaves dos Prices", () => {
    expect(priceLookupKey("equipe", "month")).toBe("plan_equipe_monthly")
    expect(priceLookupKey("rede", "year")).toBe("plan_rede_yearly")
    expect(seatLookupKey("corretor", "month")).toBe("seat_corretor_monthly")
    expect(seatLookupKey("imobiliaria", "year")).toBe("seat_imobiliaria_yearly")
  })

  it("faz ida e volta em todas as combinações", () => {
    for (const plan of PLAN_KEYS) {
      for (const interval of BILLING_INTERVALS) {
        expect(parseLookupKey(priceLookupKey(plan, interval))).toEqual({
          kind: "plan",
          plan,
          interval,
        })
        expect(parseLookupKey(seatLookupKey(plan, interval))).toEqual({
          kind: "seat",
          plan,
          interval,
        })
      }
    }
  })

  it("monta e lê as chaves do adicional de imóveis", () => {
    expect(addonLookupKey("owned_listings", "month")).toBe("addon_owned_listings_monthly")
    expect(addonLookupKey("owned_listings", "year")).toBe("addon_owned_listings_yearly")
    for (const interval of BILLING_INTERVALS) {
      expect(parseAddonLookupKey(addonLookupKey("owned_listings", interval))).toEqual({
        addon: "owned_listings",
        interval,
      })
      // Adicional não é plano nem assento.
      expect(parseLookupKey(addonLookupKey("owned_listings", interval))).toBeNull()
    }
    expect(parseAddonLookupKey("addon_launches_monthly")).toBeNull()
    expect(parseAddonLookupKey("addon_owned_listings_weekly")).toBeNull()
    expect(parseAddonLookupKey("seat_corretor_monthly")).toBeNull()
    expect(parseAddonLookupKey(null as unknown as string)).toBeNull()
  })

  it("recusa chaves fora do padrão", () => {
    expect(parseLookupKey("plan_trial_monthly")).toBeNull()
    expect(parseLookupKey("plan_ouro_monthly")).toBeNull()
    expect(parseLookupKey("plan_equipe_weekly")).toBeNull()
    expect(parseLookupKey("addon_storage_50gb_monthly")).toBeNull()
    expect(parseLookupKey("addon_launches_monthly")).toBeNull()
    expect(parseLookupKey("PLAN_EQUIPE_MONTHLY")).toBeNull()
    expect(parseLookupKey(" plan_equipe_monthly")).toBeNull()
    expect(parseLookupKey("plan_equipe_monthly_x")).toBeNull()
    expect(parseLookupKey("")).toBeNull()
    expect(parseLookupKey(null as unknown as string)).toBeNull()
  })
})

describe("assentos e totais", () => {
  it("calcula o teto de extras por plano", () => {
    expect(maxExtraSeats("corretor")).toBe(1)
    expect(maxExtraSeats("rede")).toBe(Number.POSITIVE_INFINITY)
  })

  it("normaliza e capa os extras", () => {
    expect(clampExtraSeats("corretor", 5)).toBe(1)
    expect(clampExtraSeats("imobiliaria", 2.9)).toBe(2)
    expect(clampExtraSeats("equipe", -3)).toBe(0)
    expect(clampExtraSeats("equipe", Number.NaN)).toBe(0)
    expect(clampExtraSeats("rede", 40)).toBe(40)
  })

  it("soma plano e extras no intervalo pedido", () => {
    expect(planTotal("imobiliaria", "month")).toBe(32000)
    expect(planTotal("imobiliaria", "month", 2)).toBe(32000 + 2 * 5900)
    expect(planTotal("equipe", "year", 3)).toBe(775000 + 3 * 69000)
    expect(planTotal("corretor", "month", 9)).toBe(11500 + 4900)
  })

  it("soma os pacotes de +10 imóveis no preço anunciado", () => {
    expect(OWNED_LISTINGS_PACK_SIZE).toBe(10)
    // Anual = 10 mensalidades, como plano e assento.
    expect(OWNED_LISTINGS_PACK_PRICE).toEqual({ month: 1900, year: 19000 })
    expect(ADDONS.find((addon) => addon.key === "owned_listings")?.description).toContain(
      "R$ 190/ano"
    )
    // Queixa do Corretor: R$ 134 por 15 imóveis e R$ 153 por 25.
    expect(planTotal("corretor", "month", 0, 1)).toBe(13400)
    expect(planTotal("corretor", "month", 0, 2)).toBe(15300)
    expect(planTotal("imobiliaria", "year", 1, 3)).toBe(320000 + 59000 + 3 * 19000)
    expect(clampOwnedListingPacks(-1)).toBe(0)
    expect(clampOwnedListingPacks(2.7)).toBe(2)
    expect(clampOwnedListingPacks(Number.NaN)).toBe(0)
    expect(clampOwnedListingPacks(10_000)).toBe(MAX_OWNED_LISTING_PACKS)
  })
})

describe("fotos de imóvel próprio", () => {
  it("guarda no máximo 2 MB por foto e 10 fotos por imóvel em todos os planos", async () => {
    const { LISTING_PHOTO_MAX_BYTES, LISTING_PHOTO_MAX_MB, PLANS } = await import("./plans")
    const { MAX_PROPERTY_PHOTOS } = await import("../media/limits")

    expect(LISTING_PHOTO_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(LISTING_PHOTO_MAX_MB).toBe(2)
    for (const plan of Object.values(PLANS)) {
      expect(plan.limits.photos_per_listing).toBe(MAX_PROPERTY_PHOTOS)
    }
  })
})
