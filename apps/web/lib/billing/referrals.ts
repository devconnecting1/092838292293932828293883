import "server-only"

import type Stripe from "stripe"

import {
  BILLING_INTERVALS,
  parseLookupKey,
  parseReferralCouponId,
  PLAN_KEYS,
  planNetMonthlyCents,
  planReferralRecalculation,
  priceLookupKey,
  REFERRAL_CRON_MAX_REFERRERS,
  REFERRAL_CRON_PAGE_SIZE,
  REFERRAL_MAX_PROPAGATION_DEPTH,
  REFERRAL_PAID_INVOICE_REASONS,
  REFERRAL_RECALC_CONFLICT_RETRIES,
  REFERRAL_RECONCILE_MAX_PER_RUN,
  REFERRAL_STATE_MAX_REFERRALS,
  referralCouponId,
  referralGraceCompletionWindow,
  referralGraceEndsAt,
  referralLinkPath,
  referralReconcileSeed,
  type BillingInterval,
  type PlanKey,
  type ReferralDiscount,
  type ReferralInvoicePlanLine,
  type ReferralRecalculationPlan,
  type ReferralStatus,
} from "@workspace/core/billing"

import {
  couponIdsByDiscount,
  phaseDiscountsWithReferralCoupon,
  subscriptionDiscountCouponId,
} from "@/lib/billing/discounts"
import { describeBillingError } from "@/lib/billing/errors"
import { getCatalogPrices } from "@/lib/billing/queries"
import {
  applyReferralRecalculation,
  getReferralState,
  listReferralGraceCompletions,
  listReferralReferrers,
  recordBillingInvoicePaid,
  setReferralConfirmationNotice,
  setReferralIneligibility,
  type ReferralChargeIssue,
  type ReferralIneligibleReason,
  type ReferralState,
} from "@/lib/billing/rpc"
import {
  getStripe,
  getStripeMode,
  isStripeError,
  isStripeResourceMissing,
} from "@/lib/billing/stripe"
import { StripeNotConfiguredError } from "@/lib/billing/sync"
import { sendNotificationEmail, type NotificationSummary } from "@/lib/email"
import { createClient as createSessionClient } from "@/lib/supabase/server"
import { buildAppUrl, isValidTenantSlug } from "@/lib/tenant/urls"

/**
 * Indique e ganhe: recálculo do desconto do indicador, cupom na Stripe, fatos
 * de cobrança (fatura paga, estorno, disputa), passadas do cron e avisos.
 * Regras e números ficam em @workspace/core/billing (referrals.ts).
 *
 * Recálculo: lê o estado (RPC com BILLING_SERVER_KEY), aplica o cupom na
 * assinatura (ou nas fases da agenda, se houver) e grava percentual e
 * transições com apply_referral_recalculation, que recusa gravar se outro
 * recálculo mudou o percentual antes (conflito → lê de novo e repete). Os
 * avisos saem das transições gravadas (perda) e de reservas exclusivas
 * (confirmação), sem depender do status anterior da sincronização.
 */

/** Assinaturas que ainda geram faturas: o cupom é mantido em dia nelas. */
const COUPON_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
])

/** Agendas que ainda comandam a assinatura. */
const ACTIVE_SCHEDULE_STATUSES = new Set(["active", "not_started"])

/** A Stripe aceita no máximo 10 lookup_keys por chamada de prices.list. */
const LOOKUP_KEYS_PER_REQUEST = 10

/** Preços consultados nas faturas, por processo. */
const PRICE_CACHE_LIMIT = 200

const PLAN_LOOKUP_KEYS = PLAN_KEYS.flatMap((plan) =>
  BILLING_INTERVALS.map((interval) => priceLookupKey(plan, interval))
)

/** Cupons já conferidos neste processo (por modo test/live); limpo em qualquer erro. */
const ensuredCoupons = new Set<string>()
let planProductsCache: { mode: string; products: string[] } | null = null
const priceCache = new Map<string, Stripe.Price>()

/** Configuração da Stripe que impede aplicar o desconto (repetir não resolve). */
export class ReferralConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReferralConfigurationError"
  }
}

/** Outros recálculos gravaram antes em todas as tentativas (a Stripe pode reenviar). */
export class ReferralConflictError extends Error {
  constructor() {
    super("recálculo de indicação em conflito")
    this.name = "ReferralConflictError"
  }
}

function requireStripe(): Stripe {
  const stripe = getStripe()

  if (!stripe) {
    throw new StripeNotConfiguredError()
  }

  return stripe
}

function stripeModeKey() {
  return getStripeMode() ?? "none"
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null
  }

  return typeof value === "string" ? value : value.id
}

/** Esquece cupons e produtos conferidos (depois de qualquer erro na Stripe). */
export function forgetReferralStripeCache() {
  ensuredCoupons.clear()
  planProductsCache = null
}

// ---------------------------------------------------------------------------
// Cupons

/** Produtos dos preços de PLANO (lookup_key plan_*); assentos ficam de fora. */
async function listPlanProductIds(stripe: Stripe): Promise<string[]> {
  const mode = stripeModeKey()

  if (planProductsCache?.mode === mode) {
    return planProductsCache.products
  }

  const products = new Set<string>()

  for (let index = 0; index < PLAN_LOOKUP_KEYS.length; index += LOOKUP_KEYS_PER_REQUEST) {
    const prices = await stripe.prices.list({
      lookup_keys: PLAN_LOOKUP_KEYS.slice(index, index + LOOKUP_KEYS_PER_REQUEST),
      limit: 100,
    })

    for (const price of prices.data) {
      products.add(typeof price.product === "string" ? price.product : price.product.id)
    }
  }

  const sorted = [...products].sort()
  planProductsCache = { mode, products: sorted }
  return sorted
}

/** O cupom existente precisa bater com a regra: percentual, forever e só os produtos de plano. */
function assertReferralCoupon(coupon: Stripe.Coupon, percent: number, products: string[]) {
  const appliesTo = [...(coupon.applies_to?.products ?? [])].sort()
  const sameProducts =
    appliesTo.length === products.length &&
    appliesTo.every((product, index) => product === products[index])

  if (
    !coupon.valid ||
    coupon.percent_off !== percent ||
    coupon.amount_off !== null ||
    coupon.duration !== "forever" ||
    !sameProducts
  ) {
    throw new ReferralConfigurationError(
      `cupom ${coupon.id} diverge do esperado (percent_off ${percent}, forever, applies_to = produtos de plano); recrie-o`
    )
  }
}

/**
 * Garante o cupom `indicacao_{percent}` (percent_off, forever, só produtos de
 * plano). Idempotente: busca pelo id (validando a configuração) e cria só se
 * não existir; criação concorrente conta como sucesso. null para 0%.
 */
export async function ensureReferralCoupon(
  stripe: Stripe,
  percent: number
): Promise<string | null> {
  const couponId = referralCouponId(percent)

  if (!couponId) {
    return null
  }

  const cacheKey = `${stripeModeKey()}:${couponId}`

  if (ensuredCoupons.has(cacheKey)) {
    return couponId
  }

  try {
    const products = await listPlanProductIds(stripe)

    if (products.length === 0) {
      throw new ReferralConfigurationError("nenhum preço de plano (plan_*) encontrado na Stripe")
    }

    try {
      const coupon = await stripe.coupons.retrieve(couponId, { expand: ["applies_to"] })
      assertReferralCoupon(coupon, percent, products)
    } catch (error) {
      if (!isStripeResourceMissing(error)) {
        throw error
      }

      try {
        await stripe.coupons.create({
          id: couponId,
          name: `Indicação ${percent}%`,
          percent_off: percent,
          duration: "forever",
          applies_to: { products },
          metadata: { program: "indique_e_ganhe", percent: String(percent) },
        })
      } catch (createError) {
        if (!(isStripeError(createError) && createError.code === "resource_already_exists")) {
          throw createError
        }
      }
    }

    ensuredCoupons.add(cacheKey)
    return couponId
  } catch (error) {
    forgetReferralStripeCache()
    throw error
  }
}

type CouponOutcome = "updated" | "unchanged" | "skipped"

/**
 * Agenda ativa (ex.: downgrade no fim do ciclo): troca o cupom de indicação em
 * todas as fases atuais e futuras, o que também muda a assinatura na hora.
 */
async function applyReferralCouponToSchedule(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  scheduleId: string,
  targetCoupon: string | null
): Promise<CouponOutcome> {
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)

  if (!ACTIVE_SCHEDULE_STATUSES.has(schedule.status)) {
    return "skipped"
  }

  const couponsByDiscount = couponIdsByDiscount(subscription)
  const now = Math.floor(Date.now() / 1000)
  const phases = schedule.phases.filter((phase) => phase.end_date > now)

  if (phases.length === 0) {
    return "skipped"
  }

  let changed = false

  const params: Stripe.SubscriptionScheduleUpdateParams.Phase[] = phases.map((phase) => {
    const next = phaseDiscountsWithReferralCoupon(
      phase.discounts,
      couponsByDiscount,
      targetCoupon,
      {
        preferCoupon: phase.start_date > now,
      }
    )
    changed ||= next.changed

    return {
      start_date: phase.start_date,
      end_date: phase.end_date,
      items: phase.items.flatMap((item) => {
        const price = idOf(item.price)
        return price ? [{ price, quantity: item.quantity ?? undefined }] : []
      }),
      discounts: next.params.length > 0 ? next.params : "",
      proration_behavior: "none",
    }
  })

  if (!changed) {
    return "unchanged"
  }

  await stripe.subscriptionSchedules.update(schedule.id, {
    proration_behavior: "none",
    phases: params,
  })

  return "updated"
}

/**
 * Troca o cupom de indicação da assinatura pelo do percentual informado (0%
 * remove), preservando os demais descontos, sem cobrança proporcional. Com
 * agenda ativa, atualiza as fases (senão a fase seguinte voltaria sem cupom).
 */
async function applyReferralCoupon(
  stripe: Stripe,
  subscriptionId: string,
  percent: number
): Promise<CouponOutcome> {
  let subscription: Stripe.Subscription

  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] })
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return "skipped"
    }

    throw error
  }

  if (!COUPON_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    return "skipped"
  }

  try {
    const targetCoupon = percent > 0 ? await ensureReferralCoupon(stripe, percent) : null
    const scheduleId = idOf(subscription.schedule)

    if (scheduleId) {
      const outcome = await applyReferralCouponToSchedule(
        stripe,
        subscription,
        scheduleId,
        targetCoupon
      )

      if (outcome !== "skipped") {
        return outcome
      }
    }

    const isReferral = (discount: string | Stripe.Discount) =>
      parseReferralCouponId(subscriptionDiscountCouponId(discount)) !== null
    const referralDiscounts = subscription.discounts.filter(isReferral)
    const otherDiscounts = subscription.discounts.filter((discount) => !isReferral(discount))
    const alreadyApplied = targetCoupon
      ? referralDiscounts.length === 1 &&
        subscriptionDiscountCouponId(referralDiscounts[0] ?? "") === targetCoupon
      : referralDiscounts.length === 0

    if (alreadyApplied) {
      return "unchanged"
    }

    const discounts: Stripe.SubscriptionUpdateParams.Discount[] = [
      ...otherDiscounts.map((discount) => ({ discount: idOf(discount) ?? undefined })),
      ...(targetCoupon ? [{ coupon: targetCoupon }] : []),
    ]

    await stripe.subscriptions.update(subscription.id, {
      discounts: discounts.length > 0 ? discounts : "",
      proration_behavior: "none",
    })

    return "updated"
  } catch (error) {
    forgetReferralStripeCache()
    throw error
  }
}

// ---------------------------------------------------------------------------
// Fatos de cobrança (webhook)

async function resolvePrice(stripe: Stripe, price: string | Stripe.Price): Promise<Stripe.Price> {
  if (typeof price !== "string") {
    return price
  }

  const cached = priceCache.get(price)

  if (cached) {
    return cached
  }

  const resolved = await stripe.prices.retrieve(price)

  if (priceCache.size >= PRICE_CACHE_LIMIT) {
    priceCache.clear()
  }

  priceCache.set(price, resolved)
  return resolved
}

/**
 * Fatura paga de criação ou renovação, atribuída à imobiliária da assinatura
 * da fatura: grava a 1ª fatura paga (valor > 0) e o valor líquido mensal das
 * linhas de plano (bruto − descontos; assentos fora). Outras faturas
 * (proporcionais de troca, avulsas) são ignoradas. true = 1º pagamento agora.
 */
export async function recordReferralInvoicePaid(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  organizationId: string
): Promise<boolean> {
  if (!invoice.id || !REFERRAL_PAID_INVOICE_REASONS.includes(invoice.billing_reason ?? "")) {
    return false
  }

  const lines = invoice.lines.has_more
    ? await stripe.invoices.listLineItems(invoice.id, { limit: 100 }).autoPagingToArray({
        limit: 1000,
      })
    : invoice.lines.data
  const planLines: ReferralInvoicePlanLine[] = []

  for (const line of lines) {
    const price = line.pricing?.price_details?.price

    if (!price) {
      continue
    }

    const resolved = await resolvePrice(stripe, price)
    const parsed = resolved.lookup_key ? parseLookupKey(resolved.lookup_key) : null

    if (parsed?.kind !== "plan") {
      continue
    }

    planLines.push({
      amountCents: line.amount,
      discountCents: (line.discount_amounts ?? []).reduce(
        (total, discount) => total + discount.amount,
        0
      ),
      interval: parsed.interval,
    })
  }

  if (planLines.length === 0) {
    return false
  }

  const paidAt = invoice.status_transitions.paid_at ?? invoice.created

  return recordBillingInvoicePaid(organizationId, {
    paidAt: new Date(paidAt * 1000),
    invoiceCreatedAt: new Date(invoice.created * 1000),
    amountPaidCents: invoice.amount_paid,
    planNetMonthlyCents: planNetMonthlyCents(planLines),
  })
}

/** Estorno ou disputa: a imobiliária deixa de contar como indicação (disputa ganha desfaz). */
export async function recordReferralChargeIssue(
  organizationId: string,
  issue: ReferralChargeIssue
): Promise<boolean> {
  return setReferralIneligibility(organizationId, issue)
}

// ---------------------------------------------------------------------------
// Recálculo

function planFromState(
  state: ReferralState,
  prices: Record<string, number>,
  now: Date,
  referrerPlan?: { planKey: PlanKey; interval: BillingInterval }
): ReferralRecalculationPlan {
  const organization = state.organization

  return planReferralRecalculation({
    referrer: referrerPlan
      ? { billingStatus: "active", ...referrerPlan }
      : {
          billingStatus: organization.status,
          planKey: organization.planKey,
          interval: organization.interval,
        },
    referrals: state.referrals.map((referral) => ({
      id: referral.organizationId,
      billingStatus: referral.status,
      planKey: referral.planKey,
      interval: referral.interval,
      firstPaidAt: referral.firstPaidAt,
      discountPercent: referral.referralDiscountPercent,
      netMonthlyCents: referral.netMonthlyCents,
      ineligible: referral.ineligibleReason !== null,
      countedAt: referral.countedAt,
      confirmedNotifiedAt: referral.confirmedNotifiedAt,
    })),
    prices,
    now,
  })
}

export type ReferralNotice = {
  kind: "confirmed" | "lost"
  referrer: ReferralRecalculation
  referredOrganizationId: string
  /** Marca da transição (chave de idempotência): quando passou a contar ou fim da carência. */
  marker: string
}

export type ReferralRecalculation = {
  organizationId: string
  state: ReferralState
  plan: ReferralRecalculationPlan
  previousPercent: number
  percent: number
  stripe: CouponOutcome
  /** Avisos desta imobiliária e dos indicadores acima (propagação). */
  notices: ReferralNotice[]
  /** Falha ao propagar para quem indicou esta imobiliária (a reconciliação diária retoma). */
  propagationError: unknown
}

/**
 * Recalcula o desconto da imobiliária (como indicadora), aplica o cupom e
 * grava percentual e transições. Depois propaga para quem indicou esta
 * imobiliária (o valor que ela paga pode ter mudado), até
 * REFERRAL_MAX_PROPAGATION_DEPTH níveis; falha na propagação não desfaz o que
 * já foi gravado e volta em `propagationError`.
 *
 * `verifyStripe`: confere o cupom na assinatura mesmo sem mudança de percentual.
 */
export async function recalculateReferralDiscount(
  organizationId: string,
  options: {
    verifyStripe?: boolean
    now?: Date
    depth?: number
    propagate?: boolean
    state?: ReferralState
  } = {}
): Promise<ReferralRecalculation | null> {
  const now = options.now ?? new Date()
  const depth = options.depth ?? 0
  let verifyStripe = options.verifyStripe ?? false
  let preloaded = options.state ?? null

  for (let attempt = 0; attempt <= REFERRAL_RECALC_CONFLICT_RETRIES; attempt += 1) {
    const state = preloaded ?? (await getReferralState(organizationId))
    preloaded = null

    if (!state) {
      return null
    }

    if (state.organization.referralsTruncated) {
      console.warn(
        `[billing/referrals] indicadora com mais de ${REFERRAL_STATE_MAX_REFERRALS} indicadas: o cálculo usa as ${REFERRAL_STATE_MAX_REFERRALS} primeiras (as que já pagaram vêm antes)`
      )
    }

    const plan = planFromState(state, await getCatalogPrices(), now)
    const previousPercent = state.organization.referralDiscountPercent
    const subscriptionId = state.organization.stripeSubscriptionId
    let stripeOutcome: CouponOutcome = "skipped"

    if (subscriptionId && (verifyStripe || plan.targetPercent !== previousPercent)) {
      stripeOutcome = await applyReferralCoupon(requireStripe(), subscriptionId, plan.targetPercent)
    }

    const applied = await applyReferralRecalculation(organizationId, {
      expectedPercent: previousPercent,
      percent: plan.targetPercent,
      count: plan.toCount,
      uncount: plan.toUncount,
      // Recusa gravar se algum fato de cobrança mudou depois desta leitura
      // (ex.: estorno registrado enquanto a Stripe respondia).
      stateFingerprint: state.organization.stateFingerprint,
    })

    if (applied.status === "conflict") {
      // Outro recálculo gravou antes: relê e confere o cupom de novo.
      verifyStripe = true
      continue
    }

    const result: ReferralRecalculation = {
      organizationId,
      state,
      plan,
      previousPercent,
      percent: plan.targetPercent,
      stripe: stripeOutcome,
      notices: [],
      propagationError: null,
    }

    for (const uncounted of applied.uncounted) {
      result.notices.push({
        kind: "lost",
        referrer: result,
        referredOrganizationId: uncounted.organizationId,
        marker: uncounted.countedAt,
      })
    }

    for (const referredId of plan.pendingConfirmations) {
      const referral = state.referrals.find((item) => item.organizationId === referredId)
      const graceEndsAt = referralGraceEndsAt(referral?.firstPaidAt)

      if (graceEndsAt) {
        result.notices.push({
          kind: "confirmed",
          referrer: result,
          referredOrganizationId: referredId,
          marker: graceEndsAt.toISOString(),
        })
      }
    }

    const referrerId = state.organization.referredByOrganizationId

    if ((options.propagate ?? true) && referrerId && depth < REFERRAL_MAX_PROPAGATION_DEPTH) {
      try {
        const parent = await recalculateReferralDiscount(referrerId, { now, depth: depth + 1 })

        if (parent) {
          result.notices.push(...parent.notices)
          result.propagationError = parent.propagationError
        }
      } catch (error) {
        result.propagationError = error
        console.error(
          `[billing/referrals] propagação para quem indicou falhou (${describeBillingError(error)})`
        )
      }
    }

    return result
  }

  throw new ReferralConflictError()
}

/**
 * Depois de sincronizar a cobrança de uma imobiliária (webhook): recalcula ela
 * mesma quando indicou alguém (o que já propaga para quem a indicou) ou, senão,
 * só quem a indicou. Um único recálculo por indicador.
 */
export async function handleReferralBillingChange(input: {
  organizationId: string
  now?: Date
}): Promise<{ notices: ReferralNotice[]; error: unknown }> {
  const now = input.now ?? new Date()
  const state = await getReferralState(input.organizationId)

  if (!state) {
    return { notices: [], error: null }
  }

  const organization = state.organization
  let result: ReferralRecalculation | null = null

  if (state.referrals.length > 0 || organization.referralDiscountPercent > 0) {
    result = await recalculateReferralDiscount(organization.id, {
      verifyStripe: true,
      now,
      state,
    })
  } else if (organization.referredByOrganizationId) {
    result = await recalculateReferralDiscount(organization.referredByOrganizationId, { now })
  }

  return { notices: result?.notices ?? [], error: result?.propagationError ?? null }
}

// ---------------------------------------------------------------------------
// Cron diário

export type ReferralCronSummary = {
  graceReferrers: number
  reconciled: number
  recalculated: number
  failed: number
  notices: number
  truncated: { grace: boolean; reconcile: boolean }
  error: boolean
}

function noticeKey(notice: ReferralNotice) {
  return `${notice.kind}:${notice.referredOrganizationId}:${notice.marker}`
}

/**
 * Passadas do cron diário (nunca lança):
 * 1. carências completadas nos últimos dias (paginado, até
 *    REFERRAL_CRON_MAX_REFERRERS indicadores, com propagação);
 * 2. reconciliação: indicadores com desconto gravado ou com indicadas, em ordem
 *    que muda a cada dia (até REFERRAL_RECONCILE_MAX_PER_RUN), conferindo o
 *    cupom na Stripe. Cobre falhas parciais, propagação interrompida e
 *    indicadas excluídas.
 */
export async function runReferralCronPasses(
  now = new Date()
): Promise<{ summary: ReferralCronSummary; notices: ReferralNotice[] }> {
  const summary: ReferralCronSummary = {
    graceReferrers: 0,
    reconciled: 0,
    recalculated: 0,
    failed: 0,
    notices: 0,
    truncated: { grace: false, reconcile: false },
    error: false,
  }
  const notices = new Map<string, ReferralNotice>()
  const processed = new Set<string>()

  const recalculate = async (organizationId: string, options: { reconcile: boolean }) => {
    try {
      const result = await recalculateReferralDiscount(organizationId, {
        now,
        verifyStripe: options.reconcile,
        propagate: !options.reconcile,
      })

      if (!result) {
        return
      }

      summary.recalculated += 1

      for (const notice of result.notices) {
        notices.set(noticeKey(notice), notice)
      }

      if (result.propagationError) {
        summary.failed += 1
      }
    } catch (error) {
      summary.failed += 1
      console.error(`[billing/referrals] recálculo no cron falhou (${describeBillingError(error)})`)
    }
  }

  // 1. Carências completadas
  const window = referralGraceCompletionWindow(now)
  let cursor: { paidAt: string; organizationId: string } | null = null

  try {
    graceLoop: while (true) {
      const page = await listReferralGraceCompletions({
        ...window,
        cursor,
        limit: REFERRAL_CRON_PAGE_SIZE,
      })

      for (const row of page) {
        if (processed.has(row.referrerOrganizationId)) {
          continue
        }

        if (summary.graceReferrers >= REFERRAL_CRON_MAX_REFERRERS) {
          summary.truncated.grace = true
          break graceLoop
        }

        processed.add(row.referrerOrganizationId)
        summary.graceReferrers += 1
        await recalculate(row.referrerOrganizationId, { reconcile: false })
      }

      const last = page.at(-1)

      if (page.length < REFERRAL_CRON_PAGE_SIZE || !last) {
        break
      }

      cursor = { paidAt: last.firstPaidAt, organizationId: last.referredOrganizationId }
    }
  } catch (error) {
    summary.error = true
    console.error(
      `[billing/referrals] leitura das carências falhou (${describeBillingError(error)})`
    )
  }

  // 2. Reconciliação
  const seed = referralReconcileSeed(now)
  let after: string | null = null

  try {
    reconcileLoop: while (true) {
      const page = await listReferralReferrers({ seed, after, limit: REFERRAL_CRON_PAGE_SIZE })

      for (const item of page) {
        if (processed.has(item.organizationId)) {
          continue
        }

        if (summary.reconciled >= REFERRAL_RECONCILE_MAX_PER_RUN) {
          summary.truncated.reconcile = true
          break reconcileLoop
        }

        processed.add(item.organizationId)
        summary.reconciled += 1
        await recalculate(item.organizationId, { reconcile: true })
      }

      const last = page.at(-1)

      if (page.length < REFERRAL_CRON_PAGE_SIZE || !last) {
        break
      }

      after = last.sortKey
    }
  } catch (error) {
    summary.error = true
    console.error(`[billing/referrals] reconciliação falhou (${describeBillingError(error)})`)
  }

  summary.notices = notices.size
  return { summary, notices: [...notices.values()] }
}

// ---------------------------------------------------------------------------
// Avisos por e-mail

/**
 * Aviso aos donos da indicadora (até `maxRecipients`). Confirmação: reserva
 * exclusiva antes de enviar e libera se nada saiu (outra execução tenta de novo
 * dentro da janela). Perda: sai uma vez, da transição gravada. Nunca lança.
 */
export async function sendReferralNotice(
  notice: ReferralNotice,
  options: { maxRecipients?: number } = {}
): Promise<NotificationSummary | null> {
  const { state, plan } = notice.referrer
  const organization = state.organization
  const recipients = organization.ownerEmails.slice(
    0,
    Math.max(0, options.maxRecipients ?? organization.ownerEmails.length)
  )

  if (!isValidTenantSlug(organization.slug) || recipients.length === 0) {
    return null
  }

  try {
    if (notice.kind === "confirmed") {
      const claimed = await setReferralConfirmationNotice(
        organization.id,
        notice.referredOrganizationId,
        true
      )

      if (!claimed) {
        return null
      }
    }

    const referred = state.referrals.find(
      (referral) => referral.organizationId === notice.referredOrganizationId
    )
    const summary = await sendNotificationEmail("referral_notice", {
      organizationSlug: organization.slug,
      organizationName: organization.name,
      notice: notice.kind,
      referredOrganizationId: notice.referredOrganizationId,
      referredName: referred?.displayName ?? null,
      marker: notice.marker,
      discountPercent: plan.discount.percent,
      discountApplied: plan.discount.applied,
      to: recipients.map((email) => ({ email })),
    })

    if (notice.kind === "confirmed" && summary.sent === 0) {
      await setReferralConfirmationNotice(organization.id, notice.referredOrganizationId, false)
    }

    return summary
  } catch (error) {
    console.error(`[billing/referrals] aviso de indicação falhou (${describeBillingError(error)})`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Checkout

/**
 * Cupom de indicação para a primeira contratação: o desconto acumulado,
 * calculado com o plano escolhido (trava de valor), já vale na 1ª fatura.
 * null sem indicações ativas.
 */
export async function referralCouponForCheckout(
  stripe: Stripe,
  organizationId: string,
  choice: { planKey: PlanKey; interval: BillingInterval }
): Promise<string | null> {
  const state = await getReferralState(organizationId)

  if (!state || state.referrals.length === 0) {
    return null
  }

  const plan = planFromState(state, await getCatalogPrices(), new Date(), choice)
  return ensureReferralCoupon(stripe, plan.discount.percent)
}

// ---------------------------------------------------------------------------
// Leitura para as páginas

export type ReferralListItem = {
  key: string
  displayName: string
  createdAt: string | null
  status: ReferralStatus
  graceEndsAt: string | null
  ineligibleReason: ReferralIneligibleReason | null
}

export type ReferralPageData = {
  code: string
  linkUrl: string
  /** Calculado agora. */
  discount: ReferralDiscount
  /** Gravado e aplicado na Stripe. */
  storedPercent: number
  /** Assinatura ativa e o calculado ainda não chegou à cobrança. */
  updating: boolean
  referrals: ReferralListItem[]
  total: number
  truncated: boolean
}

/** Dados da página de indicações; null se indisponível (erro já registrado). */
export async function loadReferralPageData(
  organizationId: string
): Promise<ReferralPageData | null> {
  try {
    const state = await getReferralState(organizationId)
    const linkPath = state ? referralLinkPath(state.organization.referralCode) : null

    if (!state || !linkPath) {
      return null
    }

    const plan = planFromState(state, await getCatalogPrices(), new Date())
    const discount = plan.discount
    const storedPercent = state.organization.referralDiscountPercent

    return {
      code: state.organization.referralCode,
      linkUrl: buildAppUrl(linkPath),
      discount,
      storedPercent,
      updating: discount.applied && plan.targetPercent !== storedPercent,
      referrals: state.referrals.map((referral, index) => ({
        key: String(index),
        displayName: referral.displayName,
        createdAt: referral.createdAt,
        status: discount.statuses[index] ?? "awaiting_payment",
        graceEndsAt: referralGraceEndsAt(referral.firstPaidAt)?.toISOString() ?? null,
        ineligibleReason: referral.ineligibleReason,
      })),
      total: state.organization.referralTotal,
      truncated: state.organization.referralsTruncated,
    }
  } catch (error) {
    console.error(`[billing/referrals] leitura da página falhou (${describeBillingError(error)})`)
    return null
  }
}

/** Percentual gravado (o que está na Stripe), lido com a sessão; null em erro. */
export async function getStoredReferralDiscountPercent(
  organizationId: string
): Promise<number | null> {
  const supabase = await createSessionClient()
  const { data, error } = await supabase
    .from("billing_accounts")
    .select("referral_discount_percent")
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data.referral_discount_percent
}
