import { describe, expect, it } from "vitest"

import {
  AUTHORIZATION_ALERT_MILESTONES,
  authorizationAlertMilestone,
  daysBetweenDates,
  describeAuthorizationDeadline,
  isAuthorizationListFilter,
  isAuthorizationTrackedStatus,
  summarizeAuthorizations,
} from "./authorization-alerts"

const TODAY = "2026-09-16"

describe("daysBetweenDates", () => {
  it("conta dias corridos, inclusive virando mês e ano", () => {
    expect(daysBetweenDates(TODAY, TODAY)).toBe(0)
    expect(daysBetweenDates(TODAY, "2026-09-17")).toBe(1)
    expect(daysBetweenDates(TODAY, "2026-10-16")).toBe(30)
    expect(daysBetweenDates("2026-12-31", "2027-01-01")).toBe(1)
    expect(daysBetweenDates(TODAY, "2026-09-15")).toBe(-1)
  })

  it("data inválida devolve null", () => {
    expect(daysBetweenDates(TODAY, "2026-02-31")).toBeNull()
    expect(daysBetweenDates("16/09/2026", TODAY)).toBeNull()
    expect(daysBetweenDates(TODAY, "")).toBeNull()
  })
})

describe("authorizationAlertMilestone", () => {
  it("usa o menor marco que ainda cobre os dias que faltam (igual ao banco)", () => {
    const cases: [number, number | null][] = [
      [31, null],
      [30, 30],
      [16, 30],
      [15, 15],
      [8, 15],
      [7, 7],
      [2, 7],
      [1, 1],
      [0, 1],
      [-1, null],
    ]

    for (const [days, milestone] of cases) {
      expect(authorizationAlertMilestone(days)).toBe(milestone)
    }
  })

  it("os marcos são D-30, D-15, D-7 e D-1", () => {
    expect([...AUTHORIZATION_ALERT_MILESTONES]).toEqual([30, 15, 7, 1])
  })

  it("valor não numérico não vira marco", () => {
    expect(authorizationAlertMilestone(Number.NaN)).toBeNull()
    expect(authorizationAlertMilestone(null)).toBeNull()
    expect(authorizationAlertMilestone(undefined)).toBeNull()
  })
})

describe("summarizeAuthorizations", () => {
  it("sem autorização", () => {
    expect(summarizeAuthorizations([], TODAY)).toEqual({
      state: "none",
      endsOn: null,
      daysLeft: null,
    })
  })

  it("vigente e acabando em até 30 dias está vencendo", () => {
    expect(
      summarizeAuthorizations([{ starts_on: "2026-06-01", ends_on: "2026-09-26" }], TODAY)
    ).toEqual({ state: "expiring", endsOn: "2026-09-26", daysLeft: 10 })

    expect(
      summarizeAuthorizations([{ starts_on: "2026-06-01", ends_on: TODAY }], TODAY).state
    ).toBe("expiring")
    expect(
      summarizeAuthorizations([{ starts_on: "2026-06-01", ends_on: "2026-10-16" }], TODAY).state
    ).toBe("expiring")
  })

  it("com fim além da janela ou sem prazo final está vigente", () => {
    expect(
      summarizeAuthorizations([{ starts_on: "2026-06-01", ends_on: "2026-10-17" }], TODAY).state
    ).toBe("active")
    expect(summarizeAuthorizations([{ starts_on: "2026-06-01", ends_on: null }], TODAY)).toEqual({
      state: "active",
      endsOn: null,
      daysLeft: null,
    })
  })

  it("renovação já registrada tira o imóvel de vencendo", () => {
    const summary = summarizeAuthorizations(
      [
        { starts_on: "2026-06-01", ends_on: "2026-09-26" },
        { starts_on: "2026-09-27", ends_on: "2027-03-27" },
      ],
      TODAY
    )

    expect(summary.state).toBe("active")
    expect(summary.endsOn).toBe("2027-03-27")
  })

  it("todas vencidas", () => {
    expect(
      summarizeAuthorizations(
        [
          { starts_on: "2026-01-01", ends_on: "2026-06-30" },
          { starts_on: "2026-07-01", ends_on: "2026-09-15" },
        ],
        TODAY
      )
    ).toEqual({ state: "expired", endsOn: "2026-09-15", daysLeft: -1 })
  })

  it("só autorização futura", () => {
    expect(
      summarizeAuthorizations([{ starts_on: "2026-10-01", ends_on: "2027-01-01" }], TODAY).state
    ).toBe("upcoming")
  })
})

describe("rótulos e filtros", () => {
  it("descreve o prazo em pt-BR", () => {
    expect(describeAuthorizationDeadline(0)).toBe("vence hoje")
    expect(describeAuthorizationDeadline(1)).toBe("vence amanhã")
    expect(describeAuthorizationDeadline(15)).toBe("vence em 15 dias")
    expect(describeAuthorizationDeadline(-1)).toBe("venceu ontem")
    expect(describeAuthorizationDeadline(-4)).toBe("venceu há 4 dias")
  })

  it("aceita só os filtros da tela", () => {
    expect(isAuthorizationListFilter("vencendo")).toBe(true)
    expect(isAuthorizationListFilter("vencida")).toBe(true)
    expect(isAuthorizationListFilter("toString")).toBe(false)
    expect(isAuthorizationListFilter("expiring")).toBe(false)
  })

  it("só imóvel em carteira entra nos avisos", () => {
    expect(isAuthorizationTrackedStatus("active")).toBe(true)
    expect(isAuthorizationTrackedStatus("reserved")).toBe(true)
    expect(isAuthorizationTrackedStatus("draft")).toBe(true)
    expect(isAuthorizationTrackedStatus("sold")).toBe(false)
    expect(isAuthorizationTrackedStatus("rented")).toBe(false)
    expect(isAuthorizationTrackedStatus("inactive")).toBe(false)
  })
})
