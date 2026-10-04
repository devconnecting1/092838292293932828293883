import { describe, expect, it } from "vitest"

import {
  centsToReais,
  costPerLeadCents,
  dateToMonthKey,
  daysInMonthKey,
  formatMonthLabel,
  investmentKey,
  isMonthKey,
  listMonthKeys,
  monthKeyToDate,
  normalizeCampaign,
  prorateMonthlyInvestmentCents,
  reaisToCents,
  shiftMonthKey,
  summarizeInvestmentsBySource,
} from "./marketing-investments"

describe("mês", () => {
  it("valida o formato e o intervalo do banco", () => {
    expect(isMonthKey("2026-09")).toBe(true)
    expect(isMonthKey("2026-13")).toBe(false)
    expect(isMonthKey("1999-12")).toBe(false)
    expect(isMonthKey("2100-01")).toBe(false)
    expect(isMonthKey("2026-9")).toBe(false)
    expect(isMonthKey(202609)).toBe(false)
  })

  it("converte entre a tela e a coluna date", () => {
    expect(monthKeyToDate("2026-09")).toBe("2026-09-01")
    expect(dateToMonthKey("2026-09-01")).toBe("2026-09")
    expect(dateToMonthKey("2026-09-17")).toBe("2026-09")
    expect(dateToMonthKey("lixo")).toBeNull()
    expect(() => monthKeyToDate("2026-00")).toThrow()
  })

  it("anda meses atravessando o ano", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01")
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12")
    expect(shiftMonthKey("2026-09", -21)).toBe("2024-12")
    expect(shiftMonthKey("2000-01", -1)).toBeNull()
  })

  it("escreve o mês por extenso e conta os dias", () => {
    expect(formatMonthLabel("2026-03")).toBe("março de 2026")
    expect(daysInMonthKey("2026-09")).toBe(30)
    expect(daysInMonthKey("2028-02")).toBe(29)
  })

  it("lista do futuro para o passado", () => {
    expect(listMonthKeys("2026-01", 2, 1)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"])
  })
})

describe("campanha e dinheiro", () => {
  it("normaliza a campanha como o banco", () => {
    expect(normalizeCampaign("  lancamento-set  ")).toBe("lancamento-set")
    expect(normalizeCampaign("   ")).toBeNull()
    expect(normalizeCampaign(null)).toBeNull()
  })

  it("mesma chave sem diferença de maiúsculas e sem campanha vazia", () => {
    expect(investmentKey({ month: "2026-09-01", source: "social", campaign: "Promo" })).toBe(
      investmentKey({ month: "2026-09", source: "social", campaign: " promo " })
    )
    expect(investmentKey({ month: "2026-09", source: "social", campaign: "" })).toBe(
      investmentKey({ month: "2026-09", source: "social", campaign: null })
    )
  })

  it("converte reais e centavos sem erro de ponto flutuante", () => {
    expect(reaisToCents(1234.56)).toBe(123456)
    expect(reaisToCents("0.29")).toBe(29)
    expect(reaisToCents(null)).toBe(0)
    expect(reaisToCents("abc")).toBe(0)
    expect(centsToReais(123456)).toBe(1234.56)
  })
})

describe("resumo do mês", () => {
  it("soma por canal, separa campanha do canal inteiro e ordena", () => {
    const summary = summarizeInvestmentsBySource([
      { source: "social", campaign: "Lançamento", amountCents: 300_000 },
      { source: "portal", campaign: null, amountCents: 50_000 },
      { source: "social", campaign: null, amountCents: 100_000 },
      { source: "social", campaign: "Aluguel", amountCents: 20_000 },
    ])

    expect(summary.totalCents).toBe(470_000)
    expect(summary.sources.map((source) => source.source)).toEqual(["social", "portal"])
    expect(summary.sources[0]).toEqual({
      source: "social",
      totalCents: 420_000,
      channelCents: 100_000,
      campaigns: [
        { campaign: "Lançamento", amountCents: 300_000 },
        { campaign: "Aluguel", amountCents: 20_000 },
      ],
    })
  })

  it("mês vazio", () => {
    expect(summarizeInvestmentsBySource([])).toEqual({ totalCents: 0, sources: [] })
  })
})

describe("custo por lead", () => {
  it("R$ 3.000 para 150 leads = R$ 20,00; 3 ganhos = R$ 1.000,00", () => {
    expect(costPerLeadCents(300_000, 150)).toBe(2_000)
    expect(costPerLeadCents(300_000, 3)).toBe(100_000)
  })

  it("sem lead não tem custo por lead", () => {
    expect(costPerLeadCents(300_000, 0)).toBeNull()
    expect(costPerLeadCents(Number.NaN, 10)).toBeNull()
  })

  it("proporcional aos dias do período", () => {
    expect(prorateMonthlyInvestmentCents(300_000, 15, 30)).toBe(150_000)
    expect(prorateMonthlyInvestmentCents(300_000, 45, 30)).toBe(300_000)
    expect(prorateMonthlyInvestmentCents(300_000, 0, 30)).toBe(0)
  })
})
