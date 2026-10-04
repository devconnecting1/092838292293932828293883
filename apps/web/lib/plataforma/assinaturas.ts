import "server-only"

import { detectStripeKeyMode, type StripeKeyMode } from "@workspace/core/platform/env"
import {
  computeRevenueSummary,
  type RevenueAccount,
  type RevenueSummary,
} from "@workspace/core/platform/revenue"

import {
  PlatformRpcError,
  throwPlatformRpcError,
  withPlatformRpc,
  type PlatformRpcResult,
} from "@/lib/plataforma/rpc"

/**
 * Módulo "Assinaturas e receita" do Console da Plataforma. Só leitura.
 *
 * A Stripe é a fonte da verdade e sincroniza billing_accounts (webhook e
 * rotina); aqui lemos essa tabela por `platform_list_revenue_accounts` e os
 * cálculos (MRR, ticket médio, contagens) ficam em
 * packages/core/src/platform/revenue.ts. O modo da Stripe (teste ou produção)
 * sai do prefixo de STRIPE_SECRET_KEY, sem mostrar a chave.
 */

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function toRevenueAccount(raw: unknown): RevenueAccount | null {
  if (!isRecord(raw)) {
    return null
  }

  const organizationId = text(raw.organization_id)
  const name = text(raw.name)
  const slug = text(raw.slug)
  const planKey = text(raw.plan_key)
  const status = text(raw.status)

  if (!organizationId || !name || !slug || !planKey || !status) {
    return null
  }

  return {
    organizationId,
    name,
    slug,
    planKey,
    interval: text(raw.billing_interval),
    status,
    seats: typeof raw.seats === "number" && Number.isFinite(raw.seats) ? raw.seats : 1,
    planNetMonthlyCents:
      typeof raw.plan_net_monthly_cents === "number" && Number.isFinite(raw.plan_net_monthly_cents)
        ? raw.plan_net_monthly_cents
        : null,
    trialEndsAt: text(raw.trial_ends_at),
    currentPeriodEnd: text(raw.current_period_end),
    cancelAtPeriodEnd: raw.cancel_at_period_end === true,
    firstPaidAt: text(raw.first_paid_at),
    canceledAt: text(raw.canceled_at),
    blockedAt: text(raw.platform_blocked_at),
    hasSubscription: raw.has_subscription === true,
  }
}

export type PlatformRevenueReport = {
  generatedAt: Date
  summary: RevenueSummary
  /** Data mais recente de sincronização com a Stripe entre as contas. */
  lastSyncedAt: string | null
}

/** Números da tela Assinaturas e receita. Chame depois de `requirePlatformAdmin()`. */
export async function loadPlatformRevenue(): Promise<PlatformRpcResult<PlatformRevenueReport>> {
  const operation = "platform_list_revenue_accounts"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, { p_server_key: serverKey })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (!Array.isArray(data)) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    const rows = data as unknown[]
    const accounts = rows.flatMap((row) => {
      const account = toRevenueAccount(row)
      return account ? [account] : []
    })
    const lastSyncedAt = rows.reduce<string | null>((latest, row) => {
      const syncedAt = isRecord(row) ? text(row.synced_at) : null
      return syncedAt && (!latest || Date.parse(syncedAt) > Date.parse(latest)) ? syncedAt : latest
    }, null)
    const generatedAt = new Date()

    return { generatedAt, summary: computeRevenueSummary(accounts, generatedAt), lastSyncedAt }
  })
}

/** Modo da Stripe pelo prefixo de STRIPE_SECRET_KEY (null = não configurada). */
export function readStripeMode(): StripeKeyMode | null {
  return detectStripeKeyMode(process.env.STRIPE_SECRET_KEY)
}
