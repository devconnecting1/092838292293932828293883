import { describe, expect, it } from "vitest"

import {
  WEEKLY_REPORT_MAX_BROKERS,
  weeklyReportEmail,
  type WeeklyReportBroker,
} from "./agenda-templates"
import { weeklyReportBrokersCsv, weeklyReportNeedsCsv } from "./weekly-report-csv"
import { CSV_BOM } from "../reports/csv"

const ORIGIN = "https://teste.exemplo.com.br"

function brokers(total: number): WeeklyReportBroker[] {
  return Array.from({ length: total }, (_, index) => ({
    name: index === 0 ? '=HYPERLINK("x")' : `Corretor ${index + 1}`,
    active: index !== 1,
    leadsReceived: index + 1,
    firstResponseMedianMinutes: index === 2 ? null : 12.6,
    visitsDone: 1,
    visitsScheduled: 2,
    proposalsMade: 0,
    proposalsClosed: 0,
    leadsWon: 0,
  }))
}

const totals = {
  leadsReceived: 40,
  leadsAnswered: 30,
  leadsInSla: 20,
  leadsWon: 1,
  leadsLost: 0,
  visitsScheduled: 10,
  visitsDone: 5,
  visitsNoShow: 0,
  proposalsMade: 1,
  proposalsClosed: 0,
  proposalsClosedAmount: 0,
  brokersWithActivity: 45,
}

describe("weeklyReportBrokersCsv", () => {
  it("não gera anexo quando todos cabem no corpo", () => {
    const list = brokers(WEEKLY_REPORT_MAX_BROKERS)
    expect(weeklyReportNeedsCsv(list)).toBe(false)
    expect(
      weeklyReportBrokersCsv({ weekStart: "2026-09-07", weekEnd: "2026-09-13", brokers: list })
    ).toBeNull()
  })

  it("acima do corpo: CSV com todos, sem fórmula e com nome seguro", () => {
    const list = brokers(45)
    const csv = weeklyReportBrokersCsv({
      weekStart: "2026-09-07",
      weekEnd: "2026-09-13",
      brokers: list,
    })

    expect(csv?.name).toBe("relatorio-semanal-corretores_2026-09-07_2026-09-13.csv")
    const lines = csv?.content.replace(CSV_BOM, "").trimEnd().split("\r\n") ?? []
    expect(lines).toHaveLength(46)
    expect(lines[0]).toContain("Corretor;Situação;Leads recebidos")
    expect(lines[1]?.startsWith("\"'=HYPERLINK")).toBe(true)
    expect(lines[2]).toContain("Inativo")
    expect(lines[3]).toBe("Corretor 3;Ativo;3;;1;2;0;0;0")
    expect(lines[45]).toBe("Corretor 45;Ativo;45;13;1;2;0;0;0")
  })

  it("semana inválida não gera anexo", () => {
    expect(
      weeklyReportBrokersCsv({ weekStart: "07/09", weekEnd: "2026-09-13", brokers: brokers(45) })
    ).toBeNull()
  })

  it("o e-mail diz que a lista completa está no anexo", () => {
    const email = weeklyReportEmail({
      origin: ORIGIN,
      weekStart: "2026-09-07",
      weekEnd: "2026-09-13",
      totals,
      brokers: brokers(45),
    })

    expect(email.html).toContain("Mostrando 30 de 45 corretores")
    expect(email.text).toContain("anexo (planilha CSV)")
    expect(email.html).toContain("Corretor 30")
    expect(email.html).not.toContain("Corretor 31")
  })
})
