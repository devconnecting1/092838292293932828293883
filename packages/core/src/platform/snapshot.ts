/**
 * Console da Plataforma — leitura da resposta de `platform_health` (jsonb).
 *
 * Cada parte é validada sozinha: parte ausente, null (o banco não conseguiu
 * calcular) ou em formato inesperado vira null e a tela mostra "indisponível",
 * sem derrubar as outras.
 */

import { z } from "zod"

import type { PlatformBillingCounts } from "./billing"
import type { DatabaseCronJob } from "./cron"
import { PLATFORM_QUEUE_KEYS, type PlatformQueueCounts, type PlatformQueueKey } from "./queues"

const count = z.number().int().nonnegative()
const timestamp = z.string().nullable().catch(null)

const cronJobSchema = z.object({
  name: z.string(),
  schedule: z.string(),
  active: z.boolean(),
  last_status: z.string().nullable().catch(null),
  last_started_at: timestamp,
  last_finished_at: timestamp,
  last_message: z.string().nullable().catch(null),
  runs_24h: count,
  failures_24h: count,
})

const queueSchema = z.object({
  pending: count,
  stale: count,
  failed: count,
  oldest_pending_at: timestamp,
  stale_after_minutes: z.number().int().nonnegative().nullable().catch(null),
  devices: count.optional(),
})

const countMap = z.record(z.string(), count)

const billingSchema = z.object({
  organizations: count,
  accounts: count,
  with_customer: count,
  with_subscription: count,
  by_status: countMap,
  by_state: countMap,
})

export type PlatformHealthSnapshot = {
  generatedAt: string | null
  cronJobs: DatabaseCronJob[] | null
  vaultSecrets: Record<string, boolean> | null
  queues: Partial<Record<PlatformQueueKey, PlatformQueueCounts>> | null
  billing: PlatformBillingCounts | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseCronJobs(value: unknown): DatabaseCronJob[] | null {
  const parsed = z.array(cronJobSchema).safeParse(value)

  if (!parsed.success) {
    return null
  }

  return parsed.data.map((job) => ({
    name: job.name,
    schedule: job.schedule,
    active: job.active,
    lastStatus: job.last_status,
    lastStartedAt: job.last_started_at,
    lastFinishedAt: job.last_finished_at,
    lastMessage: job.last_message,
    runs24h: job.runs_24h,
    failures24h: job.failures_24h,
  }))
}

function parseVault(value: unknown): Record<string, boolean> | null {
  const parsed = z.record(z.string(), z.boolean()).safeParse(value)
  return parsed.success ? parsed.data : null
}

function parseQueues(value: unknown): PlatformHealthSnapshot["queues"] {
  if (!isRecord(value)) {
    return null
  }

  const queues: Partial<Record<PlatformQueueKey, PlatformQueueCounts>> = {}

  for (const key of PLATFORM_QUEUE_KEYS) {
    const parsed = queueSchema.safeParse(value[key])

    if (parsed.success) {
      queues[key] = {
        pending: parsed.data.pending,
        stale: parsed.data.stale,
        failed: parsed.data.failed,
        oldestPendingAt: parsed.data.oldest_pending_at,
        staleAfterMinutes: parsed.data.stale_after_minutes,
        ...(parsed.data.devices === undefined ? {} : { devices: parsed.data.devices }),
      }
    }
  }

  return queues
}

function parseBilling(value: unknown): PlatformBillingCounts | null {
  const parsed = billingSchema.safeParse(value)

  if (!parsed.success) {
    return null
  }

  return {
    organizations: parsed.data.organizations,
    accounts: parsed.data.accounts,
    withCustomer: parsed.data.with_customer,
    withSubscription: parsed.data.with_subscription,
    byStatus: parsed.data.by_status,
    byState: parsed.data.by_state,
  }
}

/** Resposta de `platform_health` → retrato tipado (partes inválidas viram null). */
export function parsePlatformHealthSnapshot(data: unknown): PlatformHealthSnapshot {
  const record = isRecord(data) ? data : {}

  return {
    generatedAt: typeof record.generated_at === "string" ? record.generated_at : null,
    cronJobs: parseCronJobs(record.cron_jobs),
    vaultSecrets: parseVault(record.vault_secrets),
    queues: parseQueues(record.queues),
    billing: parseBilling(record.billing),
  }
}
