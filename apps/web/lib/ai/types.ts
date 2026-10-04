import type {
  AiBlockReason,
  AiUsageKind,
  BillingPlanKey,
  BillingState,
} from "@workspace/core/billing"

// Tipos compartilhados entre o servidor (lib/ai) e as telas. Puro, sem
// server-only: os componentes de cliente também importam.

/** Consumo de IA do ciclo, como a RPC get_ai_usage_overview devolve. */
export type AiUsageOverview = {
  organizationId: string
  /** Modelo em uso (o custo depende dele). */
  model: string
  periodStart: string
  periodEnd: string
  planKey: BillingPlanKey
  billingState: BillingState
  /** Franquia do ciclo: -1 = ilimitada, 0 = não inclusa. */
  conversationsLimit: number
  conversationsUsed: number
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costCents: number
  planCapCents: number
  overageCapCents: number
  effectiveCapCents: number
  dayCostCents: number
  dayCapCents: number
  weekCostCents: number
  weekCapCents: number
  /** Maior teto de excedente aceito pelo banco. */
  maxOverageCapCents: number
  notified80At: string | null
  notified100At: string | null
  updatedAt: string | null
}

/** O que a mensagem de bloqueio precisa saber para explicar o corte em pt-BR. */
export type AiBlockContext = {
  reason: AiBlockReason
  /** Quando a franquia vira (fim do ciclo de IA). */
  periodEnd: string | null
  conversationsLimit: number
  planCapCents: number
  overageCapCents: number
  effectiveCapCents: number
  dayCapCents: number
  weekCapCents: number
}

export type { AiBlockReason, AiUsageKind }
