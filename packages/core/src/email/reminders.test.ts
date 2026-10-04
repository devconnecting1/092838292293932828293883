import { describe, expect, it } from "vitest"

import {
  addDaysToDateKey,
  formatDisplayAddress,
  formatSaoPauloTime,
  isBusinessDay,
  nextBusinessDay,
  toSaoPauloDateKey,
  visitFollowUpTitle,
} from "./reminders"

describe("dias úteis", () => {
  it("sexta-feira vai para a segunda seguinte", () => {
    // 18/09/2026 é sexta-feira.
    expect(nextBusinessDay("2026-09-18")).toBe("2026-09-21")
  })

  it("dia de semana comum vai para o dia seguinte", () => {
    expect(nextBusinessDay("2026-09-15")).toBe("2026-09-16")
  })

  it("pula feriado nacional de data fixa", () => {
    // 06/09/2027 é segunda; 07/09 (Independência) cai na terça.
    expect(nextBusinessDay("2027-09-06")).toBe("2027-09-08")
    // 19/11/2026 é quinta; 20/11 (Consciência Negra, Lei 14.759/2023) é sexta.
    expect(nextBusinessDay("2026-11-19")).toBe("2026-11-23")
    // 24/12/2026 é quinta; 25/12 é sexta.
    expect(nextBusinessDay("2026-12-24")).toBe("2026-12-28")
  })

  it("reconhece fim de semana e feriado", () => {
    expect(isBusinessDay("2026-09-19")).toBe(false)
    expect(isBusinessDay("2026-09-20")).toBe(false)
    expect(isBusinessDay("2026-10-12")).toBe(false)
    expect(isBusinessDay("2026-09-16")).toBe(true)
    expect(isBusinessDay("2026-02-30")).toBe(false)
  })

  it("data inválida volta igual", () => {
    expect(nextBusinessDay("amanhã")).toBe("amanhã")
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01")
  })
})

describe("datas de Brasília", () => {
  it("converte instante para o dia e a hora de São Paulo (UTC-3)", () => {
    expect(toSaoPauloDateKey("2026-09-17T02:30:00Z")).toBe("2026-09-16")
    expect(formatSaoPauloTime("2026-09-16T17:30:00Z")).toBe("14:30")
    expect(formatSaoPauloTime("x")).toBeNull()
  })
})

describe("formatDisplayAddress", () => {
  const base = {
    street: "Rua das Flores",
    streetNumber: "123",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "sp",
  }

  it("full mostra rua, número, bairro e cidade", () => {
    expect(formatDisplayAddress({ ...base, addressDisplay: "full" })).toBe(
      "Rua das Flores, 123 — Centro, São Paulo/SP"
    )
  })

  it("street esconde o número", () => {
    expect(formatDisplayAddress({ ...base, addressDisplay: "street" })).toBe(
      "Rua das Flores — Centro, São Paulo/SP"
    )
  })

  it("neighborhood (e modo desconhecido) mostra só bairro e cidade", () => {
    expect(formatDisplayAddress({ ...base, addressDisplay: "neighborhood" })).toBe(
      "Centro, São Paulo/SP"
    )
    expect(formatDisplayAddress({ ...base, addressDisplay: "outro" })).toBe("Centro, São Paulo/SP")
  })

  it("sem dados devolve null", () => {
    expect(formatDisplayAddress({ addressDisplay: "full" })).toBeNull()
  })
})

describe("visitFollowUpTitle", () => {
  it("usa cliente e código quando existem", () => {
    expect(visitFollowUpTitle({ clientName: "Maria Silva", propertyCode: "IMV-000123" })).toBe(
      "Retorno da visita: Maria Silva (IMV-000123)"
    )
    expect(visitFollowUpTitle({ propertyCode: "IMV-000123" })).toBe("Retorno da visita: IMV-000123")
    expect(visitFollowUpTitle({})).toBe("Retorno da visita")
  })
})
