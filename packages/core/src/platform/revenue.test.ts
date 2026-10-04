import { describe, expect, it } from "vitest"

import {
  accountMonthlyRevenue,
  averageTicketCents,
  computeRevenueSummary,
  startOfMonthInSaoPaulo,
  type RevenueAccount,
} from "./revenue"

const NOW = new Date("2026-09-17T12:00:00Z")

let sequence = 0

function account(overrides: Partial<RevenueAccount> = {}): RevenueAccount {
  sequence += 1

  return {
    organizationId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    name: `Imobiliária ${sequence}`,
    slug: `imobiliaria-${sequence}`,
    planKey: "imobiliaria",
    interval: "month",
    status: "active",
    seats: 3,
    planNetMonthlyCents: null,
    trialEndsAt: "2026-09-01T12:00:00Z",
    currentPeriodEnd: "2026-10-10T12:00:00Z",
    cancelAtPeriodEnd: false,
    firstPaidAt: null,
    canceledAt: null,
    blockedAt: null,
    hasSubscription: true,
    ...overrides,
  }
}

describe("accountMonthlyRevenue", () => {
  it("mensal sem fatura paga usa o preço de tabela", () => {
    expect(accountMonthlyRevenue(account())).toEqual({ cents: 32_000, source: "tabela" })
  })

  it("anual vira mensal (÷ 12) e soma os usuários extras do mesmo ciclo", () => {
    // Equipe anual: R$ 7.750,00 ÷ 12 = 64.583,33 → 64.583; 2 extras × R$ 690,00 ÷ 12 = 11.500.
    expect(
      accountMonthlyRevenue(account({ planKey: "equipe", interval: "year", seats: 7 }))
    ).toEqual({ cents: 76_083, source: "tabela" })
  })

  it("com fatura paga usa o líquido do plano (descontos já aplicados)", () => {
    expect(accountMonthlyRevenue(account({ planNetMonthlyCents: 19_920 }))).toEqual({
      cents: 19_920,
      source: "fatura",
    })
  })

  it("respeita o teto de usuários extras do plano", () => {
    // Corretor: 1 incluído, até 2 no total → no máximo 1 extra de R$ 49,00.
    expect(accountMonthlyRevenue(account({ planKey: "corretor", seats: 5 }))?.cents).toBe(
      11_500 + 4_900
    )
  })

  it("cobrança atrasada (past_due) ainda conta", () => {
    expect(accountMonthlyRevenue(account({ status: "past_due" }))?.cents).toBe(32_000)
  })

  it("teste, cancelada, não paga, pausada e plano fora do catálogo não entram", () => {
    for (const status of ["trialing", "canceled", "unpaid", "incomplete", "paused"]) {
      expect(accountMonthlyRevenue(account({ status })), status).toBeNull()
    }

    expect(accountMonthlyRevenue(account({ planKey: "trial" }))).toBeNull()
  })

  it("líquido inválido (negativo) cai no preço de tabela", () => {
    expect(accountMonthlyRevenue(account({ planNetMonthlyCents: -10 }))).toEqual({
      cents: 32_000,
      source: "tabela",
    })
  })
})

describe("averageTicketCents", () => {
  it("divide a receita pelas contas pagantes e arredonda ao centavo", () => {
    expect(averageTicketCents(120_037, 4)).toBe(30_009)
    expect(averageTicketCents(100, 3)).toBe(33)
  })

  it("sem contas pagantes é zero", () => {
    expect(averageTicketCents(0, 0)).toBe(0)
    expect(averageTicketCents(5_000, 0)).toBe(0)
    expect(averageTicketCents(Number.NaN, 2)).toBe(0)
  })
})

describe("startOfMonthInSaoPaulo", () => {
  it("usa o calendário de São Paulo (UTC−3)", () => {
    expect(startOfMonthInSaoPaulo(NOW).toISOString()).toBe("2026-09-01T03:00:00.000Z")
    // 01/10 às 01:00 UTC ainda é 30/09 em São Paulo.
    expect(startOfMonthInSaoPaulo(new Date("2026-10-01T01:00:00Z")).toISOString()).toBe(
      "2026-09-01T03:00:00.000Z"
    )
    expect(startOfMonthInSaoPaulo(new Date("2026-10-01T03:00:00Z")).toISOString()).toBe(
      "2026-10-01T03:00:00.000Z"
    )
  })
})

describe("computeRevenueSummary", () => {
  const accounts: RevenueAccount[] = [
    account({ name: "Mensal tabela" }),
    account({ name: "Anual com extras", planKey: "equipe", interval: "year", seats: 7 }),
    account({
      name: "Com desconto",
      planNetMonthlyCents: 19_920,
      firstPaidAt: "2026-09-05T15:00:00Z",
    }),
    account({
      name: "Atrasada",
      planKey: "corretor",
      seats: 2,
      status: "past_due",
      currentPeriodEnd: "2026-09-12T12:00:00Z",
    }),
    account({
      name: "Teste acabando",
      planKey: "trial",
      interval: null,
      status: "trialing",
      seats: 8,
      trialEndsAt: "2026-09-20T12:00:00Z",
      currentPeriodEnd: null,
      hasSubscription: false,
    }),
    account({
      name: "Teste longe",
      planKey: "trial",
      interval: null,
      status: "trialing",
      trialEndsAt: "2026-09-30T12:00:00Z",
      currentPeriodEnd: null,
      hasSubscription: false,
    }),
    account({
      name: "Teste bloqueado",
      planKey: "trial",
      interval: null,
      status: "trialing",
      trialEndsAt: "2026-09-19T12:00:00Z",
      currentPeriodEnd: null,
      hasSubscription: false,
      blockedAt: "2026-09-16T12:00:00Z",
    }),
    account({
      name: "Cancelada no mês",
      status: "canceled",
      canceledAt: "2026-09-10T12:00:00Z",
      firstPaidAt: "2026-08-10T12:00:00Z",
    }),
    account({
      name: "Cancelada antes",
      status: "canceled",
      canceledAt: "2026-08-31T23:00:00Z",
    }),
    account({ name: "Não paga", status: "unpaid", currentPeriodEnd: null, planKey: "rede" }),
  ]

  const summary = computeRevenueSummary(accounts, NOW)

  it("soma o MRR, a parte em risco e o ticket médio", () => {
    expect(summary.mrrCents).toBe(32_000 + 76_083 + 19_920 + 16_400)
    expect(summary.atRiskMrrCents).toBe(16_400)
    expect(summary.payingAccounts).toBe(4)
    expect(summary.estimatedAccounts).toBe(3)
    expect(summary.averageTicketCents).toBe(36_101)
  })

  it("conta por situação e por plano", () => {
    expect(summary.totalAccounts).toBe(10)
    expect(summary.bySituation).toEqual({
      teste: 2,
      ativa: 3,
      em_atraso: 2,
      cancelada: 2,
      bloqueada: 1,
    })
    expect(summary.byPlan).toEqual({
      trial: 3,
      corretor: 1,
      imobiliaria: 4,
      equipe: 1,
      rede: 1,
      outro: 0,
    })
  })

  it("lista os testes que terminam em 7 dias (sem os bloqueados), do mais próximo", () => {
    expect(summary.trialsEndingSoon.map((entry) => entry.name)).toEqual(["Teste acabando"])
    expect(summary.trialsEndingSoon[0]?.controlledByStripe).toBe(false)
  })

  it("lista os inadimplentes com o fim da carência", () => {
    expect(summary.delinquent.map((entry) => [entry.name, entry.graceEndsAt])).toEqual([
      ["Atrasada", "2026-09-19T12:00:00.000Z"],
      ["Não paga", null],
    ])
    expect(summary.delinquent[0]?.monthlyCents).toBe(16_400)
    expect(summary.delinquent[1]?.monthlyCents).toBeNull()
  })

  it("conta novas assinaturas e cancelamentos do mês de São Paulo", () => {
    expect(summary.newSubscriptionsThisMonth).toBe(1)
    expect(summary.cancellationsThisMonth).toBe(1)
    expect(summary.monthStart.toISOString()).toBe("2026-09-01T03:00:00.000Z")
  })

  it("lista vazia não quebra", () => {
    const empty = computeRevenueSummary([], NOW)
    expect(empty.mrrCents).toBe(0)
    expect(empty.averageTicketCents).toBe(0)
    expect(empty.trialsEndingSoon).toEqual([])
  })
})
