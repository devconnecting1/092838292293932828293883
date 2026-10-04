import { describe, expect, it } from "vitest"

import { isImportDateBefore, parseImportDateTime } from "./dates"

const NOW = new Date("2026-09-17T12:00:00-03:00")

function parse(raw: string | null) {
  return parseImportDateTime(raw, NOW)
}

describe("parseImportDateTime", () => {
  it("lê datas pt-BR com e sem hora", () => {
    expect(parse("15/03/2025")).toEqual({ ok: true, value: "2025-03-15T12:00:00-03:00" })
    expect(parse("15/03/2025 14:30")).toEqual({ ok: true, value: "2025-03-15T14:30:00-03:00" })
    expect(parse("5/3/25 às 9h05")).toEqual({ ok: true, value: "2025-03-05T09:05:00-03:00" })
    expect(parse("15-03-2025 08:00:59")).toEqual({ ok: true, value: "2025-03-15T08:00:00-03:00" })
  })

  it("lê ISO e o serial do Excel (com a hora na fração)", () => {
    expect(parse("2025-03-15")).toEqual({ ok: true, value: "2025-03-15T12:00:00-03:00" })
    expect(parse("2025-03-15T07:45")).toEqual({ ok: true, value: "2025-03-15T07:45:00-03:00" })
    expect(parse("45731")).toEqual({ ok: true, value: "2025-03-15T12:00:00-03:00" })
    expect(parse("45731,75")).toEqual({ ok: true, value: "2025-03-15T18:00:00-03:00" })
  })

  it("vazio vira null", () => {
    expect(parse(null)).toEqual({ ok: true, value: null })
    expect(parse("   ")).toEqual({ ok: true, value: null })
  })

  it("recusa data inválida, antiga demais ou no futuro", () => {
    expect(parse("31/02/2025")).toEqual({ ok: false })
    expect(parse("15/13/2025")).toEqual({ ok: false })
    expect(parse("15/03/2025 25:00")).toEqual({ ok: false })
    expect(parse("ontem")).toEqual({ ok: false })
    expect(parse("01/01/1980")).toEqual({ ok: false })
    expect(parse("20/09/2026")).toEqual({ ok: false })
  })

  it("compara datas geradas", () => {
    expect(isImportDateBefore("2025-03-01T12:00:00-03:00", "2025-03-10T12:00:00-03:00")).toBe(true)
    expect(isImportDateBefore("2025-03-10T12:00:00-03:00", "2025-03-10T12:00:00-03:00")).toBe(false)
  })
})
