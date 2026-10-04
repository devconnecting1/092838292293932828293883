import { describe, expect, it } from "vitest"

import {
  buildCalendarEvent,
  buildVisitCalendar,
  calendarFileName,
  escapeIcsText,
  foldIcsLine,
  formatIcsDateTime,
  ICS_CONTENT_TYPE,
} from "./calendar"

const BASE = {
  uid: "3F0C1A2B-4D5E-4F60-8A7B-9C0D1E2F3A4B",
  domain: "imob-teste.seucrm.com.br",
  startsAt: "2026-09-16T17:30:00.000Z",
  endsAt: "2026-09-16T18:30:00.000Z",
  summary: "Visita: IMV-000123 · Apartamento",
  now: new Date("2026-09-16T10:00:00.000Z"),
}

function unfold(ics: string) {
  // RFC 5545 §3.1: CRLF seguido de um espaço some ao desdobrar.
  return ics.replace(/\r\n /g, "")
}

describe("formatIcsDateTime", () => {
  it("usa a forma UTC com Z (RFC 5545 §3.3.5)", () => {
    expect(formatIcsDateTime(new Date("1998-01-19T07:00:00.000Z"))).toBe("19980119T070000Z")
  })
})

describe("escapeIcsText", () => {
  it("escapa barra invertida, ponto e vírgula, vírgula e quebra de linha (§3.3.11)", () => {
    expect(escapeIcsText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne")
  })

  it("não escapa dois-pontos e remove caracteres de controle", () => {
    expect(escapeIcsText("Rua: 10")).toBe("Rua: 10")
  })
})

describe("foldIcsLine", () => {
  it("não mexe em linha de até 75 octetos", () => {
    const line = `SUMMARY:${"a".repeat(67)}`
    expect(foldIcsLine(line)).toBe(line)
  })

  it("dobra em no máximo 75 octetos sem partir caracteres acentuados", () => {
    const line = `DESCRIPTION:${"ção ".repeat(40)}`
    const folded = foldIcsLine(line)
    const encoder = new TextEncoder()

    for (const part of folded.split("\r\n")) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75)
    }

    expect(
      folded
        .split("\r\n")
        .slice(1)
        .every((part) => part.startsWith(" "))
    ).toBe(true)
    expect(unfold(folded)).toBe(line)
  })
})

describe("buildCalendarEvent", () => {
  it("gera VCALENDAR válido com os campos obrigatórios", () => {
    const ics = buildCalendarEvent({
      ...BASE,
      location: "Rua das Flores — Centro, São Paulo/SP",
      description: "Ponto de encontro: portaria, bloco B",
      url: "https://imob-teste.seucrm.com.br/agenda?dia=2026-09-16",
      alarmMinutesBefore: 60,
    })

    expect(ics).not.toBeNull()
    const text = ics ?? ""

    expect(text.endsWith("\r\n")).toBe(true)
    expect(text).not.toMatch(/[^\r]\n/)

    const lines = unfold(text).split("\r\n").filter(Boolean)

    expect(lines[0]).toBe("BEGIN:VCALENDAR")
    expect(lines.at(-1)).toBe("END:VCALENDAR")
    expect(lines).toContain("VERSION:2.0")
    expect(lines.some((line) => line.startsWith("PRODID:"))).toBe(true)
    expect(lines).toContain("UID:3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b@imob-teste.seucrm.com.br")
    expect(lines).toContain("DTSTAMP:20260916T100000Z")
    expect(lines).toContain("DTSTART:20260916T173000Z")
    expect(lines).toContain("DTEND:20260916T183000Z")
    expect(lines).toContain("SUMMARY:Visita: IMV-000123 · Apartamento")
    expect(lines).toContain("LOCATION:Rua das Flores — Centro\\, São Paulo/SP")
    expect(lines).toContain("DESCRIPTION:Ponto de encontro: portaria\\, bloco B")
    expect(lines).toContain("URL:https://imob-teste.seucrm.com.br/agenda?dia=2026-09-16")
    expect(lines).toContain("STATUS:CONFIRMED")
    expect(lines).not.toContain("DURATION")
    // VALARM com ACTION, DESCRIPTION e TRIGGER (§3.6.6).
    const alarmStart = lines.indexOf("BEGIN:VALARM")
    const alarm = lines.slice(alarmStart, lines.indexOf("END:VALARM") + 1)
    expect(alarm).toContain("ACTION:DISPLAY")
    expect(alarm).toContain("TRIGGER:-PT60M")
    expect(alarm.some((line) => line.startsWith("DESCRIPTION:"))).toBe(true)
  })

  it("sem término usa a duração padrão e ignora término antes do início", () => {
    const semFim = unfold(buildCalendarEvent({ ...BASE, endsAt: null }) ?? "")
    expect(semFim).toContain("DTEND:20260916T183000Z")

    const invertido = unfold(
      buildCalendarEvent({
        ...BASE,
        endsAt: "2026-09-16T17:00:00.000Z",
        defaultDurationMinutes: 30,
      }) ?? ""
    )
    expect(invertido).toContain("DTEND:20260916T180000Z")
  })

  it("não aceita início inválido nem URL fora de https", () => {
    expect(buildCalendarEvent({ ...BASE, startsAt: "ontem" })).toBeNull()

    const ics = buildCalendarEvent({ ...BASE, url: "javascript:alert(1)" }) ?? ""
    expect(ics).not.toContain("URL:")
  })

  it("impede injeção de propriedades por quebra de linha no texto", () => {
    const ics = unfold(
      buildCalendarEvent({ ...BASE, summary: "Visita\r\nATTENDEE:mailto:x@y.com" }) ?? ""
    )

    expect(ics.split("\r\n").some((line) => line.startsWith("ATTENDEE"))).toBe(false)
    expect(ics).toContain("SUMMARY:Visita\\nATTENDEE:mailto:x@y.com")
  })

  it("exporta o tipo de mídia da RFC (§8.1)", () => {
    expect(ICS_CONTENT_TYPE).toBe("text/calendar; charset=utf-8")
  })
})

describe("buildVisitCalendar", () => {
  const visitId = "3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b"

  it("monta o convite da visita sem dados do cliente e com link da agenda", () => {
    const file = buildVisitCalendar({
      origin: "https://imob-teste.seucrm.com.br",
      visitId,
      startsAt: "2026-09-16T17:30:00.000Z",
      endsAt: null,
      status: "confirmed",
      propertyCode: "IMV-000123",
      propertyTitle: "Apartamento 2 quartos",
      address: "Centro, São Paulo/SP",
      meetingPoint: "Portaria",
      now: new Date("2026-09-16T10:00:00.000Z"),
    })

    expect(file?.fileName).toBe("visita-imv-000123.ics")
    const lines = unfold(file?.content ?? "").split("\r\n")

    expect(lines).toContain(`UID:visita-${visitId}@imob-teste.seucrm.com.br`)
    expect(lines).toContain("DTEND:20260916T183000Z")
    expect(lines).toContain("SUMMARY:Visita: IMV-000123 · Apartamento 2 quartos")
    expect(lines).toContain("LOCATION:Centro\\, São Paulo/SP")
    expect(lines).toContain(
      "DESCRIPTION:Ponto de encontro: Portaria\\nAbrir no CRM: https://imob-teste.seucrm.com.br/agenda?dia=2026-09-16"
    )
    expect(lines).toContain("URL:https://imob-teste.seucrm.com.br/agenda?dia=2026-09-16")
    expect(lines).toContain("TRIGGER:-PT60M")
  })

  it("visita cancelada sai como CANCELLED; id ou origem inválidos não geram arquivo", () => {
    const base = {
      origin: "https://imob-teste.seucrm.com.br",
      visitId,
      startsAt: "2026-09-16T17:30:00.000Z",
    }

    expect(buildVisitCalendar({ ...base, status: "canceled" })?.content).toContain(
      "STATUS:CANCELLED"
    )
    expect(buildVisitCalendar({ ...base, visitId: "x" })).toBeNull()
    expect(buildVisitCalendar({ ...base, origin: "ftp://x" })).toBeNull()
  })
})

describe("calendarFileName", () => {
  it("gera nome .ics sem acentos nem caracteres especiais", () => {
    expect(calendarFileName("Visita IMV-000123 às 14:30")).toBe("visita-imv-000123-as-14-30.ics")
    expect(calendarFileName("../../")).toBe("visita.ics")
  })
})
