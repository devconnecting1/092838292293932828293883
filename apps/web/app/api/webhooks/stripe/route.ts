import { revalidateTag } from "next/cache"
import { after } from "next/server"
import type Stripe from "stripe"

import { describeBillingError } from "@/lib/billing/errors"
import { BILLING_CATALOG_CACHE_TAG } from "@/lib/billing/queries"
import {
  handleReferralBillingChange,
  recordReferralChargeIssue,
  recordReferralInvoicePaid,
  ReferralConflictError,
  sendReferralNotice,
  type ReferralNotice,
} from "@/lib/billing/referrals"
import { BillingRpcError } from "@/lib/billing/rpc"
import {
  getStripe,
  isStripeResourceMissing,
  isTransientStripeError,
  readWebhookSecret,
} from "@/lib/billing/stripe"
import {
  parseOrganizationId,
  StripeNotConfiguredError,
  syncCustomerWithoutSubscription,
  syncSubscriptionFromStripe,
  type SyncResult,
} from "@/lib/billing/sync"
import { looksLikeStripeDelivery, recordBillingWebhookDelivery } from "@/lib/status/billing-webhook"

/**
 * Webhook da Stripe (pagamentos e assinatura). Público e sem sessão: a
 * autenticidade vem da assinatura `stripe-signature` sobre o corpo cru.
 * O payload do evento só aponta QUAL objeto mudou; o estado é relido na API
 * (lib/billing/sync.ts) e gravado com upsert idempotente. Depois, o Indique e
 * ganhe registra fatura paga, estorno e disputa e recalcula os descontos.
 * Preço e produto mudados na Stripe só invalidam o cache do catálogo de
 * /planos (tag "billing-catalog"), sem sincronizar assinatura.
 *
 * Respostas: 400 assinatura inválida; 500 falha transitória (a Stripe reenvia);
 * 200 nos demais casos, inclusive eventos ignorados. Logs sem dados pessoais.
 *
 * Página de status: depois de responder (`after`), grava só o resultado da
 * entrega (ok, config_ausente, assinatura_invalida ou erro_processamento) e o
 * tipo do evento verificado — a medição automática de "Assinaturas e
 * pagamentos" (lib/status/billing-webhook.ts). Falha de configuração só conta
 * com cabeçalho Stripe-Signature recente (robô e reenvio velho não contam).
 * Gravar nunca muda nem atrasa a resposta.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HANDLED_EVENT_TYPES = new Set<string>([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  // Catálogo de /planos (lib/billing/queries.ts): só invalidam o cache da
  // tag "billing-catalog", sem tocar em assinatura nem em indicações.
  "price.created",
  "price.updated",
  "price.deleted",
  "product.updated",
])

/** Eventos em que muda a cobrança de uma imobiliária indicada ou indicadora. */
const REFERRAL_EVENT_TYPES = new Set<string>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
])

/** Erros de validação do payload no banco: repetir não resolve. */
const PERMANENT_RPC_CODES = new Set(["22023", "22P02", "23514"])

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null
  }

  return typeof value === "string" ? value : value.id
}

/** Customer da cobrança contestada (a disputa aponta só a cobrança). */
async function disputeCustomerId(stripe: Stripe, dispute: Stripe.Dispute): Promise<string | null> {
  if (typeof dispute.charge !== "string") {
    return idOf(dispute.charge.customer)
  }

  try {
    const charge = await stripe.charges.retrieve(dispute.charge)
    return idOf(charge.customer)
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return null
    }

    throw error
  }
}

async function handleEvent(stripe: Stripe, event: Stripe.Event): Promise<SyncResult | null> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object

      if (session.mode !== "subscription") {
        return null
      }

      const hint = {
        organizationId:
          parseOrganizationId(session.client_reference_id) ??
          parseOrganizationId(session.metadata?.organization_id),
      }
      const subscriptionId = idOf(session.subscription)

      if (subscriptionId) {
        return syncSubscriptionFromStripe(subscriptionId, hint)
      }

      const customerId = idOf(session.customer)
      return customerId ? syncCustomerWithoutSubscription(customerId, hint) : null
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return syncSubscriptionFromStripe(event.data.object.id)
    case "invoice.paid":
    case "invoice.payment_failed": {
      // A imobiliária sai da assinatura da fatura (nunca do customer sozinho).
      const subscriptionId = idOf(event.data.object.parent?.subscription_details?.subscription)
      return subscriptionId ? syncSubscriptionFromStripe(subscriptionId) : null
    }
    case "charge.refunded": {
      const customerId = idOf(event.data.object.customer)
      return customerId ? syncCustomerWithoutSubscription(customerId) : null
    }
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      const customerId = await disputeCustomerId(stripe, event.data.object)
      return customerId ? syncCustomerWithoutSubscription(customerId) : null
    }
    case "price.created":
    case "price.updated":
    case "price.deleted":
    case "product.updated":
      // Preço ou produto mudou na Stripe: invalida na hora (sem servir
      // conteúdo obsoleto) o cache de 1h de getCatalogPrices, para /planos
      // não ficar com valor antigo até a revalidação por tempo.
      revalidateTag(BILLING_CATALOG_CACHE_TAG, { expire: 0 })
      return null
    default:
      return null
  }
}

function isTransientFailure(error: unknown) {
  if (error instanceof StripeNotConfiguredError || error instanceof ReferralConflictError) {
    return true
  }

  if (error instanceof BillingRpcError) {
    return !PERMANENT_RPC_CODES.has(error.code ?? "")
  }

  return isTransientStripeError(error)
}

/** Avisos por e-mail depois da resposta (o envio nunca lança). */
function scheduleReferralNotices(notices: ReferralNotice[]) {
  if (notices.length === 0) {
    return
  }

  after(async () => {
    for (const notice of notices) {
      await sendReferralNotice(notice)
    }
  })
}

/** Fatura paga (1º pagamento e valor líquido do plano), estorno e disputa. */
async function recordReferralFacts(stripe: Stripe, event: Stripe.Event, organizationId: string) {
  switch (event.type) {
    case "invoice.paid":
      await recordReferralInvoicePaid(stripe, event.data.object, organizationId)
      return
    case "charge.refunded":
      if (event.data.object.amount_refunded > 0) {
        await recordReferralChargeIssue(organizationId, "refund")
      }
      return
    case "charge.dispute.created":
      await recordReferralChargeIssue(organizationId, "dispute")
      return
    case "charge.dispute.closed":
      await recordReferralChargeIssue(
        organizationId,
        event.data.object.status === "lost" ? "dispute_lost" : "dispute_won"
      )
      return
    default:
      return
  }
}

/**
 * Indique e ganhe, depois da sincronização: registra os fatos de cobrança e
 * recalcula a imobiliária e quem a indicou. Falha transitória lança (a Stripe
 * reenvia; tudo é idempotente e os avisos saem de transições já gravadas);
 * falha permanente só é registrada, sem travar a sincronização da assinatura.
 */
async function applyReferralEffects(
  stripe: Stripe,
  event: Stripe.Event,
  result: SyncResult | null
) {
  if (result?.outcome !== "synced" || !REFERRAL_EVENT_TYPES.has(event.type)) {
    return
  }

  try {
    await recordReferralFacts(stripe, event, result.organizationId)

    const { notices, error } = await handleReferralBillingChange({
      organizationId: result.organizationId,
    })

    scheduleReferralNotices(notices)

    if (error) {
      throw error
    }
  } catch (error) {
    if (isTransientFailure(error)) {
      throw error
    }

    console.error(
      `[billing/webhook] ${event.id} ${event.type}: indicações não recalculadas (${describeBillingError(error)})`
    )
  }
}

function describeResult(result: SyncResult | null) {
  if (!result) {
    return "sem assinatura a sincronizar"
  }

  if (result.outcome === "synced") {
    return `sincronizado (organização ${result.organizationId}, status ${result.subscriptionStatus ?? "sem assinatura"})`
  }

  return `ignorado: ${result.reason}${result.organizationId ? ` (organização ${result.organizationId})` : ""}`
}

export async function POST(request: Request) {
  const stripe = getStripe()
  const webhookSecret = readWebhookSecret()

  if (!stripe || !webhookSecret) {
    console.error(
      "[billing/webhook] STRIPE_SECRET_KEY ou STRIPE_WEBHOOK_SECRET ausente ou inválida"
    )

    if (looksLikeStripeDelivery(request)) {
      after(() => recordBillingWebhookDelivery("config_ausente"))
    }

    return reply(500, { error: "not_configured" })
  }

  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return reply(400, { error: "missing_signature" })
  }

  // Corpo cru: qualquer parse antes da verificação invalida a assinatura.
  const payload = await request.text()
  let event: Stripe.Event

  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret)
  } catch (error) {
    console.error(`[billing/webhook] assinatura inválida (${describeBillingError(error)})`)

    if (looksLikeStripeDelivery(request)) {
      after(() => recordBillingWebhookDelivery("assinatura_invalida"))
    }

    return reply(400, { error: "invalid_signature" })
  }

  const eventType = event.type

  if (!HANDLED_EVENT_TYPES.has(eventType)) {
    after(() => recordBillingWebhookDelivery("ok", eventType))
    return reply(200, { received: true })
  }

  try {
    const result = await handleEvent(stripe, event)
    await applyReferralEffects(stripe, event, result)
    console.info(`[billing/webhook] ${event.id} ${event.type}: ${describeResult(result)}`)
    after(() => recordBillingWebhookDelivery("ok", eventType))
    return reply(200, { received: true })
  } catch (error) {
    const transient = isTransientFailure(error)

    console.error(
      `[billing/webhook] ${event.id} ${event.type}: falha ${transient ? "transitória" : "permanente"} (${describeBillingError(error)})`
    )

    after(() => recordBillingWebhookDelivery("erro_processamento", eventType))
    return transient ? reply(500, { error: "retry" }) : reply(200, { received: true })
  }
}
