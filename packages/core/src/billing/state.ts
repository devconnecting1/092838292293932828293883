// Estado de acesso da organização, com a mesma regra de private.billing_state no
// banco (contrato de Pagamentos, §1 e §2). A UI usa para badge, banner e avisos;
// quem bloqueia a escrita de verdade é o banco.
//
// - trialing: teste vigente;
// - active: assinatura em dia;
// - grace: carência de GRACE_DAYS com acesso total
//   (past_due/unpaid/incomplete com now <= current_period_end + 7 dias, ou teste
//   vencido há até 7 dias);
// - read_only: todo o resto (canceled, incomplete_expired, paused, status
//   desconhecido, datas ausentes ou inválidas, teste vencido há mais de 7 dias).
//
// Data que conta com status "trialing":
// - plan_key "trial" (teste local, sem objeto na Stripe): trial_ends_at;
// - plano pago (trial criado na Stripe): current_period_end, que na Stripe coincide
//   com o fim do trial; sem ela, trial_ends_at.
// Limites inclusivos: exatamente no fim ainda é trialing; exatamente em fim + 7d ainda é grace.

import { GRACE_DAYS } from "./plans"

export type BillingState = "trialing" | "active" | "grace" | "read_only"

export const BILLING_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const

/** Valores aceitos em billing_accounts.status (espelho da Stripe). */
export type BillingStatus = (typeof BILLING_STATUSES)[number]

export const BILLING_STATE_LABELS: Record<BillingState, string> = {
  trialing: "Teste grátis",
  active: "Ativa",
  grace: "Em carência",
  read_only: "Somente leitura",
}

export type BillingStateInput = {
  status: string
  trialEndsAt: string | Date
  currentPeriodEnd: string | Date | null
  planKey: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const GRACE_MS = GRACE_DAYS * DAY_MS

const PAYMENT_PENDING_STATUSES: ReadonlySet<string> = new Set(["past_due", "unpaid", "incomplete"])

export function isBillingStatus(value: unknown): value is BillingStatus {
  return typeof value === "string" && (BILLING_STATUSES as readonly string[]).includes(value)
}

function toTimestamp(value: string | Date | null | undefined): number {
  if (value instanceof Date) {
    return value.getTime()
  }

  return typeof value === "string" && value.trim() ? Date.parse(value) : Number.NaN
}

/** Fim do período que governa o estado (teste ou ciclo pago); NaN quando não se aplica. */
function governingPeriodEnd(input: BillingStateInput): number {
  if (input.status === "trialing") {
    const useTrialDate = input.planKey === "trial" || input.currentPeriodEnd == null
    return toTimestamp(useTrialDate ? input.trialEndsAt : input.currentPeriodEnd)
  }

  if (PAYMENT_PENDING_STATUSES.has(input.status)) {
    return toTimestamp(input.currentPeriodEnd)
  }

  return Number.NaN
}

export function resolveBillingState(
  input: BillingStateInput,
  now: Date = new Date()
): BillingState {
  if (input.status === "active") {
    return "active"
  }

  const current = now.getTime()
  const periodEnd = governingPeriodEnd(input)

  // NaN em qualquer lado torna as comparações falsas: cai em read_only.
  if (input.status === "trialing" && current <= periodEnd) {
    return "trialing"
  }

  if (
    (input.status === "trialing" || PAYMENT_PENDING_STATUSES.has(input.status)) &&
    current <= periodEnd + GRACE_MS
  ) {
    return "grace"
  }

  return "read_only"
}

/** Quando a carência termina (o acesso vira somente leitura), ou null se não se aplica. */
export function getGraceEndsAt(input: BillingStateInput): Date | null {
  const periodEnd = governingPeriodEnd(input)
  return Number.isFinite(periodEnd) ? new Date(periodEnd + GRACE_MS) : null
}

/** Dias de teste restantes, arredondados para cima (0 quando vencido ou data inválida). */
export function trialDaysRemaining(trialEndsAt: string | Date, now: Date = new Date()): number {
  const remaining = toTimestamp(trialEndsAt) - now.getTime()
  return Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining / DAY_MS)) : 0
}

/** Criar e editar só é permitido fora do modo leitura (a assinatura sempre pode ser gerida). */
export function isBillingWritable(state: BillingState): boolean {
  return state !== "read_only"
}
