/**
 * Console da Plataforma — Assinaturas e receita.
 *
 * Tudo sai de billing_accounts (a Stripe é a fonte da verdade e sincroniza essa
 * tabela), lido por platform_list_revenue_accounts. Aqui ficam os cálculos:
 *
 * - Receita recorrente mensal (MRR): soma, por conta com status `active` ou
 *   `past_due` (contrato em vigor, mesmo com cobrança atrasada), do valor mensal
 *   equivalente:
 *     · plano: `plan_net_monthly_cents` quando a Stripe já pagou uma fatura
 *       (líquido de descontos, anual ÷ 12); senão o preço de tabela do catálogo
 *       (anual ÷ 12), marcado como estimativa;
 *     · usuários extras: (seats − usuários incluídos) × preço de tabela do
 *       assento no mesmo ciclo (anual ÷ 12).
 *   Teste grátis, canceladas, `unpaid`, `incomplete`, `incomplete_expired` e
 *   `paused` não entram.
 * - Ticket médio: MRR ÷ contas que entram no MRR (arredondado ao centavo).
 * - Mês: calendário de São Paulo (UTC−3, sem horário de verão desde 2019).
 */

import {
  clampExtraSeats,
  isPlanKey,
  PLANS,
  type BillingPlanKey,
  type PlanKey,
} from "../billing/plans"
import {
  ACCOUNT_SITUATIONS,
  PLATFORM_PLAN_KEYS,
  resolveAccountMilestone,
  resolveAccountSituation,
  type AccountSituation,
} from "./accounts"

export type RevenueAccount = {
  organizationId: string
  name: string
  slug: string
  planKey: string
  interval: string | null
  status: string
  /** Usuários incluídos + extras contratados. */
  seats: number
  /** Líquido mensal do item de plano na última fatura paga (anual ÷ 12). */
  planNetMonthlyCents: number | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  firstPaidAt: string | null
  canceledAt: string | null
  blockedAt: string | null
  hasSubscription: boolean
}

/** Status da Stripe que contam como receita recorrente. */
export const MRR_STATUSES: ReadonlySet<string> = new Set(["active", "past_due"])

const DELINQUENT_STATUSES: ReadonlySet<string> = new Set(["past_due", "unpaid", "incomplete"])

export const TRIAL_ENDING_WINDOW_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000

export type MonthlyRevenue = {
  cents: number
  /** fatura: valor líquido da última fatura paga; tabela: preço do catálogo. */
  source: "fatura" | "tabela"
}

function monthlyEquivalent(cents: number, interval: "month" | "year"): number {
  return interval === "year" ? cents / 12 : cents
}

function nonNegativeInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

/** Valor mensal equivalente de uma conta, ou null quando ela não entra no MRR. */
export function accountMonthlyRevenue(account: RevenueAccount): MonthlyRevenue | null {
  if (!MRR_STATUSES.has(account.status) || !isPlanKey(account.planKey)) {
    return null
  }

  const plan: PlanKey = account.planKey
  const interval = account.interval === "year" ? "year" : "month"
  const definition = PLANS[plan]
  const net = nonNegativeInteger(account.planNetMonthlyCents)
  const planCents = net ?? Math.round(monthlyEquivalent(definition.prices[interval], interval))
  const seats = Number.isFinite(account.seats) ? account.seats : definition.usersIncluded
  const extraSeats = clampExtraSeats(plan, seats - definition.usersIncluded)
  const seatCents = Math.round(
    monthlyEquivalent(extraSeats * definition.seatPrice[interval], interval)
  )

  return { cents: planCents + seatCents, source: net === null ? "tabela" : "fatura" }
}

/** Ticket médio em centavos: MRR ÷ contas pagantes (0 sem contas). */
export function averageTicketCents(mrrCents: number, payingAccounts: number): number {
  if (!Number.isFinite(mrrCents) || !Number.isFinite(payingAccounts) || payingAccounts <= 0) {
    return 0
  }

  return Math.round(mrrCents / payingAccounts)
}

/** Início do mês corrente em São Paulo (UTC−3), como instante UTC. */
export function startOfMonthInSaoPaulo(now: Date): Date {
  const local = new Date(now.getTime() - SAO_PAULO_OFFSET_MS)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + SAO_PAULO_OFFSET_MS)
}

function inRange(value: string | null, from: number, to: number): boolean {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) && time >= from && time <= to
}

export type TrialEndingSoon = {
  organizationId: string
  name: string
  slug: string
  endsAt: string
  /** Teste criado na Stripe (há assinatura) em vez do teste grátis local. */
  controlledByStripe: boolean
}

export type DelinquentAccount = {
  organizationId: string
  name: string
  slug: string
  status: string
  planKey: string
  /** Fim da carência (fim do período + 7 dias); null sem período. */
  graceEndsAt: string | null
  monthlyCents: number | null
  blocked: boolean
}

export type RevenueSummary = {
  monthStart: Date
  mrrCents: number
  /** Parte do MRR de contas com cobrança atrasada (past_due). */
  atRiskMrrCents: number
  payingAccounts: number
  /** Contas pagantes cujo valor saiu do preço de tabela (sem fatura paga sincronizada). */
  estimatedAccounts: number
  averageTicketCents: number
  totalAccounts: number
  bySituation: Record<AccountSituation, number>
  /** Chaves de plano conhecidas; "outro" junta valores fora do catálogo. */
  byPlan: Record<BillingPlanKey | "outro", number>
  trialsEndingSoon: TrialEndingSoon[]
  delinquent: DelinquentAccount[]
  newSubscriptionsThisMonth: number
  cancellationsThisMonth: number
}

/** Números da tela Assinaturas e receita a partir das contas sincronizadas. */
export function computeRevenueSummary(
  accounts: readonly RevenueAccount[],
  now: Date
): RevenueSummary {
  const monthStart = startOfMonthInSaoPaulo(now)
  const nowMs = now.getTime()
  const soonMs = nowMs + TRIAL_ENDING_WINDOW_DAYS * DAY_MS

  const bySituation = Object.fromEntries(ACCOUNT_SITUATIONS.map((key) => [key, 0])) as Record<
    AccountSituation,
    number
  >
  const byPlan = Object.fromEntries(
    [...PLATFORM_PLAN_KEYS, "outro"].map((key) => [key, 0])
  ) as Record<BillingPlanKey | "outro", number>

  let mrrCents = 0
  let atRiskMrrCents = 0
  let payingAccounts = 0
  let estimatedAccounts = 0
  let newSubscriptionsThisMonth = 0
  let cancellationsThisMonth = 0
  const trialsEndingSoon: TrialEndingSoon[] = []
  const delinquent: DelinquentAccount[] = []

  for (const account of accounts) {
    bySituation[resolveAccountSituation(account.status, account.blockedAt)] += 1

    if ((PLATFORM_PLAN_KEYS as readonly string[]).includes(account.planKey)) {
      byPlan[account.planKey as BillingPlanKey] += 1
    } else {
      byPlan.outro += 1
    }

    const revenue = accountMonthlyRevenue(account)

    if (revenue) {
      mrrCents += revenue.cents
      payingAccounts += 1
      estimatedAccounts += revenue.source === "tabela" ? 1 : 0
      atRiskMrrCents += account.status === "past_due" ? revenue.cents : 0
    }

    if (inRange(account.firstPaidAt, monthStart.getTime(), nowMs)) {
      newSubscriptionsThisMonth += 1
    }

    if (account.status === "canceled" && inRange(account.canceledAt, monthStart.getTime(), nowMs)) {
      cancellationsThisMonth += 1
    }

    const milestone = resolveAccountMilestone({
      status: account.status,
      planKey: account.planKey,
      trialEndsAt: account.trialEndsAt,
      currentPeriodEnd: account.currentPeriodEnd,
      cancelAtPeriodEnd: account.cancelAtPeriodEnd,
    })

    if (
      !account.blockedAt &&
      milestone?.kind === "fim_do_teste" &&
      inRange(milestone.at, nowMs, soonMs)
    ) {
      trialsEndingSoon.push({
        organizationId: account.organizationId,
        name: account.name,
        slug: account.slug,
        endsAt: milestone.at,
        controlledByStripe: account.planKey !== "trial" || account.hasSubscription,
      })
    }

    if (DELINQUENT_STATUSES.has(account.status)) {
      delinquent.push({
        organizationId: account.organizationId,
        name: account.name,
        slug: account.slug,
        status: account.status,
        planKey: account.planKey,
        graceEndsAt: milestone?.kind === "fim_da_carencia" ? milestone.at : null,
        monthlyCents: revenue?.cents ?? null,
        blocked: Boolean(account.blockedAt),
      })
    }
  }

  trialsEndingSoon.sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))
  delinquent.sort(
    (a, b) =>
      (a.graceEndsAt ? Date.parse(a.graceEndsAt) : Number.POSITIVE_INFINITY) -
      (b.graceEndsAt ? Date.parse(b.graceEndsAt) : Number.POSITIVE_INFINITY)
  )

  return {
    monthStart,
    mrrCents,
    atRiskMrrCents,
    payingAccounts,
    estimatedAccounts,
    averageTicketCents: averageTicketCents(mrrCents, payingAccounts),
    totalAccounts: accounts.length,
    bySituation,
    byPlan,
    trialsEndingSoon,
    delinquent,
    newSubscriptionsThisMonth,
    cancellationsThisMonth,
  }
}
