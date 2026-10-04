import "server-only"

import { createClient } from "@supabase/supabase-js"
import { z } from "zod"

import type { Database } from "@workspace/database/types"

import type { OrganizationDeletionNotice } from "@/lib/exclusao/email"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * RPCs sem sessão da exclusão de imobiliária: chave publishable (papel anon) +
 * ORGANIZATION_DELETION_SERVER_KEY (segredo organization_deletion_server_key do
 * Vault). Nunca service_role.
 *
 * Os arquivos do Storage de uma imobiliária já apagada saem assim: o banco
 * reserva um lote de caminhos por 10 minutos (claim_organization_storage_objects),
 * este cliente anon remove pela Storage API — as políticas "exclusão da
 * imobiliária: servidor ..." só liberam caminho reservado de imobiliária que
 * não existe mais — e settle_organization_storage_purge baixa a reserva.
 *
 * Nada aqui lança; logs só com códigos e contagens.
 */

type QueueClient = ReturnType<typeof createClient<Database>>

const BUCKETS = ["client-documents", "property-media", "property-documents", "landing-assets"]

/** Arquivos por chamada de remove. */
const REMOVE_BATCH = 100

const reminderSchema = z.object({
  organization_id: z.string(),
  organization_slug: z.string(),
  organization_name: z.string(),
  brand_color: z.string().nullable(),
  execute_after: z.string(),
  recipient_emails: z.array(z.string()).nullable(),
})

const settleSchema = z.object({ released: z.number(), finished: z.number() })

export type StoragePurgeSummary = {
  claimed: number
  removed: number
  failedBatches: number
  released: number
  finished: number
  error: boolean
}

function readContext(): { client: QueueClient; serverKey: string } | null {
  const serverKey = process.env.ORGANIZATION_DELETION_SERVER_KEY?.trim()

  if (!serverKey) {
    console.error("ORGANIZATION_DELETION_SERVER_KEY ausente")
    return null
  }

  const env = getSupabaseEnv()

  if (!env) {
    console.error("[exclusao] Supabase não configurado")
    return null
  }

  const client = createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  return { client, serverKey }
}

/** Exclusões que acontecem em até 3 dias e ainda não tiveram aviso. */
export async function listOrganizationDeletionReminders(
  limit: number
): Promise<OrganizationDeletionNotice[] | null> {
  const context = readContext()

  if (!context) {
    return null
  }

  const { data, error } = await context.client.rpc("list_organization_deletion_reminders", {
    p_server_key: context.serverKey,
    p_limit: limit,
  })

  if (error || !Array.isArray(data)) {
    console.error(
      `[exclusao] list_organization_deletion_reminders falhou (código ${error?.code || "resposta"})`
    )
    return null
  }

  return data.flatMap((row) => {
    const parsed = reminderSchema.safeParse(row)

    if (!parsed.success) {
      return []
    }

    return [
      {
        organizationId: parsed.data.organization_id,
        organizationSlug: parsed.data.organization_slug,
        organizationName: parsed.data.organization_name,
        brandColor: parsed.data.brand_color,
        executeAfter: parsed.data.execute_after,
        recipients: parsed.data.recipient_emails ?? [],
      },
    ]
  })
}

export async function markOrganizationDeletionReminded(organizationId: string): Promise<boolean> {
  const context = readContext()

  if (!context) {
    return false
  }

  const { data, error } = await context.client.rpc("mark_organization_deletion_reminded", {
    p_server_key: context.serverKey,
    p_organization_id: organizationId,
  })

  if (error) {
    console.error(
      `[exclusao] mark_organization_deletion_reminded falhou (código ${error.code || "vazio"})`
    )
    return false
  }

  return data === true
}

/**
 * Remove do Storage até `limit` arquivos de imobiliárias já apagadas (um lote
 * por execução do cron; o que sobrar sai na próxima).
 */
export async function purgeDeletedOrganizationsStorage(
  limit: number
): Promise<StoragePurgeSummary> {
  const summary: StoragePurgeSummary = {
    claimed: 0,
    removed: 0,
    failedBatches: 0,
    released: 0,
    finished: 0,
    error: false,
  }
  const context = readContext()

  if (!context) {
    summary.error = true
    return summary
  }

  const { data, error } = await context.client.rpc("claim_organization_storage_objects", {
    p_server_key: context.serverKey,
    p_limit: limit,
  })

  if (error || !Array.isArray(data)) {
    console.error(
      `[exclusao] claim_organization_storage_objects falhou (código ${error?.code || "resposta"})`
    )
    summary.error = true
    return summary
  }

  summary.claimed = data.length
  const byBucket = new Map<string, string[]>()

  for (const item of data) {
    if (!BUCKETS.includes(item.bucket_id) || !item.object_path) {
      continue
    }

    const paths = byBucket.get(item.bucket_id) ?? []
    paths.push(item.object_path)
    byBucket.set(item.bucket_id, paths)
  }

  for (const [bucket, paths] of byBucket) {
    for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
      const batch = paths.slice(start, start + REMOVE_BATCH)
      const { data: removed, error: removeError } = await context.client.storage
        .from(bucket)
        .remove(batch)

      if (removeError) {
        summary.failedBatches += 1
        console.error(`[exclusao] remoção no Storage falhou (${bucket}, ${batch.length} arquivos)`)
        continue
      }

      summary.removed += removed?.length ?? 0
    }
  }

  const settled = await context.client.rpc("settle_organization_storage_purge", {
    p_server_key: context.serverKey,
  })
  const parsed = settleSchema.safeParse(settled.data)

  if (settled.error || !parsed.success) {
    console.error(
      `[exclusao] settle_organization_storage_purge falhou (código ${settled.error?.code || "resposta"})`
    )
    summary.error = true
    return summary
  }

  summary.released = parsed.data.released
  summary.finished = parsed.data.finished
  return summary
}
