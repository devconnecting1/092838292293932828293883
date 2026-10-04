import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"
import { createClient as createSessionClient } from "@/lib/supabase/server"

/**
 * Único ponto de chamada das RPCs de IA do Supabase.
 *
 * - Sem sessão, com a chave publishable + BILLING_SERVER_KEY (segredo
 *   `billing_server_key` do Vault): reserve_ai_usage e settle_ai_usage.
 *   Nunca service_role.
 * - Com sessão (RLS): get_ai_usage_overview e set_ai_overage_cap.
 *
 * As respostas são validadas antes de sair deste arquivo.
 */

export class AiRpcError extends Error {
  readonly code: string | null

  constructor(operation: string, code: string | null) {
    super(`${operation} falhou (${code ?? "sem código"})`)
    this.name = "AiRpcError"
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readAiString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export function readAiInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback
}

let warnedMissingServerKey = false

function readServerKey(): string | null {
  const value = process.env.BILLING_SERVER_KEY?.trim()

  if (!value) {
    if (!warnedMissingServerKey) {
      warnedMissingServerKey = true
      console.warn("[ia] BILLING_SERVER_KEY ausente: medição e corte de IA desativados")
    }

    return null
  }

  return value
}

function requireServerKeyClient(operation: string) {
  const env = getSupabaseEnv()
  const serverKey = readServerKey()

  if (!env || !serverKey) {
    throw new AiRpcError(operation, "not_configured")
  }

  const supabase = createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  return { supabase, serverKey }
}

export type ReserveAiUsageInput = {
  organizationId: string
  kind: string
  units?: number
  userId?: string | null
  /** Hash sha-256 do contato (janela de conversa). O telefone nunca sai daqui. */
  contactKey?: string | null
  /** Hash sha-256 do pedido (deduplicação). */
  digest?: string | null
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Resposta crua de reserve_ai_usage (validada em lib/ai/quota.ts). */
export async function reserveAiUsageRpc(input: ReserveAiUsageInput): Promise<unknown> {
  const operation = "reserve_ai_usage"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: input.organizationId,
    p_kind: input.kind,
    p_units: input.units ?? 1,
    p_user_id: input.userId ?? undefined,
    p_contact_key: input.contactKey ?? undefined,
    p_digest: input.digest ?? undefined,
    p_input_tokens: input.inputTokens ?? 0,
    p_output_tokens: input.outputTokens ?? 0,
    p_cache_read_tokens: input.cacheReadTokens ?? 0,
    p_cache_write_tokens: input.cacheWriteTokens ?? 0,
  })

  if (error) {
    throw new AiRpcError(operation, error.code || null)
  }

  return data
}

export type SettleAiUsageInput = {
  organizationId: string
  reservationId: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  status?: "ok" | "failed" | "aborted"
  /** Resposta curta guardada para a deduplicação (só quando status = ok). */
  response?: string | null
}

/** Resposta crua de settle_ai_usage (validada em lib/ai/quota.ts). */
export async function settleAiUsageRpc(input: SettleAiUsageInput): Promise<unknown> {
  const operation = "settle_ai_usage"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: input.organizationId,
    p_reservation_id: input.reservationId,
    p_input_tokens: input.inputTokens ?? 0,
    p_output_tokens: input.outputTokens ?? 0,
    p_cache_read_tokens: input.cacheReadTokens ?? 0,
    p_cache_write_tokens: input.cacheWriteTokens ?? 0,
    p_status: input.status ?? "ok",
    p_response: input.response ?? undefined,
  })

  if (error) {
    throw new AiRpcError(operation, error.code || null)
  }

  return data
}

/** Resposta crua de get_ai_usage_overview (validada em lib/ai/queries.ts). Usa a sessão. */
export async function fetchAiUsageOverview(organizationId: string): Promise<unknown> {
  const operation = "get_ai_usage_overview"
  const supabase = await createSessionClient()
  const { data, error } = await supabase.rpc(operation, { p_organization_id: organizationId })

  if (error) {
    throw new AiRpcError(operation, error.code || null)
  }

  return data
}

/** Grava o teto de excedente (dono ou gerente). Devolve o valor anterior. */
export async function setAiOverageCapRpc(
  organizationId: string,
  cents: number
): Promise<number | null> {
  const operation = "set_ai_overage_cap"
  const supabase = await createSessionClient()
  const { data, error } = await supabase.rpc(operation, {
    p_organization_id: organizationId,
    p_cents: cents,
  })

  if (error) {
    throw new AiRpcError(operation, error.code || null)
  }

  return typeof data === "number" ? data : null
}

export { isRecord as isAiRecord }
