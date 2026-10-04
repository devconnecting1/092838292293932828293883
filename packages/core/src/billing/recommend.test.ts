import { describe, expect, it } from "vitest"

import { PLAN_KEYS, PLANS, maxExtraSeats, planTotal, type PlanKey } from "./plans"
import { recommendPlan } from "./recommend"

/** Custo mensal do plano para a equipe inteira, ou null se o plano não comporta. */
function monthlyCostFor(plan: PlanKey, teamSize: number, ownedListings: number) {
  const definition = PLANS[plan]
  const fitsUsers = definition.usersMax < 0 || teamSize <= definition.usersMax
  const limit = definition.limits.owned_listings
  const fitsListings = limit < 0 || ownedListings <= limit

  if (!fitsUsers || !fitsListings) {
    return null
  }

  return planTotal(plan, "month", Math.max(0, teamSize - definition.usersIncluded))
}

describe("recommendPlan: menor custo que atende usuários e imóveis com foto", () => {
  it("1 pessoa sem imóvel com foto → Corretor, com totais e economia anual", () => {
    expect(recommendPlan({ teamSize: 1, ownedListings: 0 })).toMatchObject({
      plan: "corretor",
      extraSeats: 0,
      monthlyTotal: 11500,
      yearlyTotal: 115000,
      yearlySavings: 23000,
      fitsOwnedListings: true,
    })
  })

  it("2 pessoas com 5 imóveis com foto ainda cabem no Corretor, com 1 extra", () => {
    expect(recommendPlan({ teamSize: 2, ownedListings: 5 })).toMatchObject({
      plan: "corretor",
      extraSeats: 1,
      monthlyTotal: 11500 + 4900,
    })
  })

  it("3 pessoas passam do teto do Corretor (2) e vão para o Imobiliária", () => {
    expect(recommendPlan({ teamSize: 3, ownedListings: 0 })).toMatchObject({
      plan: "imobiliaria",
      extraSeats: 0,
      monthlyTotal: 32000,
    })
  })

  it("18 usuários não vão para o Rede quando um plano menor com extras atende e sai mais barato", () => {
    // Poucos imóveis com foto: o Imobiliária com 15 extras é o mais barato.
    expect(recommendPlan({ teamSize: 18, ownedListings: 10 })).toMatchObject({
      plan: "imobiliaria",
      extraSeats: 15,
      monthlyTotal: 32000 + 15 * 5900,
      yearlyTotal: 320000 + 15 * 59000,
    })

    // 40 imóveis com foto passam do Imobiliária (20): Equipe com 13 extras.
    const equipe = recommendPlan({ teamSize: 18, ownedListings: 40 })
    expect(equipe).toMatchObject({
      plan: "equipe",
      extraSeats: 13,
      monthlyTotal: 77500 + 13 * 6900,
      yearlyTotal: 775000 + 13 * 69000,
      fitsOwnedListings: true,
    })
    expect(equipe.monthlyTotal).toBeLessThan(planTotal("rede", "month", 8))

    // Só acima de 50 imóveis com foto o Rede passa a ser o único que atende.
    expect(recommendPlan({ teamSize: 18, ownedListings: 100 })).toMatchObject({
      plan: "rede",
      extraSeats: 8,
      monthlyTotal: 193000 + 8 * 7900,
    })
  })

  it("7 usuários com 120 imóveis com foto → Rede, sem usuário extra", () => {
    expect(recommendPlan({ teamSize: 7, ownedListings: 120 })).toMatchObject({
      plan: "rede",
      extraSeats: 0,
      monthlyTotal: 193000,
      yearlyTotal: 1930000,
      yearlySavings: 386000,
      fitsOwnedListings: true,
    })
    expect(recommendPlan({ teamSize: 7, ownedListings: 120 }).reasons).toContain(
      "O plano Imobiliária sairia mais barato, mas comporta só 20 imóveis com foto."
    )
  })

  it("respeita o limite de imóveis com foto de cada plano, na borda", () => {
    const [corretor, imobiliaria, equipe, rede] = PLAN_KEYS.map(
      (plan) => PLANS[plan].limits.owned_listings
    )
    expect([corretor, imobiliaria, equipe, rede]).toEqual([5, 20, 50, 150])

    const planFor = (ownedListings: number) => recommendPlan({ teamSize: 1, ownedListings }).plan

    expect(planFor(5)).toBe("corretor")
    expect(planFor(6)).toBe("imobiliaria")
    expect(planFor(20)).toBe("imobiliaria")
    expect(planFor(21)).toBe("equipe")
    expect(planFor(50)).toBe("equipe")
    expect(planFor(51)).toBe("rede")
    expect(planFor(150)).toBe("rede")
    expect(recommendPlan({ teamSize: 1, ownedListings: 150 }).fitsOwnedListings).toBe(true)
  })

  it("acima do maior limite fica no plano que mais comporta e avisa", () => {
    const result = recommendPlan({ teamSize: 4, ownedListings: 151 })

    expect(result).toMatchObject({ plan: "rede", extraSeats: 0, fitsOwnedListings: false })
    expect(result.reasons[0]).toBe(
      "Nenhum plano comporta sozinho mais de 150 imóveis com foto. O plano Rede é o que mais comporta; para o restante, some 1 pacote de +10 imóveis por R$ 19/mês."
    )
  })

  it("calcula os pacotes de +10 imóveis que faltam acima do maior limite", () => {
    expect(recommendPlan({ teamSize: 12, ownedListings: 900 }).reasons[0]).toBe(
      "Nenhum plano comporta sozinho mais de 150 imóveis com foto. O plano Rede é o que mais comporta; para o restante, some 75 pacotes de +10 imóveis por R$ 1.425/mês."
    )
  })

  it("normaliza valores inválidos ou fracionados", () => {
    expect(recommendPlan({ teamSize: 0, ownedListings: 0 }).plan).toBe("corretor")
    expect(recommendPlan({ teamSize: -4, ownedListings: 0 }).plan).toBe("corretor")
    expect(recommendPlan({ teamSize: Number.NaN, ownedListings: Number.NaN }).plan).toBe("corretor")
    expect(recommendPlan({ teamSize: 1, ownedListings: -3 }).plan).toBe("corretor")
    expect(recommendPlan({ teamSize: 1, ownedListings: 5.2 }).plan).toBe("imobiliaria")
    expect(recommendPlan({ teamSize: 5.2, ownedListings: 0 })).toMatchObject({
      plan: "imobiliaria",
      extraSeats: 3,
    })
  })
})

describe("recommendPlan: coerência", () => {
  it("nunca existe plano que atenda e saia mais barato, e as contas fecham", () => {
    for (let teamSize = 1; teamSize <= 40; teamSize++) {
      for (const ownedListings of [0, 1, 5, 6, 19, 20, 21, 49, 50, 51, 120, 150, 151, 1000]) {
        const result = recommendPlan({ teamSize, ownedListings })
        const plan = PLANS[result.plan]

        expect(result.extraSeats).toBeLessThanOrEqual(maxExtraSeats(result.plan))
        expect(plan.usersIncluded + result.extraSeats).toBeGreaterThanOrEqual(teamSize)
        expect(result.monthlyTotal).toBe(
          plan.prices.month + result.extraSeats * plan.seatPrice.month
        )
        expect(result.yearlyTotal).toBe(plan.prices.year + result.extraSeats * plan.seatPrice.year)
        expect(result.yearlySavings).toBe(result.monthlyTotal * 12 - result.yearlyTotal)
        expect(result.yearlySavings).toBeGreaterThan(0)

        const costs = PLAN_KEYS.map((key) => monthlyCostFor(key, teamSize, ownedListings)).filter(
          (cost): cost is number => cost !== null
        )

        expect(result.fitsOwnedListings).toBe(costs.length > 0)

        if (costs.length > 0) {
          expect(result.monthlyTotal, `${teamSize} pessoas, ${ownedListings} imóveis`).toBe(
            Math.min(...costs)
          )
        }
      }
    }
  })

  it("explica a recomendação em pt-BR", () => {
    expect(recommendPlan({ teamSize: 1, ownedListings: 0 }).reasons).toEqual([
      "Para 1 pessoa e nenhum imóvel com foto, o plano Corretor é o de menor custo que atende.",
      "Imóveis sem foto, só com fotos hospedadas no site de origem, vendidos, alugados e inativos não contam no limite.",
    ])
    expect(recommendPlan({ teamSize: 2, ownedListings: 6 }).reasons).toEqual([
      "Para 2 pessoas e até 6 imóveis com foto, o plano Imobiliária é o de menor custo que atende.",
      "O plano Corretor sairia mais barato, mas comporta só 5 imóveis com foto.",
      "Imóveis sem foto, só com fotos hospedadas no site de origem, vendidos, alugados e inativos não contam no limite.",
    ])
    expect(recommendPlan({ teamSize: 5, ownedListings: 10 }).reasons).toContain(
      "Inclui 2 usuários extras além dos 3 do plano."
    )
  })
})
