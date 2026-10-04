import "server-only"

import { createHash } from "node:crypto"
import { after } from "next/server"

import {
  AI_MAX_INPUT_TOKENS,
  AI_MAX_OUTPUT_TOKENS,
  isAiUsageKind,
  type AiUsageKind,
} from "@workspace/core/billing"

import { describeAiBlock, describeAiOverage } from "@/lib/ai/messages"
import { sendAiQuotaNotice } from "@/lib/ai/notifications"
import {
  isAiRecord,
  readAiInt,
  readAiString,
  reserveAiUsageRpc,
  settleAiUsageRpc,
  type SettleAiUsageInput,
} from "@/lib/ai/rpc"
import type { AiBlockContext, AiBlockReason } from "@/lib/ai/types"

/**
 * Medição e corte de IA. **Toda feature de IA chama `checkAiQuota` ANTES de
 * acionar o modelo e `settleAiUsage` depois, sempre — inclusive quando a
 * chamada falha ou o usuário cancela.**
 *
 * @example
 * ```ts
 * const quota = await checkAiQuota({ organizationId, userId, kind: "listing_copy",
 *   estimate: { inputTokens: 1500, outputTokens: 500 } })
 * if (!quota.allowed) return { ok: false, error: quota.message }
 * const answer = await chamarModelo()                       // o provedor entra depois
 * after(() => settleAiUsage(quota, { inputTokens: 1480, outputTokens: 512, status: "ok" }))
 * ```
 */

export type AiDenyReason = AiBlockReason | "unavailable"

export type AiQuotaDenied = {
  allowed: false
  reason: AiDenyReason
  /** Mensagem pronta em pt-BR: o que aconteceu, quando volta e qual é a saída. */
  message: string
}

export type AiQuotaCached = {
  allowed: true
  duplicate: true
  /** Resposta idêntica já dada na janela de deduplicação: não chame o modelo. */
  response: string
}

export type AiQuotaGranted = {
  allowed: true
  duplicate: false
  organizationId: string
  /** Passe para settleAiUsage depois da chamada. */
  reservationId: string
  /** A chamada está sendo paga pelo excedente autorizado. */
  inOverage: boolean
  /** Aviso a mostrar junto da resposta (excedente), ou null. */
  warning: string | null
  /** Tetos por chamada: corte o histórico para caber neles. */
  maxInputTokens: number
  maxOutputTokens: number
  conversationsRemaining: number | null
}

export type AiQuotaResult = AiQuotaDenied | AiQuotaCached | AiQuotaGranted

export type CheckAiQuotaInput = {
  organizationId: string
  kind: AiUsageKind
  /** Quantas unidades da franquia (padrão 1). Conversa com contato usa a janela de 24 h. */
  units?: number
  userId?: string | null
  /** Identificador do contato (telefone, e-mail, id do lead): vira hash antes de sair daqui. */
  contact?: string | null
  /** Conteúdo do pedido: vira hash e permite devolver a resposta anterior sem gastar. */
  dedupeKey?: string | null
  /** Estimativa de tokens da chamada; é o que fica reservado até o acerto. */
  estimate?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

const UNAVAILABLE_MESSAGE =
  "Não foi possível conferir o consumo de IA agora, então a chamada não foi feita. Tente de novo em instantes."

/** sha-256 em hexadecimal: o valor original (telefone, prompt) nunca vai ao banco. */
export function hashAiKey(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex")
}

function toBlockContext(row: Record<string, unknown>, reason: AiBlockReason): AiBlockContext {
  return {
    reason,
    periodEnd: readAiString(row.period_end),
    conversationsLimit: readAiInt(row.conversations_limit, -1),
    planCapCents: readAiInt(row.plan_cap_cents),
    overageCapCents: readAiInt(row.overage_cap_cents),
    effectiveCapCents: readAiInt(row.effective_cap_cents),
    dayCapCents: readAiInt(row.day_cap_cents),
    weekCapCents: readAiInt(row.week_cap_cents),
  }
}

const BLOCK_REASONS: readonly string[] = [
  "billing_blocked",
  "feature_unavailable",
  "request_too_large",
  "rate_limited_organization",
  "rate_limited_user",
  "daily_cost_cap",
  "weekly_cost_cap",
  "cycle_cost_cap",
  "quota_exhausted",
  "overage_cap",
]

function unavailable(): AiQuotaDenied {
  return { allowed: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE }
}

/** Dispara o aviso de 80%/100% que o banco reservou nesta chamada. Nunca lança. */
function dispatchNotice(organizationId: string, row: Record<string, unknown>) {
  const level = readAiString(row.notify)

  if (level !== "80" && level !== "100") {
    return
  }

  const payload = {
    organizationId,
    level,
    periodStart: readAiString(row.period_start) ?? "",
    periodEnd: readAiString(row.period_end),
    conversationsUsed: readAiInt(row.conversations_used),
    conversationsLimit: readAiInt(row.conversations_limit, -1),
    costCents: readAiInt(row.cost_cents),
    capCents: readAiInt(row.effective_cap_cents),
    overageCapCents: readAiInt(row.overage_cap_cents),
  } as const

  try {
    after(() => sendAiQuotaNotice(payload))
  } catch {
    // Fora do ciclo de uma requisição (cron, script): envia sem esperar.
    void sendAiQuotaNotice(payload)
  }
}

/**
 * Reserva o consumo antes da chamada ao modelo. Uma ida ao banco; devolve
 * permitido/negado com a mensagem pronta, ou a resposta anterior quando o
 * pedido é idêntico a um recente. Em qualquer falha, NEGA (nunca gastar sem
 * conseguir medir).
 */
export async function checkAiQuota(input: CheckAiQuotaInput): Promise<AiQuotaResult> {
  if (!isAiUsageKind(input.kind) || !input.organizationId) {
    return unavailable()
  }

  let data: unknown

  try {
    data = await reserveAiUsageRpc({
      organizationId: input.organizationId,
      kind: input.kind,
      units: input.units,
      userId: input.userId ?? null,
      contactKey: input.contact ? hashAiKey(input.contact) : null,
      digest: input.dedupeKey ? hashAiKey(input.dedupeKey) : null,
      inputTokens: input.estimate?.inputTokens,
      outputTokens: input.estimate?.outputTokens,
      cacheReadTokens: input.estimate?.cacheReadTokens,
      cacheWriteTokens: input.estimate?.cacheWriteTokens,
    })
  } catch (error) {
    console.error(
      `[ia] reserva de consumo falhou (${error instanceof Error ? error.name : "erro"})`
    )
    return unavailable()
  }

  if (!isAiRecord(data)) {
    console.error("[ia] reserve_ai_usage respondeu num formato inesperado")
    return unavailable()
  }

  dispatchNotice(input.organizationId, data)

  if (data.allowed !== true) {
    const reason = readAiString(data.reason)
    const blockReason: AiBlockReason =
      reason && BLOCK_REASONS.includes(reason) ? (reason as AiBlockReason) : "billing_blocked"

    return {
      allowed: false,
      reason: blockReason,
      message: describeAiBlock(toBlockContext(data, blockReason)),
    }
  }

  const cached = readAiString(data.response)

  if (data.duplicate === true && cached) {
    return { allowed: true, duplicate: true, response: cached }
  }

  const reservationId = readAiString(data.reservation_id)

  if (!reservationId) {
    console.error("[ia] reserve_ai_usage liberou sem devolver a reserva")
    return unavailable()
  }

  const inOverage = data.in_overage === true
  const limit = readAiInt(data.conversations_limit, -1)

  return {
    allowed: true,
    duplicate: false,
    organizationId: input.organizationId,
    reservationId,
    inOverage,
    warning: inOverage
      ? describeAiOverage({ overageCapCents: readAiInt(data.overage_cap_cents) })
      : null,
    maxInputTokens: AI_MAX_INPUT_TOKENS,
    maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    conversationsRemaining: limit < 0 ? null : readAiInt(data.conversations_remaining),
  }
}

export type SettleAiUsageUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** ok | failed | aborted. Tokens de tentativa falha ou cancelada também contam. */
  status?: SettleAiUsageInput["status"]
  /** Resposta curta guardada para deduplicar pedidos idênticos (só com status ok). */
  response?: string | null
}

/**
 * Acerta a reserva com o custo real depois da chamada. Feito para rodar em
 * `after()`: nunca lança. Se não for chamado, a estimativa continua cobrada
 * (erra a favor da margem, nunca contra).
 */
export async function settleAiUsage(
  granted: AiQuotaGranted,
  usage: SettleAiUsageUsage
): Promise<void> {
  try {
    const data = await settleAiUsageRpc({
      organizationId: granted.organizationId,
      reservationId: granted.reservationId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      status: usage.status ?? "ok",
      response: usage.response ?? null,
    })

    if (isAiRecord(data)) {
      dispatchNotice(granted.organizationId, data)
    }
  } catch (error) {
    console.error(`[ia] acerto de consumo falhou (${error instanceof Error ? error.name : "erro"})`)
  }
}
