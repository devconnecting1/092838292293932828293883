import "server-only"

import {
  PLATFORM_AUDIT_REJECTION_MESSAGES,
  preparePlatformAuditEvent,
  type PlatformAuditInput,
} from "@workspace/core/platform/audit"
import type { Json } from "@workspace/database/types"

import {
  PlatformRpcError,
  throwPlatformRpcError,
  withPlatformRpc,
  type PlatformRpcResult,
} from "@/lib/plataforma/rpc"

/**
 * Registro do Console da Plataforma (`private.platform_audit_events`, só de
 * acréscimo).
 *
 * `logPlatformAction` é para toda ação do console que ALTERA algo e cuja
 * mudança não passa por uma RPC que já grave o registro na mesma transação
 * (ex.: chamada à Stripe). Quem agiu vem da sessão conferida
 * (`withPlatformRpc` → `getPlatformAdmin`), nunca do chamador. O antes/depois é
 * limpo em packages/core/src/platform/audit.ts (sem dado pessoal de cliente
 * final) e o banco recusa o que escapar.
 *
 * Uso numa Server Action (depois de `requirePlatformAdmin()` e da mudança):
 *
 *   const logged = await logPlatformAction({
 *     action: "organizacao.bloquear",
 *     target: { type: "organizacao", id: organizationId },
 *     organizationId,
 *     reason: form.reason,
 *     before: { bloqueada: false },
 *     after: { bloqueada: true },
 *   })
 *   if (!logged.ok) → avise na tela que a ação foi feita mas o registro falhou
 *
 * Nunca lança. Formato inválido volta `{ ok: false, reason: "dados_invalidos" }`
 * sem chamar o banco.
 */
export async function logPlatformAction(
  input: PlatformAuditInput
): Promise<PlatformRpcResult<{ id: number }>> {
  const operation = "platform_log_action"
  const prepared = preparePlatformAuditEvent(input)

  if (!prepared.ok) {
    console.error(`[plataforma] registro recusado antes do banco (${prepared.reason})`)
    return {
      ok: false,
      reason: "dados_invalidos",
      code: null,
      message: PLATFORM_AUDIT_REJECTION_MESSAGES[prepared.reason],
    }
  }

  const { payload } = prepared

  return withPlatformRpc(operation, async ({ supabase, serverKey, admin }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_actor_user_id: admin.id,
      p_actor_email: admin.email,
      p_action: payload.action,
      p_target_type: payload.targetType ?? undefined,
      p_target_id: payload.targetId ?? undefined,
      p_organization_id: payload.organizationId ?? undefined,
      p_reason: payload.reason ?? undefined,
      p_before: (payload.before as Json | null) ?? undefined,
      p_after: (payload.after as Json | null) ?? undefined,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (typeof data !== "number") {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return { id: data }
  })
}

export type PlatformAuditEvent = {
  id: number
  occurredAt: string
  actorUserId: string
  actorEmail: string
  action: string
  targetType: string | null
  targetId: string | null
  organizationId: string | null
  reason: string | null
  before: Json | null
  after: Json | null
}

export type PlatformAuditFilters = {
  /** 1 a 200; padrão 50. */
  limit?: number
  /** Paginação: devolve as linhas com id menor que este. */
  beforeId?: number
  organizationId?: string
  action?: string
}

/** Registro do console, do mais novo para o mais antigo (`platform_list_audit_events`). */
export async function listPlatformAuditEvents(
  filters: PlatformAuditFilters = {}
): Promise<PlatformRpcResult<PlatformAuditEvent[]>> {
  const operation = "platform_list_audit_events"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_limit: filters.limit,
      p_before_id: filters.beforeId,
      p_organization_id: filters.organizationId,
      p_action: filters.action,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor_email,
      action: row.action,
      targetType: row.target_type ?? null,
      targetId: row.target_id ?? null,
      organizationId: row.organization_id ?? null,
      reason: row.reason ?? null,
      before: row.before_data ?? null,
      after: row.after_data ?? null,
    }))
  })
}
