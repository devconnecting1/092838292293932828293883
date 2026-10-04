import { describe, expect, it } from "vitest"

import { leadCost, sumInvestment } from "./lead-cost"

describe("leadCost", () => {
  it("R$ 3.000 com 150 leads e 3 ganhos: CPL R$ 20,00 e custo por ganho R$ 1.000,00", () => {
    expect(leadCost({ investment: 3000, leads: 150, won: 3 })).toEqual({
      investment: 3000,
      costPerLead: 20,
      costPerWin: 1000,
    })
  })

  it("arredonda para centavos", () => {
    expect(leadCost({ investment: 100, leads: 3, won: 7 })).toEqual({
      investment: 100,
      costPerLead: 33.33,
      costPerWin: 14.29,
    })
  })

  it("sem investimento (recorte ou papel) não há custo", () => {
    expect(leadCost({ investment: null, leads: 10, won: 1 })).toEqual({
      investment: null,
      costPerLead: null,
      costPerWin: null,
    })
  })

  it("investimento zero não vira custo de R$ 0,00", () => {
    expect(leadCost({ investment: 0, leads: 10, won: 2 })).toEqual({
      investment: 0,
      costPerLead: null,
      costPerWin: null,
    })
  })

  it("sem leads ou sem ganhos não divide", () => {
    expect(leadCost({ investment: 500, leads: 0, won: 0 })).toEqual({
      investment: 500,
      costPerLead: null,
      costPerWin: null,
    })
    expect(leadCost({ investment: 500, leads: 5, won: 0 }).costPerWin).toBeNull()
  })

  it("valor não finito vira sem investimento", () => {
    expect(leadCost({ investment: Number.NaN, leads: 5, won: 1 }).investment).toBeNull()
  })
})

describe("sumInvestment", () => {
  it("soma só as linhas com investimento", () => {
    expect(sumInvestment([{ investment: 1000.1 }, { investment: null }, { investment: 0.2 }])).toBe(
      1000.3
    )
  })

  it("devolve null quando nenhuma linha trouxe investimento", () => {
    expect(sumInvestment([{ investment: null }, { investment: null }])).toBeNull()
    expect(sumInvestment([])).toBeNull()
  })

  it("zero lançado continua sendo zero (não null)", () => {
    expect(sumInvestment([{ investment: 0 }])).toBe(0)
  })
})
