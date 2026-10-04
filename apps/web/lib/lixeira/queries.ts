import "server-only"

import { isTrashEntity, type TrashEntity } from "@/lib/lixeira/constants"
import { drainStoragePurgeQueue } from "@/lib/lixeira/storage"
import { createClient } from "@/lib/supabase/server"

export type TrashItem = {
  entity: TrashEntity
  id: string
  label: string
  code: string | null
  deletedAt: string
  deletedByName: string | null
  purgeAfter: string
  anonymizedAt: string | null
  identificationKeptUntil: string | null
  legalHolds: string[]
}

export type ErasureReceipt = {
  id: string
  entity: TrashEntity
  reason: string
  outcome: string
  legalHolds: string[]
  identificationKeptUntil: string | null
  executedBy: string | null
  executedByName: string | null
  executedAt: string
}

export type TrashPageData = {
  items: TrashItem[]
  receipts: ErasureReceipt[]
  loadError: boolean
}

/**
 * Lixeira da imobiliária (dono/gerente) e os últimos comprovantes de exclusão.
 * Antes de ler, remove do Storage os arquivos que a rotina diária deixou na
 * fila (a sessão de dono/gerente é quem tem permissão para isso).
 */
export async function getTrashPageData(organizationId: string): Promise<TrashPageData> {
  const supabase = await createClient()

  await drainStoragePurgeQueue(supabase, organizationId)

  const [trash, receipts] = await Promise.all([
    supabase.rpc("list_trash", { p_organization_id: organizationId }),
    supabase
      .from("data_erasure_receipts")
      .select(
        "id, entity, reason, outcome, legal_holds, identification_kept_until, executed_by, executed_at"
      )
      .eq("organization_id", organizationId)
      .order("executed_at", { ascending: false })
      .limit(50),
  ])

  const executorIds = [
    ...new Set((receipts.data ?? []).map((row) => row.executed_by).filter(Boolean)),
  ] as string[]

  const names = new Map<string, string>()
  if (executorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", executorIds)
    for (const profile of profiles ?? []) {
      if (profile.full_name) names.set(profile.id, profile.full_name)
    }
  }

  return {
    loadError: Boolean(trash.error || receipts.error),
    items: (trash.data ?? [])
      .filter((row) => isTrashEntity(row.entity))
      .map((row) => ({
        entity: row.entity as TrashEntity,
        id: row.record_id,
        label: row.label,
        code: row.code,
        deletedAt: row.deleted_at,
        deletedByName: row.deleted_by_name,
        purgeAfter: row.purge_after,
        anonymizedAt: row.anonymized_at,
        identificationKeptUntil: row.identification_kept_until,
        legalHolds: row.legal_holds ?? [],
      })),
    receipts: (receipts.data ?? [])
      .filter((row) => isTrashEntity(row.entity))
      .map((row) => ({
        id: row.id,
        entity: row.entity as TrashEntity,
        reason: row.reason,
        outcome: row.outcome,
        legalHolds: row.legal_holds ?? [],
        identificationKeptUntil: row.identification_kept_until,
        executedBy: row.executed_by,
        executedByName: row.executed_by ? (names.get(row.executed_by) ?? null) : null,
        executedAt: row.executed_at,
      })),
  }
}
