import { describe, expect, it } from "vitest"

import {
  addDays,
  dayStartIso,
  daysBetween,
  formatPeriodLabel,
  isDayKey,
  isReportPeriodPreset,
  REPORT_MAX_DAYS,
  resolveReportPeriod,
  todayInBrasilia,
} from "./period"

/** 16/09/2026 às 02:00 UTC = 15/09/2026 às 23:00 em Brasília. */
const LATE_NIGHT_IN_BRASILIA = new Date("2026-09-16T02:00:00Z")
/** 16/09/2026 às 15:00 UTC = 16/09/2026 às 12:00 em Brasília. */
const NOON = new Date("2026-09-16T15:00:00Z")

describe("isDayKey", () => {
  it("aceita dia real e recusa o resto", () => {
    expect(isDayKey("2026-09-16")).toBe(true)
    expect(isDayKey("2026-02-30")).toBe(false)
    expect(isDayKey("16/09/2026")).toBe(false)
    expect(isDayKey("2026-9-1")).toBe(false)
    expect(isDayKey(20260916)).toBe(false)
    expect(isDayKey(null)).toBe(false)
  })
})

describe("isReportPeriodPreset", () => {
  it("só aceita os atalhos conhecidos", () => {
    expect(isReportPeriodPreset("30-dias")).toBe(true)
    expect(isReportPeriodPreset("tudo")).toBe(false)
  })
})

describe("todayInBrasilia", () => {
  it("usa o dia de Brasília, não o de UTC", () => {
    expect(todayInBrasilia(LATE_NIGHT_IN_BRASILIA)).toBe("2026-09-15")
    expect(todayInBrasilia(NOON)).toBe("2026-09-16")
  })
})

describe("addDays e daysBetween", () => {
  it("anda no calendário sem escorregar em virada de mês e ano", () => {
    expect(addDays("2026-09-16", -6)).toBe("2026-09-10")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
  })

  it("conta os dois extremos", () => {
    expect(daysBetween("2026-09-16", "2026-09-16")).toBe(1)
    expect(daysBetween("2026-09-10", "2026-09-16")).toBe(7)
  })
})

describe("dayStartIso", () => {
  it("meia-noite de Brasília é 03:00 UTC", () => {
    expect(dayStartIso("2026-09-16")).toBe("2026-09-16T03:00:00.000Z")
  })
})

describe("formatPeriodLabel", () => {
  it("escreve o intervalo em pt-BR", () => {
    expect(formatPeriodLabel("2026-09-01", "2026-09-16")).toBe("01/09/2026 a 16/09/2026")
  })

  it("escreve só a data quando o período é de um dia", () => {
    expect(formatPeriodLabel("2026-09-16", "2026-09-16")).toBe("16/09/2026")
  })
})

describe("resolveReportPeriod", () => {
  it("cai nos últimos 30 dias quando não veio nada", () => {
    const period = resolveReportPeriod({}, NOON)

    expect(period.preset).toBe("30-dias")
    expect(period.fromDay).toBe("2026-08-18")
    expect(period.toDay).toBe("2026-09-16")
    expect(period.days).toBe(30)
    expect(period.label).toBe("18/08/2026 a 16/09/2026")
  })

  it("fecha o intervalo no começo e abre no fim (o dia inteiro entra)", () => {
    const period = resolveReportPeriod({ from: "2026-09-16", to: "2026-09-16" }, NOON)

    expect(period.from).toBe("2026-09-16T03:00:00.000Z")
    expect(period.to).toBe("2026-09-17T03:00:00.000Z")
    expect(period.days).toBe(1)
  })

  it("resolve cada atalho", () => {
    expect(resolveReportPeriod({ preset: "7-dias" }, NOON)).toMatchObject({
      fromDay: "2026-09-10",
      toDay: "2026-09-16",
      days: 7,
    })
    expect(resolveReportPeriod({ preset: "90-dias" }, NOON)).toMatchObject({
      fromDay: "2026-06-19",
      toDay: "2026-09-16",
      days: 90,
    })
    expect(resolveReportPeriod({ preset: "mes-atual" }, NOON)).toMatchObject({
      fromDay: "2026-09-01",
      toDay: "2026-09-16",
    })
    expect(resolveReportPeriod({ preset: "mes-passado" }, NOON)).toMatchObject({
      fromDay: "2026-08-01",
      toDay: "2026-08-31",
      days: 31,
    })
    expect(resolveReportPeriod({ preset: "ano-atual" }, NOON)).toMatchObject({
      fromDay: "2026-01-01",
      toDay: "2026-09-16",
    })
  })

  it("acha o fim de fevereiro no mês passado", () => {
    expect(
      resolveReportPeriod({ preset: "mes-passado" }, new Date("2026-03-10T15:00:00Z"))
    ).toMatchObject({ fromDay: "2026-02-01", toDay: "2026-02-28", days: 28 })
  })

  it("usa as datas escolhidas à mão e esquece o atalho", () => {
    const period = resolveReportPeriod(
      { preset: "7-dias", from: "2026-09-01", to: "2026-09-10" },
      NOON
    )

    expect(period.preset).toBeNull()
    expect(period.fromDay).toBe("2026-09-01")
    expect(period.toDay).toBe("2026-09-10")
  })

  it("desinverte datas trocadas", () => {
    expect(resolveReportPeriod({ from: "2026-09-10", to: "2026-09-01" }, NOON)).toMatchObject({
      fromDay: "2026-09-01",
      toDay: "2026-09-10",
    })
  })

  it("não deixa o período passar de hoje", () => {
    expect(resolveReportPeriod({ from: "2026-09-01", to: "2027-12-31" }, NOON)).toMatchObject({
      toDay: "2026-09-16",
    })
  })

  it("corta o período no teto do banco", () => {
    const period = resolveReportPeriod({ from: "2000-01-01", to: "2026-09-16" }, NOON)

    expect(period.days).toBe(REPORT_MAX_DAYS)
    expect(period.fromDay).toBe(addDays("2026-09-16", -(REPORT_MAX_DAYS - 1)))
  })

  it("ignora data pela metade e volta para o atalho", () => {
    expect(resolveReportPeriod({ preset: "7-dias", from: "2026-09-01" }, NOON)).toMatchObject({
      preset: "7-dias",
      fromDay: "2026-09-10",
    })
    expect(resolveReportPeriod({ from: "ontem", to: "hoje" }, NOON)).toMatchObject({
      preset: "30-dias",
    })
  })
})
