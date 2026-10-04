import "server-only"

import { cache } from "react"

import { isBillingPlanKey, type BillingState } from "@workspace/core/billing"

import { AiRpcError, fetchAiUsageOverview, isAiRecord, readAiInt, readAiString } from "@/lib/ai/rpc"
import type { AiUsageOverview } from "@/lib/ai/types"

export type { AiUsageOverview }

const BILLING_STATES: readonly string[] = ["trialing", "active", "grace", "read_only"]

const CONFIGURATION_WARNINGS: Record<string, string> = {
  PGRST202: "[ia] RPCs de IA ausentes no banco: consumo desativado até aplicar as migrações",
  "42883": "[ia] RPCs de IA ausentes no banco: consumo desativado até aplicar as migrações",
  not_configured: "[ia] Supabase não configurado: consumo de IA indisponível",
}

const warned = new Set<string>()

function logFailure(error: unknown) {
  const warning = error instanceof AiRpcError ? CONFIGURATION_WARNINGS[error.code ?? ""] : undefined

  if (warning) {
    if (!warned.has(warning)) {
      warned.add(warning)
      console.warn(warning)
    }

    return
  }

  console.error(
    `[ia] get_ai_usage_overview falhou (${error instanceof AiRpcError ? (error.code ?? "erro") : "erro"})`
  )
}

function toAiUsageOverview(raw: unknown, organizationId: string): AiUsageOverview | null {
  const row = Array.isArray(raw) ? raw[0] : raw

  if (!isAiRecord(row)) {
    return null
  }

  const periodStart = readAiString(row.period_start)
  const periodEnd = readAiString(row.period_end)
  const planKey = row.plan_key
  const billingState = readAiString(row.billing_state)

  if (!periodStart || !periodEnd || !isBillingPlanKey(planKey) || !billingState) {
    return null
  }

  return {
    organizationId,
    model: readAiString(row.model) ?? "—",
    periodStart,
    periodEnd,
    planKey,
    billingState: (BILLING_STATES.includes(billingState)
      ? billingState
      : "read_only") as BillingState,
    conversationsLimit: readAiInt(row.conversations_limit, -1),
    conversationsUsed: readAiInt(row.conversations_used),
    requests: readAiInt(row.requests),
    inputTokens: readAiInt(row.input_tokens),
    outputTokens: readAiInt(row.output_tokens),
    cacheReadTokens: readAiInt(row.cache_read_tokens),
    cacheWriteTokens: readAiInt(row.cache_write_tokens),
    costCents: readAiInt(row.cost_cents),
    planCapCents: readAiInt(row.plan_cap_cents),
    overageCapCents: readAiInt(row.overage_cap_cents),
    effectiveCapCents: readAiInt(row.effective_cap_cents),
    dayCostCents: readAiInt(row.day_cost_cents),
    dayCapCents: readAiInt(row.day_cap_cents),
    weekCostCents: readAiInt(row.week_cost_cents),
    weekCapCents: readAiInt(row.week_cap_cents),
    maxOverageCapCents: readAiInt(row.max_overage_cap_cents),
    notified80At: readAiString(row.notified_80_at),
    notified100At: readAiString(row.notified_100_at),
    updatedAt: readAiString(row.updated_at),
  }
}

/**
 * Consumo de IA do ciclo, lido com a sessão do usuário (RLS). Memoizado por
 * requisição. Em erro devolve null e registra só o código.
 */
export const getAiUsageOverview = cache(
  async (organizationId: string): Promise<AiUsageOverview | null> => {
    try {
      return toAiUsageOverview(await fetchAiUsageOverview(organizationId), organizationId)
    } catch (error) {
      logFailure(error)
      return null
    }
  }
)

/** Como loadBillingOverview: nenhuma tela quebra por causa do consumo de IA. */
export async function loadAiUsageOverview(organizationId: string): Promise<AiUsageOverview | null> {
  try {
    return await getAiUsageOverview(organizationId)
  } catch (error) {
    console.error(
      `[ia] falha ao carregar o consumo: ${error instanceof Error ? error.name : "erro desconhecido"}`
    )
    return null
  }
}
