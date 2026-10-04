// Leitura dos itens de uma assinatura da Stripe pelas lookup keys do catálogo:
// plano, usuários extras e pacotes do adicional "+10 imóveis". Puro e sem o SDK
// da Stripe (tipo estrutural): o webhook e as ações de troca de plano usam, e os
// testes rodam com um evento de exemplo.

import { FEATURE_KEYS, planHasFeature, type FeatureKey } from "./features"
import { computeLimits, type LimitKey } from "./limits"
import {
  clampOwnedListingPacks,
  OWNED_LISTINGS_ADDON_KEY,
  parseAddonLookupKey,
  parseLookupKey,
  type BillingInterval,
  type PlanKey,
} from "./plans"

/** O mínimo de um item de assinatura da Stripe que a leitura precisa. */
export type SubscriptionItemLike = {
  quantity?: number | null
  current_period_end: number
  price: { lookup_key: string | null }
}

export type SubscriptionComposition<T extends SubscriptionItemLike = SubscriptionItemLike> = {
  plan: { key: PlanKey; interval: BillingInterval; item: T } | null
  seatItems: T[]
  extraSeats: number
  /** Itens do adicional de imóveis (o esperado é um só, com quantidade). */
  ownedListingItems: T[]
  ownedListingPacks: number
  /** Maior fim de período entre os itens (unix, segundos); 0 sem itens. */
  periodEnd: number
}

function quantityOf(item: SubscriptionItemLike) {
  const quantity = item.quantity ?? 0
  return Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0
}

/**
 * Plano, usuários extras e pacotes de imóveis, reconhecidos pelas lookup keys
 * do core. Itens com outra lookup key são ignorados (não mudam os limites).
 */
export function describeSubscriptionItems<T extends SubscriptionItemLike>(
  items: readonly T[]
): SubscriptionComposition<T> {
  const composition: SubscriptionComposition<T> = {
    plan: null,
    seatItems: [],
    extraSeats: 0,
    ownedListingItems: [],
    ownedListingPacks: 0,
    periodEnd: 0,
  }

  for (const item of items) {
    composition.periodEnd = Math.max(composition.periodEnd, item.current_period_end)

    const lookupKey = item.price.lookup_key

    if (!lookupKey) {
      continue
    }

    const parsed = parseLookupKey(lookupKey)

    if (parsed?.kind === "plan") {
      composition.plan = { key: parsed.plan, interval: parsed.interval, item }
    } else if (parsed?.kind === "seat") {
      composition.seatItems.push(item)
      composition.extraSeats += quantityOf(item)
    } else if (parseAddonLookupKey(lookupKey)?.addon === OWNED_LISTINGS_ADDON_KEY) {
      composition.ownedListingItems.push(item)
      composition.ownedListingPacks += quantityOf(item)
    }
  }

  return composition
}

/** Campos do resumo de billing (sync_billing_account) que a assinatura determina. */
export type SubscriptionBillingFields = {
  plan_key: PlanKey
  billing_interval: BillingInterval
  seats: number
  owned_listing_packs: number
  addon_keys: string[]
  limits: Record<LimitKey, number>
  features: FeatureKey[]
  current_period_end: string | null
}

/**
 * Plano, limites (com usuários extras e pacotes somados), recursos e adicionais
 * contratados a partir dos itens da assinatura. null sem item de plano reconhecido.
 */
export function subscriptionBillingFields(
  items: readonly SubscriptionItemLike[]
): SubscriptionBillingFields | null {
  const { plan, extraSeats, ownedListingPacks, periodEnd } = describeSubscriptionItems(items)

  if (!plan) {
    return null
  }

  // O teto do app vale também para quantidade alterada direto na Stripe.
  const packs = clampOwnedListingPacks(ownedListingPacks)
  const limits = computeLimits(plan.key, extraSeats, packs)

  return {
    plan_key: plan.key,
    billing_interval: plan.interval,
    seats: limits.users,
    owned_listing_packs: packs,
    addon_keys: packs > 0 ? [OWNED_LISTINGS_ADDON_KEY] : [],
    limits,
    features: FEATURE_KEYS.filter((feature) => planHasFeature(plan.key, feature)),
    current_period_end: periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : null,
  }
}
