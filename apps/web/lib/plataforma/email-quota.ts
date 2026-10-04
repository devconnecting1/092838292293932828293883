import "server-only"

import type { EmailPriority, EmailQuotaUsage } from "@workspace/core/email/quota"

import { readEmailDailyLimit } from "@/lib/email/quota"
import {
  PlatformRpcError,
  throwPlatformRpcError,
  withPlatformRpc,
  type PlatformRpcResult,
} from "@/lib/plataforma/rpc"

/**
 * Cota de e-mail de hoje para a Saúde do sistema (`platform_email_quota`): uso
 * por classe de prioridade, avisos não enviados por tipo e motivo, imobiliárias
 * afetadas e os últimos 7 dias. Só contagens. Chame depois de
 * `requirePlatformAdmin()` (withPlatformRpc confere de novo).
 */

export type PlatformEmailQuota = {
  day: string
  dailyLimit: number
  byPriority: EmailQuotaUsage[]
  undeliveredByKind: { kind: string; reason: string; notices: number }[]
  undeliveredOrganizations: number
  lastDays: { day: string; sent: number; failed: number; denied: number }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isPriority(value: unknown): value is EmailPriority {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6
}

export function parsePlatformEmailQuota(data: unknown, dailyLimit: number): PlatformEmailQuota {
  if (!isRecord(data) || typeof data.day !== "string") {
    throw new PlatformRpcError("platform_email_quota", null, "dados_invalidos")
  }

  return {
    day: data.day,
    dailyLimit,
    byPriority: records(data.by_priority).flatMap((row) =>
      isPriority(row.priority)
        ? [
            {
              priority: row.priority,
              reserved: toCount(row.reserved),
              sent: toCount(row.sent),
              failed: toCount(row.failed),
              denied: toCount(row.denied),
            },
          ]
        : []
    ),
    undeliveredByKind: records(data.undelivered_by_kind).flatMap((row) =>
      typeof row.kind === "string" && typeof row.reason === "string"
        ? [{ kind: row.kind, reason: row.reason, notices: toCount(row.notices) }]
        : []
    ),
    undeliveredOrganizations: toCount(data.undelivered_organizations),
    lastDays: records(data.last_days).flatMap((row) =>
      typeof row.day === "string"
        ? [
            {
              day: row.day,
              sent: toCount(row.sent),
              failed: toCount(row.failed),
              denied: toCount(row.denied),
            },
          ]
        : []
    ),
  }
}

export async function getPlatformEmailQuota(): Promise<PlatformRpcResult<PlatformEmailQuota>> {
  const operation = "platform_email_quota"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, { p_server_key: serverKey })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    return parsePlatformEmailQuota(data, readEmailDailyLimit())
  })
}
