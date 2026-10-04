import "server-only"

import type { CatalogPrices } from "@/components/billing/plan-content"
import {
  getBillingOverview,
  getCatalogPrices,
  getOwnedListingUsage,
  listRecentInvoices,
  type RecentInvoice,
} from "@/lib/billing/queries"

export type { RecentInvoice }

function logFailure(scope: string, error: unknown) {
  console.error(
    `[billing] falha ao carregar ${scope}:`,
    error instanceof Error ? error.name : "erro desconhecido"
  )
}

/**
 * Resumo da assinatura. getBillingOverview já é memoizado por requisição (layout,
 * banner, páginas e FeatureGate compartilham) e devolve null em erro; o catch
 * extra garante que nenhuma tela quebre. null = indisponível.
 */
export async function loadBillingOverview(organizationId: string) {
  try {
    return await getBillingOverview(organizationId)
  } catch (error) {
    logFailure("a assinatura", error)
    return null
  }
}

/** Imóveis com foto que contam no limite (contagem do banco); null = indisponível. */
export async function loadOwnedListingUsage(organizationId: string) {
  try {
    return await getOwnedListingUsage(organizationId)
  } catch (error) {
    logFailure("os imóveis com foto", error)
    return null
  }
}

/** Preços do catálogo (a lib já cai no core); com erro inesperado, {} (idem nos componentes). */
export async function loadCatalogPrices(): Promise<CatalogPrices> {
  try {
    return await getCatalogPrices()
  } catch (error) {
    logFailure("os preços", error)
    return {}
  }
}

export type InvoicesResult = { ok: true; invoices: RecentInvoice[] } | { ok: false }

export async function loadRecentInvoices(organizationId: string): Promise<InvoicesResult> {
  try {
    return { ok: true, invoices: await listRecentInvoices(organizationId) }
  } catch (error) {
    logFailure("as faturas", error)
    return { ok: false }
  }
}
