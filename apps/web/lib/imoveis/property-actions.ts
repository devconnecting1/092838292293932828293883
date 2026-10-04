"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { PROPERTY_STATUS_LABELS } from "@workspace/core/properties/enums"
import type { Tables } from "@workspace/database/types"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import { PROPERTY_STATUSES } from "@/lib/imoveis/constants"
import { translateDbError, type DbErrorLike } from "@/lib/imoveis/db-errors"
import { isUuid } from "@/lib/imoveis/ids"
import {
  summarizeMedia,
  validatePropertyForPortals,
  withExternalMediaUrls,
  type MediaSource,
} from "@/lib/imoveis/mappers"
import {
  canCreateProperty,
  canEditProperty,
  canManageProperty,
  canReadCaptureRequests,
  MANAGE_PROPERTY_DENIED_MESSAGE,
  mustStayAssigned,
} from "@/lib/imoveis/permissions"
import {
  getPropertyMediaRows,
  getPropertyRow,
  type ServerSupabaseClient,
} from "@/lib/imoveis/queries"
import {
  formValuesToColumns,
  getStatusRequirementIssues,
  propertyFormSchema,
  type PropertyFormField,
  type PropertyFormValues,
} from "@/lib/imoveis/schema"
import {
  getPropertyActionContext,
  refreshImobScore,
  revalidatePropertyPaths,
} from "@/lib/imoveis/server-context"
import { createClient } from "@/lib/supabase/server"

export type PropertyFieldErrors = Partial<Record<PropertyFormField, string>>

export type SavePropertyInput = {
  values: PropertyFormValues
  propertyId?: string | null
  captureRequestId?: string | null
}

export type SavePropertyResult =
  | {
      ok: true
      propertyId: string
      code: string
      created: boolean
      imobScore: number | null
      message: string
      warnings: string[]
    }
  | { ok: false; error: string; fieldErrors?: PropertyFieldErrors }

const EXTERNAL_CODE_CONFLICT = "Já existe outro imóvel com este código no sistema anterior."

/** Violação do índice único (organization_id, external_code). */
function isExternalCodeConflict(error: DbErrorLike | null) {
  return (
    error?.code === "23505" &&
    `${error.message ?? ""} ${error.details ?? ""}`.includes(
      "properties_organization_external_code_key"
    )
  )
}

function fieldErrorsFrom(error: z.ZodError<PropertyFormValues>): PropertyFieldErrors {
  const result: PropertyFieldErrors = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field === "string" && !(field in result)) {
      result[field as PropertyFormField] = issue.message
    }
  }
  return result
}

/**
 * Vídeo (YouTube) e tour virtual ficam em property_media com kind video/tour.
 * Remover a linha é permitido só a dono e gerente (RLS): para os demais,
 * limpar o campo gera um aviso em vez de erro.
 */
async function syncExternalMedia(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string,
  kind: "video" | "tour",
  url: string
): Promise<string | null> {
  const label = kind === "video" ? "o vídeo" : "o tour virtual"
  const { data: rows, error } = await supabase
    .from("property_media")
    .select("id, external_url")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .eq("kind", kind)
    .order("position")

  if (error) return `Não foi possível atualizar ${label}.`

  const [current, ...extra] = rows ?? []
  const target = url.trim()

  if (!target) {
    if (!current) return null
    const ids = (rows ?? []).map((row) => row.id)
    const { data: removed, error: removeError } = await supabase
      .from("property_media")
      .delete()
      .in("id", ids)
      .select("id")

    if (removeError || !removed?.length) {
      return `Somente o dono ou o gerente podem remover ${label}. O link anterior foi mantido.`
    }
    return null
  }

  if (current) {
    if (current.external_url !== target) {
      const { error: updateError } = await supabase
        .from("property_media")
        .update({ external_url: target })
        .eq("id", current.id)

      if (updateError) return translateDbError(updateError, `atualizar ${label}`)
    }

    if (extra.length > 0) {
      await supabase
        .from("property_media")
        .delete()
        .in(
          "id",
          extra.map((row) => row.id)
        )
    }
    return null
  }

  const { error: insertError } = await supabase.from("property_media").insert({
    organization_id: organizationId,
    property_id: propertyId,
    kind,
    external_url: target,
    position: 0,
  })

  return insertError ? translateDbError(insertError, `salvar ${label}`) : null
}

/**
 * Cria ou atualiza um imóvel a partir do formulário em etapas. Grava a
 * Nota do Anúncio (imob_score) calculada no servidor e, se veio de uma captação, marca a
 * captação como convertida.
 */
export async function savePropertyAction(input: SavePropertyInput): Promise<SavePropertyResult> {
  const { user, membership } = await requireMembership()
  const organizationId = membership.organizationId
  const role = membership.role

  const parsed = propertyFormSchema.safeParse(input.values)
  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    }
  }

  const values = parsed.data
  const propertyId = input.propertyId ?? null

  if (propertyId !== null && !isUuid(propertyId)) {
    return { ok: false, error: "Imóvel inválido." }
  }

  const supabase = await createClient()
  let existing: Tables<"properties"> | null = null

  if (propertyId) {
    try {
      existing = await getPropertyRow(supabase, organizationId, propertyId)
    } catch {
      return {
        ok: false,
        error: "Não foi possível carregar o imóvel agora. Tente novamente.",
      }
    }
    if (!existing) {
      return { ok: false, error: "Imóvel não encontrado nesta imobiliária." }
    }
    if (!canEditProperty(role, user.id, existing)) {
      return {
        ok: false,
        error: "Você não tem permissão para editar este imóvel.",
      }
    }
  } else if (!canCreateProperty(role)) {
    return {
      ok: false,
      error: "Seu papel nesta imobiliária não permite cadastrar imóveis.",
    }
  }

  // Corretor/captador que se desvincula perde o acesso de edição (RLS).
  if (mustStayAssigned(role)) {
    const assigned = values.capturedBy === user.id || values.brokerId === user.id
    const autoAssigned = !existing && !values.capturedBy && !values.brokerId
    if (!assigned && !autoAssigned) {
      const message =
        "Você precisa continuar como captador ou corretor deste imóvel para poder editá-lo."
      return { ok: false, error: message, fieldErrors: { capturedBy: message } }
    }
  }

  const columns = formValuesToColumns(values)

  if (values.status !== "draft") {
    const issues = getStatusRequirementIssues(columns)
    if (issues.length > 0) {
      const fieldErrors: PropertyFieldErrors = {}
      for (const issue of issues) fieldErrors[issue.field] = issue.message
      return {
        ok: false,
        error: `Para salvar como "${PROPERTY_STATUS_LABELS[values.status]}", complete: ${issues
          .map((issue) => issue.message.replace(/\.$/, "").toLowerCase())
          .join("; ")}.`,
        fieldErrors,
      }
    }
  }

  // Sigilo: só dono, gerente, captador e corretor responsável mudam (o banco confere).
  const changesRestriction = values.isRestricted !== (existing?.is_restricted ?? false)
  if (changesRestriction) {
    // Cadastro sem captador nem corretor: o banco põe o corretor/captador que cadastra.
    const autoCapturer =
      mustStayAssigned(role) && !columns.captured_by && !columns.broker_id ? user.id : null
    const assignment = existing ?? {
      captured_by: columns.captured_by ?? autoCapturer,
      broker_id: columns.broker_id,
    }
    if (!canManageProperty(role, user.id, assignment)) {
      return {
        ok: false,
        error: MANAGE_PROPERTY_DENIED_MESSAGE,
        fieldErrors: { isRestricted: MANAGE_PROPERTY_DENIED_MESSAGE },
      }
    }
  }

  // Publicação só para imóvel ativo, já salvo, sem erros de VRSync e sem sigilo.
  let publish =
    values.publishedToPortals &&
    values.status === "active" &&
    existing !== null &&
    !values.isRestricted

  if (publish && existing) {
    let media: MediaSource[]
    try {
      media = await getPropertyMediaRows(supabase, organizationId, existing.id)
    } catch {
      return {
        ok: false,
        error: "Não foi possível conferir as fotos do imóvel. Tente novamente.",
      }
    }

    const validation = validatePropertyForPortals(
      { ...columns, code: existing.code },
      summarizeMedia(withExternalMediaUrls(media, values.videoUrl, values.tourUrl))
    )

    if (!validation.valid) {
      return {
        ok: false,
        error: `Para publicar nos portais, corrija: ${validation.errors.map((issue) => issue.message).join(" ")}`,
        fieldErrors: {
          publishedToPortals: "Há pendências para publicar nos portais.",
        },
      }
    }
  }

  if (!values.publishedToPortals) publish = false

  let savedId: string
  let savedCode: string

  if (existing) {
    const { data, error } = await supabase
      .from("properties")
      .update({
        ...columns,
        status: values.status,
        published_to_portals: publish,
      })
      .eq("organization_id", organizationId)
      .eq("id", existing.id)
      .select("id, code")

    if (isExternalCodeConflict(error)) {
      return {
        ok: false,
        error: EXTERNAL_CODE_CONFLICT,
        fieldErrors: { externalCode: EXTERNAL_CODE_CONFLICT },
      }
    }
    if (error) {
      return { ok: false, error: translateDbError(error, "editar este imóvel") }
    }
    const row = data?.[0]
    if (!row) {
      return {
        ok: false,
        error: "Você não tem permissão para editar este imóvel ou ele foi removido.",
      }
    }
    savedId = row.id
    savedCode = row.code
  } else {
    const { data, error } = await supabase
      .from("properties")
      .insert({
        ...columns,
        organization_id: organizationId,
        status: values.status,
        published_to_portals: false,
      })
      .select("id, code")
      .single()

    if (isExternalCodeConflict(error)) {
      return {
        ok: false,
        error: EXTERNAL_CODE_CONFLICT,
        fieldErrors: { externalCode: EXTERNAL_CODE_CONFLICT },
      }
    }
    if (error || !data) {
      return {
        ok: false,
        error: translateDbError(error ?? {}, "cadastrar imóveis"),
      }
    }
    savedId = data.id
    savedCode = data.code
  }

  const warnings: string[] = []

  const videoWarning = await syncExternalMedia(
    supabase,
    organizationId,
    savedId,
    "video",
    values.videoUrl
  )
  if (videoWarning) warnings.push(videoWarning)
  const tourWarning = await syncExternalMedia(
    supabase,
    organizationId,
    savedId,
    "tour",
    values.tourUrl
  )
  if (tourWarning) warnings.push(tourWarning)

  let convertedCapture = false
  if (!existing && input.captureRequestId && isUuid(input.captureRequestId)) {
    if (!canReadCaptureRequests(role)) {
      warnings.push(
        "Seu papel não permite atualizar captações; peça para a gestão marcar a captação como convertida."
      )
    } else {
      const { data, error } = await supabase
        .from("capture_requests")
        .update({ status: "converted", converted_property_id: savedId })
        .eq("organization_id", organizationId)
        .eq("id", input.captureRequestId)
        .neq("status", "converted")
        .select("id")

      if (error || !data?.length) {
        warnings.push("O imóvel foi salvo, mas não foi possível marcar a captação como convertida.")
      } else {
        convertedCapture = true
      }
    }
  }

  const imobScore = await refreshImobScore(supabase, organizationId, savedId)

  revalidatePropertyPaths(savedId)
  if (convertedCapture) revalidatePath("/captacao")
  if (columns.condominium_id) revalidatePath(`/condominios/${columns.condominium_id}`)
  if (existing?.condominium_id && existing.condominium_id !== columns.condominium_id) {
    revalidatePath(`/condominios/${existing.condominium_id}`)
  }

  return {
    ok: true,
    propertyId: savedId,
    code: savedCode,
    created: !existing,
    imobScore,
    message: existing
      ? `Imóvel ${savedCode} salvo.`
      : `Imóvel ${savedCode} criado como ${PROPERTY_STATUS_LABELS[values.status].toLowerCase()}.`,
    warnings,
  }
}

const statusSchema = z.enum(PROPERTY_STATUSES)

/** Troca o status (ações da ficha). Sair do rascunho respeita os CHECKs do banco. */
export async function changePropertyStatusAction(
  propertyId: string,
  status: string
): Promise<ActionResult> {
  const parsedStatus = statusSchema.safeParse(status)
  if (!parsedStatus.success || !isUuid(propertyId)) {
    return { ok: false, error: "Status inválido." }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context
  const nextStatus = parsedStatus.data

  if (property.status === nextStatus) {
    return {
      ok: true,
      message: `O imóvel já está como ${PROPERTY_STATUS_LABELS[nextStatus].toLowerCase()}.`,
    }
  }

  if (nextStatus !== "draft") {
    const issues = getStatusRequirementIssues(property)
    if (issues.length > 0) {
      return {
        ok: false,
        error: `Para mudar para "${PROPERTY_STATUS_LABELS[nextStatus]}", edite o imóvel e ${issues
          .map((issue) => issue.message.replace(/\.$/, "").toLowerCase())
          .join("; ")}.`,
      }
    }
  }

  const { data, error } = await supabase
    .from("properties")
    .update({
      status: nextStatus,
      // Fora de "ativo" o imóvel sai do feed; ao reativar, publicar de novo é explícito.
      published_to_portals: nextStatus === "active" ? property.published_to_portals : false,
    })
    .eq("organization_id", organizationId)
    .eq("id", property.id)
    .select("id")

  if (error) {
    return {
      ok: false,
      error: translateDbError(error, "alterar o status deste imóvel"),
    }
  }
  if (!data?.length) {
    return {
      ok: false,
      error: "Você não tem permissão para alterar o status deste imóvel.",
    }
  }

  revalidatePropertyPaths(property.id)

  return {
    ok: true,
    message: `Status alterado para ${PROPERTY_STATUS_LABELS[nextStatus].toLowerCase()}.`,
  }
}

/** Liga/desliga a publicação nos portais (só imóvel ativo e sem erros de VRSync). */
export async function setPublishedToPortalsAction(
  propertyId: string,
  published: boolean
): Promise<ActionResult> {
  if (!isUuid(propertyId)) {
    return { ok: false, error: "Imóvel inválido." }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context

  if (published) {
    if (property.is_restricted) {
      return {
        ok: false,
        error: "Imóvel restrito não vai para os portais. Tire o sigilo antes de publicar.",
      }
    }

    if (property.status !== "active") {
      return {
        ok: false,
        error: "Ative o imóvel antes de publicar nos portais.",
      }
    }

    let media: MediaSource[]
    try {
      media = await getPropertyMediaRows(supabase, organizationId, property.id)
    } catch {
      return {
        ok: false,
        error: "Não foi possível conferir as fotos do imóvel. Tente novamente.",
      }
    }

    const validation = validatePropertyForPortals(property, summarizeMedia(media))
    if (!validation.valid) {
      return {
        ok: false,
        error: `Para publicar nos portais, corrija: ${validation.errors.map((issue) => issue.message).join(" ")}`,
      }
    }
  }

  const { data, error } = await supabase
    .from("properties")
    .update({ published_to_portals: published })
    .eq("organization_id", organizationId)
    .eq("id", property.id)
    .select("id")

  if (error) {
    return { ok: false, error: translateDbError(error, "publicar este imóvel") }
  }
  if (!data?.length) {
    return {
      ok: false,
      error: "Você não tem permissão para publicar este imóvel.",
    }
  }

  revalidatePropertyPaths(property.id)

  return {
    ok: true,
    message: published ? "Imóvel publicado nos portais." : "Imóvel retirado dos portais.",
  }
}
