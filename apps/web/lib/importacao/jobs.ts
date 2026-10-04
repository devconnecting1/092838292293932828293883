import "server-only"

import type { ImportKind } from "@workspace/core/import/fields"

import type { Role } from "@/lib/auth/roles"
import { IMPORT_ADMIN_ROLES, IMPORT_UNDO_DAYS } from "@/lib/importacao/constants"
import { createClient } from "@/lib/supabase/server"

/** Importações listadas na tela (a RLS já limita a assistente às próprias). */
const RECENT_DAYS = 30
const RECENT_LIMIT = 10

export type RecentImportJob = {
  id: string
  kind: ImportKind
  totalRows: number
  inserted: number
  updated: number
  skipped: number
  failed: number
  createdAt: string
  finishedAt: string | null
  undoneAt: string | null
  createdByName: string
  canUndo: boolean
  /** Links de foto ainda por baixar (só importação de imóveis). */
  pendingPhotos: number
}

export async function getRecentImportJobs(context: {
  organizationId: string
  userId: string
  role: Role
}): Promise<RecentImportJob[]> {
  const supabase = await createClient()
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString()
  const { data: jobs, error } = await supabase
    .from("import_jobs")
    .select(
      "id, kind, total_rows, inserted_count, updated_count, skipped_count, failed_count, created_by, created_at, finished_at, undone_at"
    )
    .eq("organization_id", context.organizationId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(RECENT_LIMIT)

  if (error || !jobs) {
    return []
  }

  const authorIds = [...new Set(jobs.map((job) => job.created_by).filter((id) => id !== null))]
  const { data: profiles } =
    authorIds.length > 0
      ? await supabase.from("profiles").select("id, full_name, email").in("id", authorIds)
      : { data: [] }
  const names = new Map(
    (profiles ?? []).map((profile) => [
      profile.id,
      profile.full_name?.trim() || profile.email || "Membro da equipe",
    ])
  )
  const undoSince = Date.now() - IMPORT_UNDO_DAYS * 86_400_000
  const isAdmin = IMPORT_ADMIN_ROLES.includes(context.role)

  return Promise.all(
    jobs.map(async (job) => {
      let pendingPhotos = 0

      if (job.kind === "properties" && !job.undone_at && job.finished_at) {
        const { data } = await supabase.rpc("import_photos_status", {
          p_organization_id: context.organizationId,
          p_job_id: job.id,
        })
        const pending = (data as { pending?: unknown } | null)?.pending
        pendingPhotos = typeof pending === "number" ? pending : 0
      }

      return {
        id: job.id,
        kind: job.kind,
        totalRows: job.total_rows,
        inserted: job.inserted_count,
        updated: job.updated_count,
        skipped: job.skipped_count,
        failed: job.failed_count,
        createdAt: job.created_at,
        finishedAt: job.finished_at,
        undoneAt: job.undone_at,
        createdByName: (job.created_by && names.get(job.created_by)) || "Membro da equipe",
        canUndo:
          !job.undone_at &&
          Date.parse(job.finished_at ?? job.created_at) >= undoSince &&
          (isAdmin || job.created_by === context.userId),
        pendingPhotos,
      }
    })
  )
}
