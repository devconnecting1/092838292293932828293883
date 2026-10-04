import "server-only"

import type Stripe from "stripe"

import {
  describeSubscriptionItems as describeItems,
  subscriptionBillingFields,
  type SubscriptionComposition as CoreSubscriptionComposition,
} from "@workspace/core/billing"

import {
  BillingRpcError,
  getBillingAccountIds,
  syncBillingAccount,
  type BillingSyncPayload,
} from "@/lib/billing/rpc"
import { getStripe, isStripeResourceMissing } from "@/lib/billing/stripe"

/**
 * Sincronização Stripe → billing_accounts. Nunca confia no payload do evento:
 * relê customer e assinaturas na API e grava o estado ATUAL (upsert idempotente),
 * o que resolve reentregas e eventos fora de ordem sem tabela de eventos.
 */

export type SyncIgnoredReason =
  | "sem_organizacao"
  | "organizacao_divergente"
  | "organizacao_inexistente"
  | "customer_divergente"
  | "customer_removido"
  | "recurso_inexistente"
  | "plano_desconhecido"

export type SyncResult =
  | {
      outcome: "synced"
      organizationId: string
      subscriptionId: string | null
      subscriptionStatus: string | null
    }
  | { outcome: "ignored"; reason: SyncIgnoredReason; organizationId: string | null }

export type SyncHint = {
  /** organization_id vindo do evento (client_reference_id): só confere, nunca decide sozinho contra a API. */
  organizationId?: string | null
}

/** STRIPE_SECRET_KEY ausente: o webhook responde 500 para a Stripe reenviar depois. */
export class StripeNotConfiguredError extends Error {
  constructor() {
    super("STRIPE_SECRET_KEY ausente")
    this.name = "StripeNotConfiguredError"
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Status da assinatura "vigente", do mais para o menos relevante. */
const SUBSCRIPTION_PRIORITY: Record<string, number> = {
  active: 0,
  trialing: 1,
  past_due: 2,
  unpaid: 3,
  paused: 4,
  incomplete: 5,
  canceled: 6,
  incomplete_expired: 7,
}

const SUBSCRIPTION_LIST_LIMIT = 20

export function parseOrganizationId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value.trim())
    ? value.trim().toLowerCase()
    : null
}

function organizationIdFromMetadata(metadata: Stripe.Metadata | null | undefined): string | null {
  return parseOrganizationId(metadata?.organization_id)
}

function requireStripe(): Stripe {
  const stripe = getStripe()

  if (!stripe) {
    throw new StripeNotConfiguredError()
  }

  return stripe
}

function ignored(reason: SyncIgnoredReason, organizationId: string | null): SyncResult {
  return { outcome: "ignored", reason, organizationId }
}

/** Assinatura que representa a imobiliária: melhor status, depois a mais recente. */
function pickCurrentSubscription(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
  return (
    [...subscriptions].sort((a, b) => {
      const byStatus =
        (SUBSCRIPTION_PRIORITY[a.status] ?? 99) - (SUBSCRIPTION_PRIORITY[b.status] ?? 99)
      return byStatus !== 0 ? byStatus : b.created - a.created
    })[0] ?? null
  )
}

export type SubscriptionComposition = CoreSubscriptionComposition<Stripe.SubscriptionItem>

/**
 * Plano, usuários extras, pacotes de +10 imóveis e itens da assinatura,
 * reconhecidos pelas lookup keys do core (regra em @workspace/core/billing,
 * testada com um evento de exemplo). O `price` já vem completo em cada item.
 */
export function describeSubscriptionItems(
  subscription: Stripe.Subscription
): SubscriptionComposition {
  return describeItems(subscription.items.data)
}

/**
 * Converte a assinatura (itens por lookup_key) no payload do resumo: plano,
 * limites com usuários extras e pacotes somados, recursos e adicionais.
 */
function toSyncPayload(
  subscription: Stripe.Subscription,
  customerId: string
): BillingSyncPayload | null {
  const fields = subscriptionBillingFields(subscription.items.data)

  if (!fields) {
    return null
  }

  return {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    ...fields,
    // No billing flexível o portal agenda o cancelamento por cancel_at.
    cancel_at_period_end: subscription.cancel_at_period_end || subscription.cancel_at !== null,
  }
}

async function syncCustomerState(
  stripe: Stripe,
  customerId: string,
  organizationHints: Array<string | null | undefined>
): Promise<SyncResult> {
  let customer: Stripe.Customer | Stripe.DeletedCustomer

  try {
    customer = await stripe.customers.retrieve(customerId)
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return ignored("recurso_inexistente", null)
    }

    throw error
  }

  if (customer.deleted) {
    return ignored("customer_removido", null)
  }

  const candidates = [organizationIdFromMetadata(customer.metadata), ...organizationHints]
    .map(parseOrganizationId)
    .filter((value): value is string => value !== null)
  const organizationId = candidates[0] ?? null

  if (!organizationId) {
    return ignored("sem_organizacao", null)
  }

  if (candidates.some((candidate) => candidate !== organizationId)) {
    return ignored("organizacao_divergente", organizationId)
  }

  const account = await getBillingAccountIds(organizationId)

  if (!account) {
    return ignored("organizacao_inexistente", organizationId)
  }

  if (account.stripeCustomerId && account.stripeCustomerId !== customer.id) {
    return ignored("customer_divergente", organizationId)
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: customer.id,
    status: "all",
    limit: SUBSCRIPTION_LIST_LIMIT,
  })
  const current = pickCurrentSubscription(
    subscriptions.data.filter((subscription) => {
      const fromSubscription = organizationIdFromMetadata(subscription.metadata)
      return !fromSubscription || fromSubscription === organizationId
    })
  )

  let payload: BillingSyncPayload

  if (current) {
    const mapped = toSyncPayload(current, customer.id)

    if (!mapped) {
      return ignored("plano_desconhecido", organizationId)
    }

    payload = mapped
  } else {
    // Customer sem assinatura: só vincula, mantendo plano e status atuais.
    payload = {
      stripe_customer_id: customer.id,
      stripe_subscription_id: null,
      plan_key: null,
      status: null,
    }
  }

  try {
    await syncBillingAccount(organizationId, payload)
  } catch (error) {
    if (error instanceof BillingRpcError) {
      if (error.reason === "billing_customer_divergente") {
        return ignored("customer_divergente", organizationId)
      }

      if (error.code === "P0002" || error.code === "23503") {
        return ignored("organizacao_inexistente", organizationId)
      }
    }

    throw error
  }

  return {
    outcome: "synced",
    organizationId,
    subscriptionId: current?.id ?? null,
    subscriptionStatus: current?.status ?? null,
  }
}

/**
 * Relê a assinatura na API e sincroniza a imobiliária dona dela. A organização
 * vem de metadata.organization_id (assinatura e customer) e precisa bater com o
 * customer já vinculado no banco. Se houver mais de uma assinatura no customer,
 * grava a vigente (ex.: evento atrasado de uma assinatura antiga cancelada).
 */
export async function syncSubscriptionFromStripe(
  subscriptionId: string,
  hint: SyncHint = {}
): Promise<SyncResult> {
  const stripe = requireStripe()
  let subscription: Stripe.Subscription

  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return ignored("recurso_inexistente", parseOrganizationId(hint.organizationId))
    }

    throw error
  }

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id

  return syncCustomerState(stripe, customerId, [
    organizationIdFromMetadata(subscription.metadata),
    hint.organizationId,
  ])
}

/**
 * Sincroniza a partir do customer quando o evento não aponta uma assinatura
 * (ex.: Checkout concluído antes de a assinatura existir). Se o customer tiver
 * assinaturas, grava a vigente; senão só vincula o customer à imobiliária.
 */
export async function syncCustomerWithoutSubscription(
  customerId: string,
  hint: SyncHint = {}
): Promise<SyncResult> {
  return syncCustomerState(requireStripe(), customerId, [hint.organizationId])
}
