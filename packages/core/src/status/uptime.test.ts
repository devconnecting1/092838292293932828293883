import { describe, expect, it } from "vitest"

import type { StatusDay } from "./public"
import {
  countDaysWithoutProblems,
  formatStatusDayKey,
  periodUptimePct,
  STATUS_HISTORY_DAYS,
  statusDayKey,
  statusDayKeys,
  UPTIME_CAPTIONS,
  uptimeCaption,
  uptimeCoverage,
  uptimePct,
} from "./uptime"

describe("uptimePct", () => {
  it("sem medição é null (barra cinza, nunca vermelha)", () => {
    expect(uptimePct(0, 0)).toBeNull()
    expect(uptimePct(Number.NaN, 10)).toBeNull()
    expect(uptimePct(-1, 10)).toBeNull()
  })

  it("tudo no ar é 100", () => {
    expect(uptimePct(1440, 1440)).toBe(100)
  })

  it("trunca em 2 casas e nunca arredonda uma falha para 100", () => {
    expect(uptimePct(4, 5)).toBe(80)
    expect(uptimePct(99999, 100000)).toBe(99.99)
    expect(uptimePct(1439, 1440)).toBe(99.93)
    expect(uptimePct(2, 3)).toBe(66.66)
  })

  it("não passa de 100 com contagem inconsistente", () => {
    expect(uptimePct(12, 10)).toBe(100)
  })
})

describe("periodUptimePct", () => {
  it("soma os dias com medição e ignora os sem", () => {
    expect(
      periodUptimePct([
        { good: 1440, total: 1440 },
        null,
        { good: 0, total: 0 },
        { good: 720, total: 1440 },
      ])
    ).toBe(75)
    expect(periodUptimePct([null, undefined])).toBeNull()
  })
})

describe("dias do calendário de São Paulo", () => {
  it("usa o dia de São Paulo, não o de UTC", () => {
    // 02:30 UTC ainda é 23:30 do dia anterior em São Paulo.
    expect(statusDayKey("2026-09-17T02:30:00Z")).toBe("2026-09-16")
    expect(statusDayKey("2026-09-17T03:30:00Z")).toBe("2026-09-17")
    expect(statusDayKey("não é data")).toBeNull()
  })

  it("90 dias terminando hoje, do mais antigo para o mais recente", () => {
    const keys = statusDayKeys(new Date("2026-09-17T12:00:00Z"))
    expect(keys).toHaveLength(STATUS_HISTORY_DAYS)
    expect(keys[0]).toBe("2026-06-20")
    expect(keys.at(-1)).toBe("2026-09-17")
    expect(new Set(keys).size).toBe(STATUS_HISTORY_DAYS)
  })

  it("atravessa virada de mês e de ano", () => {
    expect(statusDayKeys(new Date("2027-01-01T12:00:00Z"), 3)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ])
    expect(statusDayKeys(new Date("2027-01-01T12:00:00Z"), 0)).toEqual([])
  })
})

describe("countDaysWithoutProblems", () => {
  it("manutenção não conta como problema", () => {
    expect(
      countDaysWithoutProblems([
        { date: "2026-09-15", uptimePct: 100, worstLevel: "operational", incidentIds: [] },
        {
          date: "2026-09-16",
          uptimePct: null,
          worstLevel: "under_maintenance",
          incidentIds: ["a"],
        },
        { date: "2026-09-17", uptimePct: 98.5, worstLevel: "partial_outage", incidentIds: [] },
      ])
    ).toBe(2)
  })
})

/** 90 dias terminando em 2026-12-15; os `unmeasured` primeiros ficam sem medição. */
function barDays(unmeasured: number): StatusDay[] {
  return statusDayKeys(new Date("2026-12-15T15:00:00Z")).map((date, index) => ({
    date,
    uptimePct: index < unmeasured ? null : 100,
    worstLevel: "operational",
    incidentIds: [],
  }))
}

const pct = (value: number) => `${String(value).replace(".", ",")}%`

describe("uptimeCoverage", () => {
  it("primeiro dia medido e se a janela inteira foi medida", () => {
    expect(uptimeCoverage(barDays(0))).toEqual({ measuredSince: "2026-09-17", fullWindow: true })
    expect(uptimeCoverage(barDays(89))).toEqual({ measuredSince: "2026-12-15", fullWindow: false })
    expect(uptimeCoverage(barDays(90))).toEqual({ measuredSince: null, fullWindow: false })
    expect(uptimeCoverage(barDays(0).slice(1))).toEqual({
      measuredSince: "2026-09-18",
      fullWindow: false,
    })
  })
})

describe("uptimeCaption", () => {
  it("com os 90 dias medidos mantém 'em 90 dias'", () => {
    expect(uptimeCaption({ uptime90dPct: 99.95, days: barDays(0) }, pct)).toBe(
      "99,95% disponível em 90 dias"
    )
  })

  it("com menos de 90 dias medidos diz desde quando (1 dia de medição não vira 90)", () => {
    expect(uptimeCaption({ uptime90dPct: 100, days: barDays(89) }, pct)).toBe(
      "100% disponível desde 15/12/2026"
    )
    expect(uptimeCaption({ uptime90dPct: 100, days: barDays(10) }, pct)).toBe(
      "100% disponível desde 27/09/2026"
    )
  })

  it("sem percentual: sem sinal, aguardando a primeira medição ou retrato antigo", () => {
    expect(
      uptimeCaption({ uptime90dPct: null, days: barDays(90), automaticSignal: false }, pct)
    ).toBe("Sem medição automática · acompanhado pela equipe")
    expect(
      uptimeCaption({ uptime90dPct: null, days: barDays(90), automaticSignal: true }, pct)
    ).toBe(UPTIME_CAPTIONS.waitingFirstMeasurement)
    expect(uptimeCaption({ uptime90dPct: null, days: barDays(90) }, pct)).toBe(
      UPTIME_CAPTIONS.noMeasurement
    )
  })

  it("formata a data do calendário", () => {
    expect(formatStatusDayKey("2026-09-17")).toBe("17/09/2026")
    expect(formatStatusDayKey("ontem")).toBe("ontem")
  })
})
