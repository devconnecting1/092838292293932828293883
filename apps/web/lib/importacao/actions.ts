"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { IMPORT_DUPLICATE_MODES, IMPORT_KINDS } from "@workspace/core/import/fields"
import { IMPORT_MAX_OWNERS } from "@workspace/core/import/owners"
import { IMPORT_MAX_PHOTO_LINKS } from "@workspace/core/import/photo-links"
import {
  IMPORT_BATCH_ROWS,
  IMPORT_LOOKUP_ROWS,
  IMPORT_MAX_ROWS,
  type ImportPhotoFailure,
  type ImportRowOutcome,
} from "@workspace/core/import/report"

import type { ActionResultWithData } from "@/lib/clientes/action-result"
import { getActionMembership } from "@/lib/configuracoes/action-context"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import {
  IMPORT_LEGAL_BASIS_VALUES,
  IMPORT_LIST_PATHS,
  IMPORT_PHOTO_BATCH,
  IMPORT_ROLES,
  IMPORT_SETTINGS_PATH,
  IMPORT_UNDO_CHUNK,
} from "@/lib/importacao/constants"
import { downloadPhoto } from "@/lib/importacao/photo-download"
import { optimizeImportedPhoto } from "@/lib/importacao/photo-optimize"
import { PROPERTY_MEDIA_BUCKET } from "@/lib/imoveis/constants"
import { refreshImobScore } from "@/lib/imoveis/server-context"
import { propertyPhotoObjectPaths, thumbPathFor } from "@/lib/media/paths"
import { createClient } from "@/lib/supabase/server"

/**
 * Server Actions da importação. Cada uma confere o papel (dono, gerente ou
 * assistente),
 * pega a imobiliária da sessão (nunca do navegador) e chama a RPC com o
 * cliente Supabase da sessão: RLS e as checagens do banco valem sempre.
 * Nada aqui registra o conteúdo das linhas em log.
 */

const INVALID_REQUEST =
  "Não foi possível ler os dados enviados. Recarregue a página e tente de novo."

const ownerSchema = z.object({
  name: z.string().min(1).max(200),
  document: z.string().max(20).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().max(254).optional(),
  share_percent: z.number().min(0.01).max(100).optional(),
})

const payloadValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(2_000)).max(Math.max(50, IMPORT_MAX_PHOTO_LINKS)),
  z.array(ownerSchema).max(IMPORT_MAX_OWNERS),
])

const payloadSchema = z
  .object({ row: z.number().int().min(1).max(1_000_000) })
  .catchall(payloadValueSchema)

const kindSchema = z.enum(IMPORT_KINDS)

const findExistingSchema = z.object({
  kind: kindSchema,
  rows: z.array(payloadSchema).max(IMPORT_LOOKUP_ROWS),
})

const startSchema = z.object({
  jobId: z.guid(),
  kind: kindSchema,
  duplicateMode: z.enum(IMPORT_DUPLICATE_MODES),
  totalRows: z.number().int().min(1).max(IMPORT_MAX_ROWS),
  legalBasis: z.enum(IMPORT_LEGAL_BASIS_VALUES).nullable(),
  tag: z.string().trim().max(40).nullable(),
})

const batchSchema = z.object({
  jobId: z.guid(),
  batchIndex: z.number().int().min(0).max(4_999),
  rows: z.array(payloadSchema).min(1).max(IMPORT_BATCH_ROWS),
})

const finishSchema = z.object({
  jobId: z.guid(),
  invalidRows: z.number().int().min(0).max(IMPORT_MAX_ROWS),
  fileDuplicates: z.number().int().min(0).max(IMPORT_MAX_ROWS),
})

const outcomeSchema = z.object({
  row: z.number().int(),
  status: z.enum(["inserted", "updated", "skipped", "failed"]),
  code: z.string().optional(),
})

const batchResultSchema = z.object({
  replayed: z.boolean(),
  results: z.array(outcomeSchema),
})

const finishResultSchema = z.object({
  inserted: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
})

export type ImportBatchResult = { replayed: boolean; outcomes: ImportRowOutcome[] }

export type ImportJobTotals = z.infer<typeof finishResultSchema>

/** Linhas (números da planilha) que já existem no CRM. */
export async function findExistingImportRows(
  input: z.input<typeof findExistingSchema>
): Promise<ActionResultWithData<number[]>> {
  const parsed = findExistingSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  const auth = await getActionMembership(IMPORT_ROLES)

  if (!auth.ok) {
    return auth
  }

  if (parsed.data.rows.length === 0) {
    return { ok: true, data: [] }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("import_find_existing", {
    p_organization_id: auth.context.membership.organizationId,
    p_kind: parsed.data.kind,
    p_rows: parsed.data.rows,
  })

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "Não foi possível conferir a base agora."),
    }
  }

  const lines = z.array(z.number().int()).safeParse(data)

  return lines.success ? { ok: true, data: lines.data } : { ok: false, error: INVALID_REQUEST }
}

/** Abre a importação. Repetir com o mesmo `jobId` não cria outra. */
export async function startImportJob(
  input: z.input<typeof startSchema>
): Promise<ActionResultWithData<{ jobId: string }>> {
  const parsed = startSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  const auth = await getActionMembership(IMPORT_ROLES)

  if (!auth.ok) {
    return auth
  }

  const { jobId, kind, duplicateMode, totalRows, legalBasis, tag } = parsed.data

  if (kind === "clients" && !legalBasis) {
    return { ok: false, error: "Escolha a base legal (LGPD) dos contatos importados." }
  }

  const options: Record<string, string> = {}

  if (kind === "clients" && legalBasis) {
    options.legal_basis = legalBasis

    if (tag) {
      options.tag = tag
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("import_start", {
    p_organization_id: auth.context.membership.organizationId,
    p_job_id: jobId,
    p_kind: kind,
    p_duplicate_mode: duplicateMode,
    p_total_rows: totalRows,
    p_options: options,
  })

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "Não foi possível começar a importação."),
    }
  }

  return { ok: true, data: { jobId } }
}

/** Grava um lote. Reenviar o mesmo lote devolve o resultado já gravado. */
export async function importRowsBatch(
  input: z.input<typeof batchSchema>
): Promise<ActionResultWithData<ImportBatchResult>> {
  const parsed = batchSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  const auth = await getActionMembership(IMPORT_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("import_batch", {
    p_organization_id: auth.context.membership.organizationId,
    p_job_id: parsed.data.jobId,
    p_batch_index: parsed.data.batchIndex,
    p_rows: parsed.data.rows,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error, "Não foi possível gravar este lote.") }
  }

  const result = batchResultSchema.safeParse(data)

  if (!result.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  return {
    ok: true,
    data: { replayed: result.data.replayed, outcomes: result.data.results },
  }
}

/** Fecha a importação, registra na auditoria e atualiza as listas. */
export async function finishImportJob(
  input: z.input<typeof finishSchema>
): Promise<ActionResultWithData<ImportJobTotals>> {
  const parsed = finishSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  const auth = await getActionMembership(IMPORT_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("import_finish", {
    p_organization_id: auth.context.membership.organizationId,
    p_job_id: parsed.data.jobId,
    p_invalid_rows: parsed.data.invalidRows,
    p_file_duplicates: parsed.data.fileDuplicates,
  })

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "Não foi possível concluir a importação."),
    }
  }

  const totals = finishResultSchema.safeParse(data)

  if (!totals.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  for (const path of Object.values(IMPORT_LIST_PATHS)) {
    revalidatePath(path)
  }

  revalidatePath("/painel")
  revalidatePath(IMPORT_SETTINGS_PATH)

  return { ok: true, data: totals.data }
}

// ---------------------------------------------------------------------------
// Fotos por link
// ---------------------------------------------------------------------------

const jobSchema = z.object({ jobId: z.guid() })

const claimedPhotoSchema = z.array(
  z.object({
    id: z.guid(),
    property_id: z.guid(),
    row: z.number().int(),
    position: z.number().int(),
    url: z.string(),
  })
)

type ClaimedPhoto = z.infer<typeof claimedPhotoSchema>[number]

const completeResultSchema = z.object({
  ok: z.boolean(),
  code: z.string().nullable().optional(),
  property_done: z.boolean(),
})

const photoStatusSchema = z.object({
  total: z.number().int(),
  pending: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  failures: z.array(
    z.object({ row: z.number().int(), position: z.number().int(), code: z.string().nullable() })
  ),
})

export type ImportPhotoStatus = {
  total: number
  pending: number
  done: number
  failed: number
  failures: ImportPhotoFailure[]
}

/** Igual ao upload pelo navegador: o nome do arquivo muda a cada foto. */
const PHOTO_CACHE_CONTROL = "31536000"

type ServerSupabase = Awaited<ReturnType<typeof createClient>>

async function readPhotoStatus(
  supabase: ServerSupabase,
  organizationId: string,
  jobId: string
): Promise<ActionResultWithData<ImportPhotoStatus>> {
  const { data, error } = await supabase.rpc("import_photos_status", {
    p_organization_id: organizationId,
    p_job_id: jobId,
  })

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "Não foi possível ver as fotos agora."),
    }
  }

  const status = photoStatusSchema.safeParse(data)

  return status.success ? { ok: true, data: status.data } : { ok: false, error: INVALID_REQUEST }
}

/** Situação dos links de foto de uma importação (sem os links). */
export async function getImportPhotoStatus(
  input: z.input<typeof jobSchema>
): Promise<ActionResultWithData<ImportPhotoStatus>> {
  const parsed = jobSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  const auth = await getActionMembership(IMPORT_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()

  return readPhotoStatus(supabase, auth.context.membership.organizationId, parsed.data.jobId)
}

/** Baixa, otimiza e guarda uma foto. Devolve o caminho no Storage ou o código da falha. */
async function storeImportedPhoto(
  supabase: ServerSupabase,
  organizationId: string,
  item: ClaimedPhoto
): Promise<{ path: string } | { code: string }> {
  const downloaded = await downloadPhoto(item.url)

  if (!downloaded.ok) {
    return { code: downloaded.code }
  }

  const optimized = await optimizeImportedPhoto(downloaded.bytes)

  if (!optimized) {
    return { code: "optimize_failed" }
  }

  const bucket = supabase.storage.from(PROPERTY_MEDIA_BUCKET)
  const path = `${organizationId}/properties/${item.property_id}/${crypto.randomUUID()}.jpg`
  const { error } = await bucket.upload(path, optimized.main, {
    contentType: "image/jpeg",
    cacheControl: PHOTO_CACHE_CONTROL,
    upsert: false,
  })

  if (error) {
    return { code: "upload_failed" }
  }

  if (optimized.thumb) {
    // Sem miniatura a tela usa a foto principal.
    await bucket.upload(thumbPathFor(path), optimized.thumb, {
      contentType: "image/webp",
      cacheControl: PHOTO_CACHE_CONTROL,
      upsert: false,
    })
  }

  return { path }
}

/**
 * Baixa, otimiza e guarda o próximo lote pequeno de fotos da importação. As
 * fotos de um mesmo imóvel vão em ordem (o primeiro link vira capa); imóveis
 * diferentes vão em paralelo. Chame de novo enquanto `pending` > 0.
 */
export async function processImportPhotos(
  input: z.input<typeof jobSchema>
): Promise<ActionResultWithData<ImportPhotoStatus>> {
  const parsed = jobSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  const auth = await getActionMembership(IMPORT_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const { jobId } = parsed.data
  const supabase = await createClient()
  const { data: claimedData, error: claimError } = await supabase.rpc("import_photos_claim", {
    p_organization_id: organizationId,
    p_job_id: jobId,
    p_limit: IMPORT_PHOTO_BATCH,
  })

  if (claimError) {
    return {
      ok: false,
      error: translateDatabaseError(claimError, "Não foi possível baixar as fotos agora."),
    }
  }

  const claimed = claimedPhotoSchema.safeParse(claimedData)

  if (!claimed.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  const byProperty = new Map<string, ClaimedPhoto[]>()

  for (const item of claimed.data) {
    byProperty.set(item.property_id, [...(byProperty.get(item.property_id) ?? []), item])
  }

  const finishedProperties = new Set<string>()

  async function processItem(item: ClaimedPhoto) {
    const stored = await storeImportedPhoto(supabase, organizationId, item)
    const storagePath = "path" in stored ? stored.path : null
    const { data, error } = await supabase.rpc("import_photos_complete", {
      p_organization_id: organizationId,
      p_job_id: jobId,
      p_item_id: item.id,
      ...("path" in stored ? { p_storage_path: stored.path } : { p_error_code: stored.code }),
    })
    const result = completeResultSchema.safeParse(data)

    if (storagePath && (error || !result.success || !result.data.ok)) {
      // Sem a linha em property_media a foto e a miniatura ficariam órfãs.
      await supabase.storage
        .from(PROPERTY_MEDIA_BUCKET)
        .remove(propertyPhotoObjectPaths(storagePath))
    }

    if (result.success && result.data.property_done) {
      finishedProperties.add(item.property_id)
    }
  }

  await Promise.all(
    [...byProperty.values()].map(async (items) => {
      for (const item of [...items].sort((a, b) => a.position - b.position)) {
        await processItem(item)
      }
    })
  )

  for (const propertyId of finishedProperties) {
    await refreshImobScore(supabase, organizationId, propertyId)
  }

  if (finishedProperties.size > 0) {
    revalidatePath(IMPORT_LIST_PATHS.properties)
  }

  return readPhotoStatus(supabase, organizationId, jobId)
}

// ---------------------------------------------------------------------------
// Desfazer
// ---------------------------------------------------------------------------

const undoCountsSchema = z.object({
  clients: z.number().int(),
  leads: z.number().int(),
  properties: z.number().int(),
  property_owners: z.number().int(),
  property_media: z.number().int(),
})

const undoPrepareSchema = z.object({ storage_paths: z.array(z.string()) })

const undoApplySchema = z.object({
  done: z.boolean(),
  removed: undoCountsSchema,
  kept: undoCountsSchema,
})

export type ImportUndoCounts = z.infer<typeof undoCountsSchema>

export type ImportUndoResult = z.infer<typeof undoApplySchema>

/** Tempo de trabalho por chamada: o resto continua na próxima. */
const UNDO_TIME_BUDGET_MS = 20_000

/**
 * "Desfazer esta importação" (até 7 dias): em passos, decide o que sai (criado
 * pela importação e não alterado nem usado depois), apaga os arquivos das
 * fotos que saem e apaga os registros. Chame de novo enquanto `done` = false.
 */
export async function undoImportJob(
  input: z.input<typeof jobSchema>
): Promise<ActionResultWithData<ImportUndoResult>> {
  const parsed = jobSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: INVALID_REQUEST }
  }

  const auth = await getActionMembership(IMPORT_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const { jobId } = parsed.data
  const supabase = await createClient()
  const bucket = supabase.storage.from(PROPERTY_MEDIA_BUCKET)
  const startedAt = Date.now()
  let last: ImportUndoResult

  do {
    const { data: prepared, error: prepareError } = await supabase.rpc("import_undo_prepare", {
      p_organization_id: organizationId,
      p_job_id: jobId,
      p_limit: IMPORT_UNDO_CHUNK,
    })

    if (prepareError) {
      return {
        ok: false,
        error: translateDatabaseError(prepareError, "Não foi possível desfazer a importação."),
      }
    }

    const plan = undoPrepareSchema.safeParse(prepared)

    if (!plan.success) {
      return { ok: false, error: INVALID_REQUEST }
    }

    const objects = plan.data.storage_paths.flatMap(propertyPhotoObjectPaths)

    for (let index = 0; index < objects.length; index += 500) {
      // Arquivo que não sair fica órfão no bucket; o registro sai do CRM do mesmo jeito.
      await bucket.remove(objects.slice(index, index + 500))
    }

    const { data: applied, error: applyError } = await supabase.rpc("import_undo_apply", {
      p_organization_id: organizationId,
      p_job_id: jobId,
    })

    if (applyError) {
      return {
        ok: false,
        error: translateDatabaseError(applyError, "Não foi possível desfazer a importação."),
      }
    }

    const result = undoApplySchema.safeParse(applied)

    if (!result.success) {
      return { ok: false, error: INVALID_REQUEST }
    }

    last = result.data
  } while (!last.done && Date.now() - startedAt < UNDO_TIME_BUDGET_MS)

  if (last.done) {
    for (const path of Object.values(IMPORT_LIST_PATHS)) {
      revalidatePath(path)
    }

    revalidatePath("/painel")
    revalidatePath(IMPORT_SETTINGS_PATH)
  }

  return { ok: true, data: last }
}
