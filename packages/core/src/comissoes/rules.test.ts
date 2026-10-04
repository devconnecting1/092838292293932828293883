import { describe, expect, it } from "vitest"

import {
  commissionTotalCents,
  DEFAULT_COMMISSION_RULES,
  describeSplitImbalance,
  formatPercent,
  fromMilliPercent,
  isSplitBalanced,
  splitTotalMilli,
  toMilliPercent,
  type CommissionRule,
  type CommissionSplit,
} from "./rules"

const BALANCED: CommissionSplit = {
  capturer: 20,
  seller: 30,
  manager: 10,
  agency: 40,
  partner: 0,
}

describe("percentuais em milésimos", () => {
  it("converte ida e volta sem erro de ponto flutuante", () => {
    expect(toMilliPercent(6)).toBe(6000)
    expect(toMilliPercent(33.333)).toBe(33333)
    expect(toMilliPercent(0.1)).toBe(100)
    expect(fromMilliPercent(33334)).toBe(33.334)
  })

  it("formata no padrão pt-BR", () => {
    expect(formatPercent(6)).toBe("6%")
    expect(formatPercent(6.5)).toBe("6,5%")
    expect(formatPercent(33.334)).toBe("33,334%")
  })
})

describe("isSplitBalanced", () => {
  it("aceita só divisão que fecha exatamente 100%", () => {
    expect(isSplitBalanced(BALANCED)).toBe(true)
    expect(
      isSplitBalanced({ capturer: 33.333, seller: 33.333, manager: 33.334, agency: 0, partner: 0 })
    ).toBe(true)
    // 0,1 + 0,2 em ponto flutuante daria 0,30000000000000004: em milésimos, não.
    expect(
      isSplitBalanced({ capturer: 0.1, seller: 0.2, manager: 0, agency: 99.7, partner: 0 })
    ).toBe(true)
  })

  it("recusa divisão que não fecha", () => {
    const over: CommissionSplit = { ...BALANCED, partner: 5 }
    const under: CommissionSplit = { ...BALANCED, agency: 35 }

    expect(isSplitBalanced(over)).toBe(false)
    expect(isSplitBalanced(under)).toBe(false)
    expect(splitTotalMilli(over)).toBe(105_000)
    expect(describeSplitImbalance(over)).toBe("A divisão soma 105%: tire 5%.")
    expect(describeSplitImbalance(under)).toBe("A divisão soma 95%: faltam 5%.")
    expect(describeSplitImbalance(BALANCED)).toBeNull()
  })

  it("recusa diferença de um milésimo", () => {
    expect(
      isSplitBalanced({ capturer: 33.333, seller: 33.333, manager: 33.333, agency: 0, partner: 0 })
    ).toBe(false)
  })
})

describe("commissionTotalCents", () => {
  const percentRule: CommissionRule = {
    purpose: "sale",
    basis: "percent",
    percent: 6,
    fixedCents: 0,
    split: BALANCED,
  }

  it("aplica o percentual sobre o valor do negócio", () => {
    // R$ 350.000,00 × 6% = R$ 21.000,00
    expect(commissionTotalCents(percentRule, 35_000_000)).toBe(2_100_000)
    expect(commissionTotalCents({ ...percentRule, percent: 6.5 }, 35_000_000)).toBe(2_275_000)
  })

  it("arredonda meio centavo para cima", () => {
    expect(commissionTotalCents({ ...percentRule, percent: 50 }, 1)).toBe(1)
    expect(commissionTotalCents({ ...percentRule, percent: 25 }, 1)).toBe(0)
    expect(commissionTotalCents({ ...percentRule, percent: 33.333 }, 1_000_001)).toBe(333_330)
  })

  it("não estoura o inteiro seguro em valores grandes", () => {
    // 999.999.999.999,99 (teto de numeric(14,2)) × 6%
    expect(commissionTotalCents(percentRule, 99_999_999_999_999)).toBe(6_000_000_000_000)
  })

  it("usa o valor fixo, limitado ao valor do negócio", () => {
    const fixed: CommissionRule = { ...percentRule, basis: "fixed", fixedCents: 500_000 }

    expect(commissionTotalCents(fixed, 35_000_000)).toBe(500_000)
    expect(commissionTotalCents(fixed, 100_000)).toBe(100_000)
  })

  it("trata valores inválidos como zero", () => {
    expect(commissionTotalCents(percentRule, 0)).toBe(0)
    expect(commissionTotalCents(percentRule, -1)).toBe(0)
    expect(commissionTotalCents(percentRule, Number.NaN)).toBe(0)
    expect(commissionTotalCents({ ...percentRule, percent: 0 }, 35_000_000)).toBe(0)
  })
})

describe("regra padrão", () => {
  it("é 6% na venda e um aluguel na locação, com divisão que fecha", () => {
    expect(DEFAULT_COMMISSION_RULES.sale.percent).toBe(6)
    expect(DEFAULT_COMMISSION_RULES.rent.percent).toBe(100)
    expect(isSplitBalanced(DEFAULT_COMMISSION_RULES.sale.split)).toBe(true)
    expect(isSplitBalanced(DEFAULT_COMMISSION_RULES.rent.split)).toBe(true)
  })
})
