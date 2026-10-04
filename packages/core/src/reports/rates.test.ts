import { describe, expect, it } from "vitest"

import {
  brokerRates,
  formatDecimal,
  formatHours,
  formatInteger,
  formatMinutes,
  formatRate,
  rate,
  ratePercent,
  stageRates,
} from "./rates"

describe("rate", () => {
  it("divide e devolve a fração", () => {
    expect(rate(1, 4)).toBe(0.25)
  })

  it("devolve null quando não há base para a conta", () => {
    expect(rate(3, 0)).toBeNull()
    expect(rate(3, -1)).toBeNull()
    expect(rate(Number.NaN, 10)).toBeNull()
  })

  it("não deixa a fatia passar de 1 (um lead pode reentrar na etapa)", () => {
    expect(rate(7, 5)).toBe(1)
  })
})

describe("formatRate", () => {
  it("escreve em pt-BR com uma casa", () => {
    expect(formatRate(0.125)).toBe("12,5%")
    expect(formatRate(1)).toBe("100%")
  })

  it("mostra travessão quando não dá para calcular", () => {
    expect(formatRate(null)).toBe("—")
    expect(formatRate(undefined)).toBe("—")
  })
})

describe("ratePercent", () => {
  it("vira número percentual para a planilha", () => {
    expect(ratePercent(0.125)).toBe(12.5)
    expect(ratePercent(1 / 3)).toBe(33.3)
    expect(ratePercent(null)).toBeNull()
  })
})

describe("formatInteger e formatDecimal", () => {
  it("formatam em pt-BR e tratam o vazio", () => {
    expect(formatInteger(1234)).toBe("1.234")
    expect(formatInteger(null)).toBe("—")
    expect(formatDecimal(12.34)).toBe("12,3")
    expect(formatDecimal(undefined)).toBe("—")
  })
})

describe("formatHours", () => {
  it("usa minutos abaixo de uma hora", () => {
    expect(formatHours(0)).toBe("0 min")
    expect(formatHours(0.3)).toBe("18 min")
  })

  it("usa horas e minutos até um dia", () => {
    expect(formatHours(2.5)).toBe("2 h 30 min")
    expect(formatHours(3)).toBe("3 h")
  })

  it("usa dias acima de 24 horas", () => {
    expect(formatHours(36)).toBe("1 d 12 h")
    expect(formatHours(48)).toBe("2 d")
    expect(formatHours(96)).toBe("4 d")
  })

  it("mostra travessão para vazio e para duração negativa", () => {
    expect(formatHours(null)).toBe("—")
    expect(formatHours(-1)).toBe("—")
  })
})

describe("formatMinutes", () => {
  it("lê a mediana do primeiro contato, que vem em minutos", () => {
    expect(formatMinutes(10)).toBe("10 min")
    expect(formatMinutes(155)).toBe("2 h 35 min")
    expect(formatMinutes(null)).toBe("—")
  })
})

describe("brokerRates", () => {
  it("calcula atendimento, SLA, fechamento e conversão de proposta", () => {
    expect(
      brokerRates({
        leadsReceived: 4,
        leadsAnswered: 3,
        leadsInSla: 1,
        leadsWon: 1,
        leadsLost: 3,
        proposalsMade: 2,
        proposalsClosed: 1,
      })
    ).toEqual({
      answerRate: 0.75,
      slaRate: 0.25,
      winRate: 0.25,
      proposalCloseRate: 0.5,
    })
  })

  it("devolve null em vez de dividir por zero no corretor sem movimento", () => {
    expect(
      brokerRates({
        leadsReceived: 0,
        leadsAnswered: 0,
        leadsInSla: 0,
        leadsWon: 0,
        leadsLost: 0,
        proposalsMade: 0,
        proposalsClosed: 0,
      })
    ).toEqual({
      answerRate: null,
      slaRate: null,
      winRate: null,
      proposalCloseRate: null,
    })
  })
})

describe("stageRates", () => {
  it("calcula a conversão entre etapas, a perda e quem ficou parado", () => {
    expect(stageRates({ entered: 10, advanced: 6, lostAfter: 3, stillThere: 1 })).toEqual({
      advanceRate: 0.6,
      lossRate: 0.3,
      stuckRate: 0.1,
      left: 9,
    })
  })

  it("etapa sem entrada não inventa taxa", () => {
    expect(stageRates({ entered: 0, advanced: 0, lostAfter: 0, stillThere: 0 })).toEqual({
      advanceRate: null,
      lossRate: null,
      stuckRate: null,
      left: 0,
    })
  })
})
