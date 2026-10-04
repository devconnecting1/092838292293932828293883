// Programa "Indique e ganhe" (cliente indica cliente). Módulo puro: sem Stripe,
// banco ou relógio do sistema (quem chama informa `now`). Todos os números do
// programa ficam aqui. O SQL (migrações referral_program*) repete só o alfabeto
// e o tamanho do código de indicação; mantenha os dois iguais.
//
// Regras:
// - Indicação ativa: a imobiliária indicada tem assinatura `active`, a 1ª
//   fatura paga (valor > 0) há pelo menos REFERRAL_GRACE_DAYS dias e não está
//   inelegível (estorno, disputa, membros em comum ou mesmo CNPJ).
// - Cada indicação ativa vale REFERRAL_PERCENT_PER_ACTIVE% do plano do
//   indicador, com trava de valor: em reais, no máximo
//   REFERRAL_VALUE_CAP_PERCENT% do que a indicada paga de fato pelo plano
//   (valor líquido da última fatura paga, mensal equivalente, e nunca acima do
//   preço de catálogo menos o desconto por indicações dela).
// - Soma arredondada PARA BAIXO em degraus de REFERRAL_PERCENT_STEP%, até
//   REFERRAL_MAX_PERCENT%. Assentos extras não entram.
// - O desconto só é aplicado com a assinatura do indicador ativa; sem plano pago
//   conhecido o acumulado é só uma estimativa e não é gravado.

import {
  isBillingInterval,
  isPlanKey,
  PLANS,
  priceLookupKey,
  type BillingInterval,
  type PlanKey,
} from "./plans"

/** Percentual do plano do indicador ganho por indicação ativa. */
export const REFERRAL_PERCENT_PER_ACTIVE = 10
/** O total é arredondado para baixo neste degrau. */
export const REFERRAL_PERCENT_STEP = 10
/** Teto do desconto acumulado (100% = mensalidade do plano grátis). */
export const REFERRAL_MAX_PERCENT = 100
/** Trava: cada indicação rende no máximo esta fração (%) do que a indicada paga. */
export const REFERRAL_VALUE_CAP_PERCENT = 50
/** Carência depois da 1ª fatura paga (proteção contra reembolso e chargeback). */
export const REFERRAL_GRACE_DAYS = 30
/** O cron diário revisa carências completadas nestes últimos dias (cobre dias sem execução). */
export const REFERRAL_CRON_LOOKBACK_DAYS = 3
/** O aviso "indicação confirmada" sai para carências completadas nestes últimos dias. */
export const REFERRAL_CONFIRMATION_NOTICE_DAYS = 3
/** Recalcular um indicador pode mudar o do indicador dele: até esta profundidade. */
export const REFERRAL_MAX_PROPAGATION_DEPTH = 5
/** Tentativas extras quando outro recálculo gravou antes (percentual esperado divergente). */
export const REFERRAL_RECALC_CONFLICT_RETRIES = 2
/** Linhas por página nas listas do cron. */
export const REFERRAL_CRON_PAGE_SIZE = 200
/** Indicadores recalculados por execução na passada das carências. */
export const REFERRAL_CRON_MAX_REFERRERS = 200
/** Indicadores conferidos por execução na reconciliação diária (ordem muda a cada dia). */
export const REFERRAL_RECONCILE_MAX_PER_RUN = 300
/** Indicadas devolvidas por get_referral_state (as que já pagaram vêm primeiro). */
export const REFERRAL_STATE_MAX_REFERRALS = 1000

export const REFERRAL_COOKIE_NAME = "ref"
export const REFERRAL_COOKIE_MAX_AGE_DAYS = 90

export const REFERRAL_CODE_LENGTH = 8
/** Sem caracteres ambíguos (0/O, 1/I/L). */
export const REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

/** Link público: {origem}/i/{código}. */
export const REFERRAL_LINK_PATH_PREFIX = "/i"
/** Cupons na Stripe: indicacao_10 … indicacao_100 (percent_off, forever, só produtos de plano). */
export const REFERRAL_COUPON_PREFIX = "indicacao_"

/** Faturas que registram 1º pagamento e valor líquido do plano (nunca proporcionais de troca). */
export const REFERRAL_PAID_INVOICE_REASONS: readonly string[] = [
  "subscription_create",
  "subscription_cycle",
]

const PERCENT_BASE = 100
const MONTHS_PER_YEAR = 12
const DAY_MS = 24 * 60 * 60 * 1000

const CODE_PATTERN = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`)
const COUPON_PATTERN = new RegExp(`^${REFERRAL_COUPON_PREFIX}([0-9]{1,3})$`)

/** Degraus possíveis de desconto (10, 20, …, 100). */
export const REFERRAL_DISCOUNT_STEPS: readonly number[] = Array.from(
  { length: Math.floor(REFERRAL_MAX_PERCENT / REFERRAL_PERCENT_STEP) },
  (_, index) => (index + 1) * REFERRAL_PERCENT_STEP
)

// ---------------------------------------------------------------------------
// Código, link e cupons

/** Código em maiúsculas se o formato for válido (não diz se ele existe). */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const code = value.trim().toUpperCase()
  return CODE_PATTERN.test(code) ? code : null
}

export function referralLinkPath(code: string): string | null {
  const normalized = normalizeReferralCode(code)
  return normalized ? `${REFERRAL_LINK_PATH_PREFIX}/${normalized}` : null
}

export function isReferralDiscountStep(value: unknown): value is number {
  return typeof value === "number" && REFERRAL_DISCOUNT_STEPS.includes(value)
}

/** Id do cupom da Stripe para o degrau; null para 0% ou valor fora dos degraus. */
export function referralCouponId(percent: number): string | null {
  return isReferralDiscountStep(percent) ? `${REFERRAL_COUPON_PREFIX}${percent}` : null
}

/** Percentual de um id de cupom de indicação; null para qualquer outro cupom. */
export function parseReferralCouponId(id: unknown): number | null {
  if (typeof id !== "string") {
    return null
  }

  const match = COUPON_PATTERN.exec(id)
  const percent = match?.[1] ? Number(match[1]) : null
  return isReferralDiscountStep(percent) ? percent : null
}

// ---------------------------------------------------------------------------
// Situação de cada indicação

export type ReferralStatus = "awaiting_payment" | "in_grace" | "active" | "lost" | "ineligible"

export const REFERRAL_STATUSES: readonly ReferralStatus[] = [
  "active",
  "in_grace",
  "awaiting_payment",
  "lost",
  "ineligible",
]

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  active: "Ativa",
  in_grace: "Em carência",
  awaiting_payment: "Aguardando pagamento",
  lost: "Perdida",
  ineligible: "Não elegível",
}

type DateInput = string | Date | null | undefined

function toTime(value: DateInput): number | null {
  if (!value) {
    return null
  }

  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** Fim da carência (1ª fatura paga + REFERRAL_GRACE_DAYS); null sem pagamento. */
export function referralGraceEndsAt(firstPaidAt: DateInput): Date | null {
  const paid = toTime(firstPaidAt)
  return paid === null ? null : new Date(paid + REFERRAL_GRACE_DAYS * DAY_MS)
}

/**
 * - ineligible: estorno, disputa, membros em comum ou mesmo CNPJ (nunca conta);
 * - awaiting_payment: ainda sem fatura paga (teste ou pagamento pendente);
 * - in_grace: assinatura ativa, 1ª fatura paga há menos de REFERRAL_GRACE_DAYS;
 * - active: assinatura ativa e carência cumprida (limite inclusivo);
 * - lost: já pagou, mas a assinatura não está ativa (cancelada, em atraso…).
 */
export function resolveReferralStatus(
  account: {
    billingStatus: string | null | undefined
    firstPaidAt: DateInput
    ineligible?: boolean | null
  },
  now: Date
): ReferralStatus {
  if (account.ineligible) {
    return "ineligible"
  }

  const graceEndsAt = referralGraceEndsAt(account.firstPaidAt)

  if (!graceEndsAt) {
    return "awaiting_payment"
  }

  if (account.billingStatus !== "active") {
    return "lost"
  }

  return now.getTime() >= graceEndsAt.getTime() ? "active" : "in_grace"
}

// ---------------------------------------------------------------------------
// Valor líquido do plano (fatura paga)

export type ReferralInvoicePlanLine = {
  /** Valor bruto da linha, em centavos. */
  amountCents: number
  /** Soma dos descontos aplicados à linha, em centavos. */
  discountCents: number
  interval: BillingInterval
}

/**
 * Valor líquido mensal equivalente das linhas de PLANO de uma fatura paga
 * (bruto − descontos; anual ÷ 12), arredondado para baixo. null sem linhas.
 */
export function planNetMonthlyCents(lines: readonly ReferralInvoicePlanLine[]): number | null {
  if (lines.length === 0) {
    return null
  }

  let annual = 0

  for (const line of lines) {
    const amount = Number.isFinite(line.amountCents) ? Math.round(line.amountCents) : 0
    const discount = Number.isFinite(line.discountCents) ? Math.round(line.discountCents) : 0
    const net = Math.max(0, amount - Math.max(0, discount))
    annual += line.interval === "month" ? net * MONTHS_PER_YEAR : net
  }

  return Math.floor(annual / MONTHS_PER_YEAR)
}

// ---------------------------------------------------------------------------
// Cálculo do desconto

/** Preço em centavos por lookup_key (catálogo da Stripe); ausente = preço do core. */
export type ReferralPrices = Readonly<Record<string, number>>

export type ReferralPlanInfo = {
  planKey: string | null | undefined
  interval: string | null | undefined
}

export type ReferrerAccount = ReferralPlanInfo & {
  billingStatus: string | null | undefined
}

export type ReferredAccount = ReferralPlanInfo & {
  billingStatus: string | null | undefined
  firstPaidAt: DateInput
  /** Desconto por indicações da própria indicada (limita o valor pago pelo catálogo). */
  discountPercent?: number | null
  /**
   * Valor líquido mensal equivalente do plano na última fatura paga. Sem ele a
   * indicação não rende desconto (não há como provar o que foi pago).
   */
  netMonthlyCents?: number | null
  /** Estorno, disputa, membros em comum ou mesmo CNPJ. */
  ineligible?: boolean | null
}

export type ReferralDiscount = {
  /** Situação de cada indicação, na mesma ordem da entrada. */
  statuses: ReferralStatus[]
  counts: Record<ReferralStatus, number>
  /** Desconto acumulado calculado agora (0 a 100, em degraus). */
  percent: number
  /** Assinatura do indicador ativa: o acumulado vale na cobrança. */
  applied: boolean
  appliedPercent: number
  /** Acumulado que ainda não vale (indicador em teste ou sem assinatura ativa). */
  pendingPercent: number
  /**
   * Sem plano pago conhecido do indicador (ex.: teste grátis): a trava de valor
   * não pode ser calculada e o percentual é só uma estimativa (não é gravado).
   */
  estimated: boolean
}

function paidPlan(account: ReferralPlanInfo): { plan: PlanKey; interval: BillingInterval } | null {
  return isPlanKey(account.planKey) && isBillingInterval(account.interval)
    ? { plan: account.planKey, interval: account.interval }
    : null
}

function clampPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0
  }

  return Math.min(REFERRAL_MAX_PERCENT, Math.max(0, Math.floor(value)))
}

function floorToStep(percent: number): number {
  const stepped = Math.floor(percent / REFERRAL_PERCENT_STEP) * REFERRAL_PERCENT_STEP
  return Math.min(REFERRAL_MAX_PERCENT, Math.max(0, stepped))
}

function readNetMonthlyCents(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null
}

/** Valor anual equivalente do item do plano, em centavos (mensal × 12). */
export function planAnnualCents(
  plan: PlanKey,
  interval: BillingInterval,
  prices?: ReferralPrices
): number {
  const fromCatalog = prices?.[priceLookupKey(plan, interval)]
  const amount =
    typeof fromCatalog === "number" && Number.isFinite(fromCatalog) && fromCatalog > 0
      ? Math.round(fromCatalog)
      : PLANS[plan].prices[interval]

  return interval === "month" ? amount * MONTHS_PER_YEAR : amount
}

/**
 * Valor anual pago pela indicada × 100 (unidade das contas): o menor entre o
 * líquido da última fatura e o catálogo menos o desconto por indicações dela.
 */
function referredPaidScaled(referral: ReferredAccount, prices?: ReferralPrices): number {
  const net = readNetMonthlyCents(referral.netMonthlyCents)

  if (net === null) {
    return 0
  }

  const fromInvoice = net * MONTHS_PER_YEAR * PERCENT_BASE
  const plan = paidPlan(referral)

  if (!plan) {
    return fromInvoice
  }

  const fromCatalog =
    planAnnualCents(plan.plan, plan.interval, prices) *
    (PERCENT_BASE - clampPercent(referral.discountPercent))

  return Math.min(fromInvoice, fromCatalog)
}

/**
 * Desconto do indicador. Conta só em inteiros: com A = valor anual do plano do
 * indicador e P_i = valor anual pago pela indicada × 100, cada indicação ativa
 * soma min(100·A·10, 50·P_i) e o percentual é soma ÷ (100·A), arredondado para
 * baixo no degrau.
 */
export function computeReferralDiscount(input: {
  referrer: ReferrerAccount
  referrals: readonly ReferredAccount[]
  prices?: ReferralPrices
  now: Date
}): ReferralDiscount {
  const statuses = input.referrals.map((referral) => resolveReferralStatus(referral, input.now))
  const counts: Record<ReferralStatus, number> = {
    active: 0,
    in_grace: 0,
    awaiting_payment: 0,
    lost: 0,
    ineligible: 0,
  }

  for (const status of statuses) {
    counts[status] += 1
  }

  const referrerPlan = paidPlan(input.referrer)
  let percent: number

  if (!referrerPlan) {
    percent = floorToStep(counts.active * REFERRAL_PERCENT_PER_ACTIVE)
  } else {
    const referrerAnnual = planAnnualCents(referrerPlan.plan, referrerPlan.interval, input.prices)
    const maxPerReferral = PERCENT_BASE * referrerAnnual * REFERRAL_PERCENT_PER_ACTIVE
    let scaledTotal = 0

    input.referrals.forEach((referral, index) => {
      if (statuses[index] !== "active") {
        return
      }

      scaledTotal += Math.min(
        maxPerReferral,
        REFERRAL_VALUE_CAP_PERCENT * referredPaidScaled(referral, input.prices)
      )
    })

    const stepUnits = PERCENT_BASE * referrerAnnual * REFERRAL_PERCENT_STEP
    percent =
      referrerAnnual > 0
        ? Math.min(
            REFERRAL_MAX_PERCENT,
            Math.floor(scaledTotal / stepUnits) * REFERRAL_PERCENT_STEP
          )
        : 0
  }

  const applied = input.referrer.billingStatus === "active"

  return {
    statuses,
    counts,
    percent,
    applied,
    appliedPercent: applied ? percent : 0,
    pendingPercent: applied ? 0 : percent,
    estimated: referrerPlan === null,
  }
}

// ---------------------------------------------------------------------------
// Recálculo: percentual a gravar e transições persistidas

export type ReferralRecord = ReferredAccount & {
  id: string
  /** Quando passou a contar (null = não conta hoje). */
  countedAt: string | null
  /** Aviso "indicação confirmada" já enviado. */
  confirmedNotifiedAt: string | null
}

export type ReferralRecalculationPlan = {
  discount: ReferralDiscount
  /** Percentual a gravar e aplicar na Stripe: a estimativa sem plano pago vira 0. */
  targetPercent: number
  /** Indicadas que passam a contar agora (marcar referral_counted_at). */
  toCount: string[]
  /** Indicadas que deixaram de contar (limpar referral_counted_at e avisar a perda). */
  toUncount: string[]
  /** Indicadas ativas com carência recém-completada e ainda sem aviso de confirmação. */
  pendingConfirmations: string[]
}

/** Carência completada nos últimos REFERRAL_CONFIRMATION_NOTICE_DAYS e aviso ainda não enviado. */
export function isReferralConfirmationPending(
  referral: { firstPaidAt: DateInput; confirmedNotifiedAt: DateInput },
  now: Date
): boolean {
  if (toTime(referral.confirmedNotifiedAt) !== null) {
    return false
  }

  const graceEndsAt = referralGraceEndsAt(referral.firstPaidAt)

  if (!graceEndsAt) {
    return false
  }

  const end = graceEndsAt.getTime()
  return end <= now.getTime() && end > now.getTime() - REFERRAL_CONFIRMATION_NOTICE_DAYS * DAY_MS
}

export function planReferralRecalculation(input: {
  referrer: ReferrerAccount
  referrals: readonly ReferralRecord[]
  prices?: ReferralPrices
  now: Date
}): ReferralRecalculationPlan {
  const discount = computeReferralDiscount(input)
  const toCount: string[] = []
  const toUncount: string[] = []
  const pendingConfirmations: string[] = []

  input.referrals.forEach((referral, index) => {
    const active = discount.statuses[index] === "active"
    const counted = toTime(referral.countedAt) !== null

    if (active && !counted) {
      toCount.push(referral.id)
    } else if (!active && counted) {
      toUncount.push(referral.id)
    }

    if (active && isReferralConfirmationPending(referral, input.now)) {
      pendingConfirmations.push(referral.id)
    }
  })

  return {
    discount,
    targetPercent: discount.estimated ? 0 : discount.percent,
    toCount,
    toUncount,
    pendingConfirmations,
  }
}

// ---------------------------------------------------------------------------
// Janelas do cron diário

/** 1ª fatura paga em (paidAfter, paidUntil]: carência completada nos últimos dias. */
export function referralGraceCompletionWindow(now: Date): { paidAfter: Date; paidUntil: Date } {
  const paidUntil = new Date(now.getTime() - REFERRAL_GRACE_DAYS * DAY_MS)
  const paidAfter = new Date(
    paidUntil.getTime() -
      Math.max(REFERRAL_CRON_LOOKBACK_DAYS, REFERRAL_CONFIRMATION_NOTICE_DAYS) * DAY_MS
  )
  return { paidAfter, paidUntil }
}

/** Semente da ordem da reconciliação: muda a cada dia (UTC), então todos são visitados. */
export function referralReconcileSeed(now: Date): string {
  return now.toISOString().slice(0, 10)
}
