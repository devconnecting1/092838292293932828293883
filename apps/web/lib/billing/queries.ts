import "server-only"

import { unstable_cache } from "next/cache"
import { cache } from "react"

import {
  addonLookupKey,
  diffCatalogPrice,
  FEATURES,
  formatCatalogPriceDivergenceWarning,
  OWNED_LISTINGS_ADDON_KEY,
  OWNED_LISTINGS_PACK_PRICE,
  PLANS,
  priceLookupKey,
  resolveBillingState,
  seatLookupKey,
  TRIAL_LIMITS,
  type BillingInterval,
  type BillingPlanKey,
  type BillingState,
  type FeatureKey,
  type LimitKey,
  type PlanKey,
} from "@workspace/core/billing"

import { hasRole, ORGANIZATION_VIEWER_ROLES } from "@/lib/auth/roles"
import { getOrganizationContext } from "@/lib/auth/session"
import { describeBillingError } from "@/lib/billing/errors"
import {
  BillingRpcError,
  fetchBillingOverview,
  fetchOwnedListingUsage,
  getBillingAccountIds,
} from "@/lib/billing/rpc"
import { getStripe, getStripeMode, isStripeConfigured } from "@/lib/billing/stripe"

export { isStripeConfigured }

export type BillingOverview = {
  organizationId: string
  state: BillingState
  status: string
  planKey: BillingPlanKey
  interval: BillingInterval | null
  seats: number
  /** Pacotes do adicional "+10 imóveis" contratados (já somados em limits.owned_listings). */
  ownedListingPacks: number
  addonKeys: string[]
  limits: Partial<Record<LimitKey, number>>
  features: FeatureKey[]
  usage: { users: number; landingPages: number; activeProperties: number }
  trialEndsAt: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  hasSubscription: boolean
  /** Bloqueada pela equipe da plataforma (Console): estado vem como read_only. */
  platformBlocked: boolean
  syncedAt: string | null
}

export type RecentInvoice = {
  id: string
  number: string | null
  createdAt: string
  amountCents: number
  status: string
  hostedUrl: string | null
  pdfUrl: string | null
}

const BILLING_STATES: readonly string[] = ["trialing", "active", "grace", "read_only"]
const BILLING_INTERVALS: readonly BillingInterval[] = ["month", "year"]
const LIMIT_KEYS = Object.keys(TRIAL_LIMITS) as LimitKey[]
const PLAN_KEYS = Object.keys(PLANS) as PlanKey[]
const INVOICE_LIMIT = 12
/** A Stripe aceita no máximo 10 lookup_keys por chamada de prices.list. */
const LOOKUP_KEYS_PER_REQUEST = 10
const CATALOG_REVALIDATE_SECONDS = 60 * 60
/** Tag do cache do catálogo: o webhook da Stripe invalida por ela nos eventos de preço e produto. */
export const BILLING_CATALOG_CACHE_TAG = "billing-catalog"

const MISSING_FUNCTIONS_WARNING =
  "[billing] funções de billing ausentes no banco: resumo e faturas desativados até aplicar as migrações"

/** Configuração incompleta (esperada em dev): aviso único por motivo, não erro. */
const CONFIGURATION_WARNINGS: Record<string, string> = {
  PGRST202: MISSING_FUNCTIONS_WARNING,
  "42883": MISSING_FUNCTIONS_WARNING,
  not_configured:
    "[billing] Supabase ou BILLING_SERVER_KEY ausente: faturas e sincronização desativadas (veja .env.example)",
}

const warnedConfiguration = new Set<string>()

/**
 * Log sem dados pessoais. Configuração incompleta vira um único console.warn
 * por motivo e por processo (em dev, console.error abre o overlay a cada
 * página); falhas reais seguem em console.error.
 */
function logQueryFailure(operation: string, error: unknown) {
  const warning =
    error instanceof BillingRpcError ? CONFIGURATION_WARNINGS[error.code ?? ""] : undefined

  if (warning) {
    if (!warnedConfiguration.has(warning)) {
      warnedConfiguration.add(warning)
      console.warn(warning)
    }

    return
  }

  console.error(`[billing] ${operation} falhou (${describeBillingError(error)})`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0
}

function isBillingPlanKey(value: unknown): value is BillingPlanKey {
  return value === "trial" || (typeof value === "string" && Object.hasOwn(PLANS, value))
}

function isBillingState(value: unknown): value is BillingState {
  return typeof value === "string" && BILLING_STATES.includes(value)
}

function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value)
}

function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && Object.hasOwn(FEATURES, value)
}

/** Valida e converte o jsonb snake_case de get_billing_overview. */
function toBillingOverview(raw: unknown, organizationId: string): BillingOverview | null {
  const row = Array.isArray(raw) ? raw[0] : raw

  if (!isRecord(row)) {
    return null
  }

  const planKey = row.plan_key
  const status = readString(row.status)
  const trialEndsAt = readString(row.trial_ends_at)

  if (!isBillingPlanKey(planKey) || !status || !trialEndsAt) {
    return null
  }

  const currentPeriodEnd = readString(row.current_period_end)
  const limits: Partial<Record<LimitKey, number>> = {}

  if (isRecord(row.limits)) {
    for (const key of LIMIT_KEYS) {
      const value = row.limits[key]

      if (typeof value === "number" && Number.isFinite(value)) {
        limits[key] = value
      }
    }
  }

  const usage = isRecord(row.usage) ? row.usage : {}

  return {
    organizationId,
    // O estado vem do banco (mesma regra do SQL); o core só cobre resposta antiga.
    state: isBillingState(row.state)
      ? row.state
      : resolveBillingState({ status, trialEndsAt, currentPeriodEnd, planKey }),
    status,
    planKey,
    interval: isBillingInterval(row.billing_interval) ? row.billing_interval : null,
    seats: readCount(row.seats),
    ownedListingPacks: readCount(row.owned_listing_packs),
    addonKeys: Array.isArray(row.addon_keys)
      ? row.addon_keys.filter((key): key is string => typeof key === "string")
      : [],
    limits,
    features: Array.isArray(row.features) ? row.features.filter(isFeatureKey) : [],
    usage: {
      users: readCount(usage.users),
      landingPages: readCount(usage.landing_pages),
      activeProperties: readCount(usage.active_properties),
    },
    trialEndsAt,
    currentPeriodEnd,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    hasSubscription:
      typeof row.has_subscription === "boolean" ? row.has_subscription : planKey !== "trial",
    platformBlocked: row.platform_blocked === true,
    syncedAt: readString(row.synced_at),
  }
}

/**
 * Resumo da assinatura (estado, limites, uso e recursos) lido com a sessão do
 * usuário (RLS). Memoizado por requisição: a casca e a página chamam juntas.
 * Em erro devolve null e registra só o código.
 */
export const getBillingOverview = cache(
  async (organizationId: string): Promise<BillingOverview | null> => {
    try {
      const overview = toBillingOverview(await fetchBillingOverview(organizationId), organizationId)

      if (!overview) {
        console.error("[billing] get_billing_overview respondeu num formato inesperado")
      }

      return overview
    } catch (error) {
      logQueryFailure("get_billing_overview", error)
      return null
    }
  }
)

/**
 * Imóveis com foto que contam no limite do plano, para o medidor da assinatura.
 * A contagem é a do banco (a mesma do gatilho que barra a foto), nunca refeita
 * aqui. Memoizado por requisição; em erro devolve null e registra só o código.
 */
export const getOwnedListingUsage = cache(
  async (organizationId: string): Promise<number | null> => {
    try {
      const data = await fetchOwnedListingUsage(organizationId)

      if (typeof data === "number" && Number.isInteger(data) && data >= 0) {
        return data
      }

      console.error("[billing] get_owned_listing_usage respondeu num formato inesperado")
      return null
    } catch (error) {
      logQueryFailure("get_owned_listing_usage", error)
      return null
    }
  }
)

/**
 * Últimas faturas lidas ao vivo na Stripe (nada é persistido). Só para quem
 * pode ver a assinatura da imobiliária atual; vazio sem Stripe, sem customer
 * ou em erro.
 */
export const listRecentInvoices = cache(
  async (organizationId: string): Promise<RecentInvoice[]> => {
    const stripe = getStripe()

    if (!stripe) {
      return []
    }

    const context = await getOrganizationContext()
    const membership = context?.membership

    if (
      !membership ||
      membership.organizationId !== organizationId ||
      !hasRole(membership.role, ORGANIZATION_VIEWER_ROLES)
    ) {
      return []
    }

    try {
      const account = await getBillingAccountIds(organizationId)

      if (!account?.stripeCustomerId) {
        return []
      }

      const invoices = await stripe.invoices.list({
        customer: account.stripeCustomerId,
        limit: INVOICE_LIMIT,
      })

      return invoices.data.flatMap((invoice) => {
        if (!invoice.id || invoice.status === "draft") {
          return []
        }

        return [
          {
            id: invoice.id,
            number: invoice.number,
            createdAt: new Date(invoice.created * 1000).toISOString(),
            amountCents: invoice.total,
            status: invoice.status ?? "open",
            hostedUrl: invoice.hosted_invoice_url ?? null,
            pdfUrl: invoice.invoice_pdf ?? null,
          },
        ]
      })
    } catch (error) {
      logQueryFailure("listagem de faturas", error)
      return []
    }
  }
)

const INTERVAL_KEYS: readonly BillingInterval[] = ["month", "year"]

const CATALOG_LOOKUP_KEYS = [
  ...PLAN_KEYS.flatMap((plan) =>
    INTERVAL_KEYS.flatMap((interval) => [
      priceLookupKey(plan, interval),
      seatLookupKey(plan, interval),
    ])
  ),
  ...INTERVAL_KEYS.map((interval) => addonLookupKey(OWNED_LISTINGS_ADDON_KEY, interval)),
]

/** Preços do core (centavos) por lookup_key: fallback sem Stripe ou em erro. */
function getFallbackCatalogPrices(): Record<string, number> {
  const prices: Record<string, number> = {}

  for (const plan of PLAN_KEYS) {
    for (const interval of INTERVAL_KEYS) {
      prices[priceLookupKey(plan, interval)] = PLANS[plan].prices[interval]
      prices[seatLookupKey(plan, interval)] = PLANS[plan].seatPrice[interval]
    }
  }

  for (const interval of INTERVAL_KEYS) {
    prices[addonLookupKey(OWNED_LISTINGS_ADDON_KEY, interval)] = OWNED_LISTINGS_PACK_PRICE[interval]
  }

  return prices
}

/**
 * Preços ativos em BRL na Stripe, com cache de 1 h compartilhado entre
 * requisições. O modo (test/live) entra na chave do cache; a chave secreta não.
 * Erros não são guardados no cache (a função lança e quem chama cai no fallback).
 */
const fetchStripeCatalogPrices = unstable_cache(
  async (mode: "test" | "live"): Promise<Record<string, number>> => {
    const stripe = getStripe()

    if (!stripe) {
      throw new Error(`Stripe não configurada (${mode})`)
    }

    const prices: Record<string, number> = {}

    for (let index = 0; index < CATALOG_LOOKUP_KEYS.length; index += LOOKUP_KEYS_PER_REQUEST) {
      const list = await stripe.prices.list({
        lookup_keys: CATALOG_LOOKUP_KEYS.slice(index, index + LOOKUP_KEYS_PER_REQUEST),
        active: true,
        limit: 100,
      })

      for (const price of list.data) {
        if (price.lookup_key && price.currency === "brl" && typeof price.unit_amount === "number") {
          prices[price.lookup_key] = price.unit_amount
        }
      }
    }

    return prices
  },
  ["billing-catalog-prices"],
  { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [BILLING_CATALOG_CACHE_TAG] }
)

/**
 * Avisa (console.warn, sem dado pessoal) quando o preço ativo na Stripe
 * diverge do catálogo do core para o mesmo lookup_key — só id do plano/
 * intervalo e os dois valores em centavos. Não muda o preço exibido: a
 * Stripe continua com prioridade (fica só no `{ ...fallback, ...stripe }`
 * de `getCatalogPrices`).
 */
function warnCatalogPriceDivergences(
  corePrices: Record<string, number>,
  stripePrices: Record<string, number>
) {
  for (const [lookupKey, stripeCents] of Object.entries(stripePrices)) {
    const coreCents = corePrices[lookupKey]

    if (coreCents === undefined) {
      continue
    }

    const divergence = diffCatalogPrice(lookupKey, coreCents, stripeCents)

    if (divergence) {
      console.warn(formatCatalogPriceDivergenceWarning(divergence))
    }
  }
}

/** Preço em centavos por lookup_key: Stripe quando houver, senão o catálogo do core. */
export async function getCatalogPrices(): Promise<Record<string, number>> {
  const fallback = getFallbackCatalogPrices()
  const mode = getStripeMode()

  if (!mode) {
    return fallback
  }

  try {
    const stripePrices = await fetchStripeCatalogPrices(mode)
    warnCatalogPriceDivergences(fallback, stripePrices)
    return { ...fallback, ...stripePrices }
  } catch (error) {
    console.error(`[billing] leitura dos preços na Stripe falhou (${describeBillingError(error)})`)
    return fallback
  }
}
