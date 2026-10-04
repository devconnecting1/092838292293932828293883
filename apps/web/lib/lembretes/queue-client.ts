import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { isUuid } from "@workspace/core/email/sanitize"
import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Cliente sem sessão das filas de lembretes (resumo diário, lembrete de visita e
 * relatório semanal). A autorização é a NOTIFICATION_SERVER_KEY (segredo
 * notification_server_key do Vault) conferida dentro de cada RPC. Nunca
 * service_role. Logs só com escopo e código de erro.
 */

export type QueueSettlement = { sent: number; failed: number; released: number }

export const EMPTY_SETTLEMENT: QueueSettlement = { sent: 0, failed: 0, released: 0 }

export type QueueContext = {
  serverKey: string
  supabase: SupabaseClient<Database>
}

export function getQueueContext(scope: string): QueueContext | null {
  const serverKey = process.env.NOTIFICATION_SERVER_KEY?.trim()

  if (!serverKey) {
    console.error("NOTIFICATION_SERVER_KEY ausente")
    return null
  }

  const env = getSupabaseEnv()

  if (!env) {
    console.error(`[${scope}] Supabase não configurado`)
    return null
  }

  return {
    serverKey,
    supabase: createClient<Database>(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  }
}

export function logRpcError(scope: string, rpc: string, error: { code?: string } | null) {
  console.error(`[${scope}] ${rpc} falhou (código ${error?.code || "desconhecido"})`)
}

export function logRpcException(scope: string, rpc: string, cause: unknown) {
  console.error(`[${scope}] ${rpc} falhou (${cause instanceof Error ? cause.name : "erro"})`)
}

export function clampLimit(limit: number, max: number) {
  return Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), max) : 1
}

/** Ids válidos, sem repetição e sem os já usados em outra lista do settle. */
export function uniqueIds(ids: readonly string[], exclude: ReadonlySet<string>) {
  return [...new Set(ids.filter((id) => isUuid(id) && !exclude.has(id)))]
}

function toCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function readSettlement(data: unknown): QueueSettlement {
  if (typeof data !== "object" || data === null) {
    return EMPTY_SETTLEMENT
  }

  const record = data as Record<string, unknown>

  return {
    sent: toCount(record.sent),
    failed: toCount(record.failed),
    released: toCount(record.released),
  }
}

/** Separa as listas do settle (um id só entra na primeira em que aparece). */
export function splitSettlement(input: {
  sent: readonly string[]
  failed: readonly string[]
  released: readonly string[]
}) {
  const sent = uniqueIds(input.sent, new Set())
  const failed = uniqueIds(input.failed, new Set(sent))
  const released = uniqueIds(input.released, new Set([...sent, ...failed]))

  return { sent, failed, released, empty: sent.length + failed.length + released.length === 0 }
}
