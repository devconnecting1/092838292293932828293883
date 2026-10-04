import { describe, expect, it } from "vitest"

import {
  currentMonthKey,
  daysInMonth,
  formatMonthLabel,
  goalMonthOptions,
  goalProgress,
  hasAnyGoal,
  isMonthKey,
  monthFirstDay,
  projectMonthEnd,
  resolveGoalMonth,
  shiftMonth,
} from "./sales-goals"

// 17/09/2026 às 10h de Brasília (13h UTC).
const NOW = new Date("2026-09-17T13:00:00Z")

describe("mês da meta", () => {
  it("valida AAAA-MM dentro do intervalo do banco", () => {
    expect(isMonthKey("2026-09")).toBe(true)
    expect(isMonthKey("2026-13")).toBe(false)
    expect(isMonthKey("2026-9")).toBe(false)
    expect(isMonthKey("1999-12")).toBe(false)
    expect(isMonthKey("2100-01")).toBe(false)
    expect(isMonthKey(202609)).toBe(false)
  })

  it("usa o mês de Brasília, não o de UTC", () => {
    // 01/10 às 01h UTC ainda é 30/09 em Brasília.
    expect(currentMonthKey(new Date("2026-10-01T01:00:00Z"))).toBe("2026-09")
  })

  it("cai no mês atual quando a URL traz lixo", () => {
    expect(resolveGoalMonth("2026-08", NOW)).toBe("2026-08")
    expect(resolveGoalMonth("abc", NOW)).toBe("2026-09")
    expect(resolveGoalMonth(undefined, NOW)).toBe("2026-09")
  })

  it("anda meses atravessando o ano", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
    expect(shiftMonth("2026-09", 0)).toBe("2026-09")
  })

  it("primeiro dia, dias do mês e rótulo", () => {
    expect(monthFirstDay("2026-09")).toBe("2026-09-01")
    expect(daysInMonth("2026-02")).toBe(28)
    expect(daysInMonth("2028-02")).toBe(29)
    expect(daysInMonth("2026-09")).toBe(30)
    expect(formatMonthLabel("2026-09")).toBe("setembro de 2026")
  })

  it("opções do seletor do mais novo ao mais antigo, com o escolhido incluído", () => {
    const options = goalMonthOptions("2020-01", NOW, { before: 2, after: 1 })

    expect(options.map((option) => option.value)).toEqual([
      "2026-10",
      "2026-09",
      "2026-08",
      "2026-07",
      "2020-01",
    ])
  })
})

describe("goalProgress", () => {
  it("meta de 4 vendas com 3 aceitas: 75%", () => {
    expect(goalProgress(3, 4)).toEqual({ ratio: 0.75, barValue: 75, reached: false })
  })

  it("passa de 100% no número, mas a barra para em 100", () => {
    expect(goalProgress(5, 4)).toEqual({ ratio: 1.25, barValue: 100, reached: true })
  })

  it("sem meta não há barra", () => {
    expect(goalProgress(3, null)).toEqual({ ratio: null, barValue: 0, reached: false })
  })

  it("meta zero conta como atingida", () => {
    expect(goalProgress(0, 0)).toEqual({ ratio: 1, barValue: 100, reached: true })
  })
})

describe("projectMonthEnd", () => {
  it("mês corrente: ritmo dos dias passados estendido ao mês", () => {
    // 17 dias passados, 34 atendidos → 2 por dia × 30 dias.
    expect(projectMonthEnd(34, "2026-09", NOW)).toBe(60)
  })

  it("mês fechado devolve o realizado; mês futuro, null", () => {
    expect(projectMonthEnd(12, "2026-08", NOW)).toBe(12)
    expect(projectMonthEnd(0, "2026-10", NOW)).toBeNull()
  })
})

describe("hasAnyGoal", () => {
  it("reconhece quando há pelo menos um indicador com meta", () => {
    const empty = {
      leadsAnswered: null,
      visits: null,
      proposals: null,
      salesCount: null,
      salesAmount: null,
      rentalsCount: null,
      rentalsAmount: null,
    }

    expect(hasAnyGoal(empty)).toBe(false)
    expect(hasAnyGoal({ ...empty, visits: 0 })).toBe(true)
  })
})
