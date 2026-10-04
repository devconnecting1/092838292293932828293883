"use server"

import { MAX_PROPERTY_PHOTOS } from "@workspace/core/media/limits"
import {
  expectedContentTypeForPath,
  uploadedObjectProblemMessage,
} from "@workspace/core/media/uploaded-object"

import type { ActionResult } from "@/lib/auth/action-result"
import {
  ACCEPTED_IMAGE_TYPES,
  CAPTION_MAX_LENGTH,
  MAX_IMAGE_BYTES,
  PROPERTY_MEDIA_BUCKET,
} from "@/lib/imoveis/constants"
import { translateDbError } from "@/lib/imoveis/db-errors"
import { isUuid } from "@/lib/imoveis/ids"
import { REMOVE_MEDIA_DENIED_MESSAGE, canDeletePropertyRecords } from "@/lib/imoveis/permissions"
import type { ServerSupabaseClient } from "@/lib/imoveis/queries"
import {
  getPropertyActionContext,
  refreshImobScore,
  revalidatePropertyPaths,
} from "@/lib/imoveis/server-context"
import { propertyPhotoObjectPaths, thumbPathFor } from "@/lib/media/paths"
import { UPLOADS_BLOCKED_MESSAGE, photoLimitMessage } from "@/lib/media/upload-errors"
import {
  createSignedUpload,
  inspectUploadedObject,
  removeUnregisteredUploads,
} from "@/lib/storage/signed-upload"
import type {
  SignedUploadActionResult,
  SignedUploadTicket,
} from "@/lib/storage/signed-upload-ticket"

const MAX_IMAGES_PER_CALL = 50
const EXTENSIONS = new Set(Object.values(ACCEPTED_IMAGE_TYPES))

/** Tipos aceitos no bucket property-media (a foto principal é JPEG; a miniatura, WebP). */
const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/webp"] as const
const PHOTO_RULES = { allowedTypes: PHOTO_CONTENT_TYPES, maxBytes: MAX_IMAGE_BYTES }
const PHOTO_FORMATS_LABEL = "JPG ou WebP"

type ImageRow = {
  id: string
  position: number
  is_cover: boolean
  storage_path: string | null
}

async function loadImages(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
) {
  const { data, error } = await supabase
    .from("property_media")
    .select("id, position, is_cover, storage_path")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .eq("kind", "image")
    .order("position")
    .order("created_at")

  return { images: (data ?? []) as ImageRow[], error }
}

/** Grava posições 0..n-1 na ordem recebida (só as que mudaram). */
async function persistOrder(supabase: ServerSupabaseClient, ordered: readonly ImageRow[]) {
  for (const [index, image] of ordered.entries()) {
    if (image.position === index) continue
    const { error } = await supabase
      .from("property_media")
      .update({ position: index })
      .eq("id", image.id)
    if (error) return error
  }
  return null
}

function isExpectedStoragePath(path: string, organizationId: string, propertyId: string) {
  const prefix = `${organizationId}/properties/${propertyId}/`
  if (!path.startsWith(prefix)) return false

  const fileName = path.slice(prefix.length)
  const match = /^([0-9a-f-]{36})\.([a-z]+)$/i.exec(fileName)
  return Boolean(match && isUuid(match[1]) && EXTENSIONS.has((match[2] ?? "").toLowerCase()))
}

export type PropertyPhotoUploadTickets = {
  main: SignedUploadTicket
  /** Sem miniatura a UI usa a foto principal. */
  thumb: SignedUploadTicket | null
}

/**
 * Autoriza o envio de UMA foto já otimizada no navegador: confere a edição do
 * imóvel e o limite de fotos, escolhe o caminho e gera os tokens de envio da
 * foto e da miniatura. O RLS do Storage (edição do imóvel e assinatura fora do
 * modo leitura) é testado pelo próprio Storage ao gerar o token.
 */
export async function requestPropertyPhotoUploadAction(
  propertyId: string,
  input: { extension: string; thumbnail: boolean }
): Promise<SignedUploadActionResult<PropertyPhotoUploadTickets>> {
  const extension = String(input?.extension ?? "").toLowerCase()

  if (!EXTENSIONS.has(extension)) {
    return { ok: false, error: "Formato não aceito. Envie JPG, PNG, WebP ou HEIC." }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context
  const { images, error: loadError } = await loadImages(supabase, organizationId, property.id)

  if (loadError) {
    return { ok: false, error: translateDbError(loadError, "enviar fotos para este imóvel") }
  }
  if (images.length >= MAX_PROPERTY_PHOTOS) {
    return { ok: false, error: photoLimitMessage(MAX_PROPERTY_PHOTOS) }
  }

  const path = `${organizationId}/properties/${property.id}/${crypto.randomUUID()}.${extension}`
  const main = await createSignedUpload(supabase, PROPERTY_MEDIA_BUCKET, path)

  if (!main.ok) {
    return main.forbidden
      ? { ok: false, error: UPLOADS_BLOCKED_MESSAGE, blocked: true }
      : { ok: false, error: "Não foi possível autorizar o envio agora. Tente novamente." }
  }

  const thumb = input?.thumbnail
    ? await createSignedUpload(supabase, PROPERTY_MEDIA_BUCKET, thumbPathFor(path))
    : null

  return { ok: true, data: { main: main.ticket, thumb: thumb?.ok ? thumb.ticket : null } }
}

/**
 * Registra fotos que o navegador já enviou ao bucket com os tokens de
 * `requestPropertyPhotoUploadAction`. Tamanho e tipo são lidos do bucket (não
 * do navegador). Se algo falhar, as fotos (e miniaturas) sem registro são
 * apagadas. Novas fotos entram no fim; a primeira vira capa se não houver.
 */
export async function registerPropertyImagesAction(
  propertyId: string,
  storagePaths: string[]
): Promise<ActionResult> {
  if (!Array.isArray(storagePaths) || storagePaths.length === 0) {
    return { ok: false, error: "Nenhuma foto para registrar." }
  }
  if (storagePaths.length > MAX_IMAGES_PER_CALL) {
    return {
      ok: false,
      error: `Envie no máximo ${MAX_IMAGES_PER_CALL} fotos por vez.`,
    }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context
  const paths = [...new Set(storagePaths)]

  if (!paths.every((path) => isExpectedStoragePath(path, organizationId, property.id))) {
    return { ok: false, error: "Arquivo enviado para uma pasta inválida." }
  }

  const { images, error: loadError } = await loadImages(supabase, organizationId, property.id)
  if (loadError) {
    return {
      ok: false,
      error: translateDbError(loadError, "registrar as fotos"),
    }
  }

  // Só o que ainda não está no banco pode ser apagado em caso de falha.
  const registered = new Set(images.map((image) => image.storage_path))
  const discard = () =>
    removeUnregisteredUploads(
      supabase,
      PROPERTY_MEDIA_BUCKET,
      paths.filter((path) => !registered.has(path)).flatMap(propertyPhotoObjectPaths)
    )

  if (images.length + paths.length > MAX_PROPERTY_PHOTOS) {
    await discard()
    return {
      ok: false,
      error:
        images.length >= MAX_PROPERTY_PHOTOS
          ? photoLimitMessage(MAX_PROPERTY_PHOTOS)
          : `Este imóvel aceita até ${MAX_PROPERTY_PHOTOS} fotos e já tem ${images.length}. Envie no máximo ${MAX_PROPERTY_PHOTOS - images.length}.`,
    }
  }

  const checks = await Promise.all(
    paths.map((path) =>
      inspectUploadedObject(supabase, PROPERTY_MEDIA_BUCKET, path, {
        ...PHOTO_RULES,
        expectedType: expectedContentTypeForPath(path),
      })
    )
  )
  const problem = checks.find((check) => !check.ok)

  if (problem && !problem.ok) {
    await discard()
    return {
      ok: false,
      error: uploadedObjectProblemMessage(problem.problem, {
        formats: PHOTO_FORMATS_LABEL,
        maxBytes: MAX_IMAGE_BYTES,
      }),
    }
  }

  const nextPosition = images.reduce((max, image) => Math.max(max, image.position + 1), 0)
  const hasCover = images.some((image) => image.is_cover)

  const { error } = await supabase.from("property_media").insert(
    paths.map((path, index) => ({
      organization_id: organizationId,
      property_id: property.id,
      kind: "image" as const,
      storage_path: path,
      position: nextPosition + index,
      is_cover: !hasCover && index === 0,
    }))
  )

  if (error) {
    // Sem a linha no banco a foto e a miniatura ficariam órfãs no bucket. Com
    // caminho duplicado (pedido repetido) o arquivo já é de outra linha: fica.
    if (error.code !== "23505") await discard()
    return {
      ok: false,
      error: translateDbError(error, "adicionar fotos a este imóvel"),
    }
  }

  await refreshImobScore(supabase, organizationId, property.id)
  revalidatePropertyPaths(property.id)

  return {
    ok: true,
    message: paths.length === 1 ? "Foto adicionada." : `${paths.length} fotos adicionadas.`,
  }
}

/**
 * Grava a ordem inteira das fotos de uma vez (arrastar e soltar, ou mover pelo
 * teclado). Recebe todos os ids do imóvel: fotos que faltarem no pedido ficam
 * no fim, na ordem atual, então uma foto adicionada em outra aba não some.
 */
export async function reorderMediaAction(
  propertyId: string,
  orderedIds: string[]
): Promise<ActionResult> {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { ok: false, error: "Nenhuma ordem de fotos para salvar." }
  }
  if (orderedIds.length > MAX_PROPERTY_PHOTOS || !orderedIds.every(isUuid)) {
    return { ok: false, error: "Ordem de fotos inválida." }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context
  const { images, error: loadError } = await loadImages(supabase, organizationId, property.id)
  if (loadError) {
    return { ok: false, error: translateDbError(loadError, "reordenar as fotos") }
  }

  const byId = new Map(images.map((image) => [image.id, image]))
  const requested = [...new Set(orderedIds)]
  const ordered = requested
    .map((id) => byId.get(id))
    .filter((image): image is ImageRow => image !== undefined)

  if (ordered.length === 0) {
    return { ok: false, error: "Nenhuma das fotos enviadas está neste imóvel." }
  }

  const placed = new Set(ordered.map((image) => image.id))
  for (const image of images) {
    if (!placed.has(image.id)) ordered.push(image)
  }

  const error = await persistOrder(supabase, ordered)
  if (error) {
    return { ok: false, error: translateDbError(error, "reordenar as fotos") }
  }

  revalidatePropertyPaths(property.id)
  return { ok: true }
}

export async function setCoverMediaAction(
  propertyId: string,
  mediaId: string
): Promise<ActionResult> {
  if (!isUuid(mediaId)) {
    return { ok: false, error: "Foto inválida." }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context
  const { images, error: loadError } = await loadImages(supabase, organizationId, property.id)
  if (loadError) {
    return { ok: false, error: translateDbError(loadError, "definir a capa") }
  }

  const selected = images.find((image) => image.id === mediaId)
  if (!selected) {
    return { ok: false, error: "Foto não encontrada neste imóvel." }
  }
  if (selected.is_cover) {
    return { ok: true, message: "Esta foto já é a capa." }
  }

  // Índice único parcial: no máximo uma capa por imóvel. Desmarca antes de marcar.
  const previousCovers = images.filter((image) => image.is_cover).map((image) => image.id)
  if (previousCovers.length > 0) {
    const { error } = await supabase
      .from("property_media")
      .update({ is_cover: false })
      .in("id", previousCovers)
    if (error) {
      return { ok: false, error: translateDbError(error, "definir a capa") }
    }
  }

  const { data, error } = await supabase
    .from("property_media")
    .update({ is_cover: true })
    .eq("id", selected.id)
    .select("id")

  if (error || !data?.length) {
    if (previousCovers.length > 0) {
      await supabase
        .from("property_media")
        .update({ is_cover: true })
        .in("id", previousCovers.slice(0, 1))
    }
    return {
      ok: false,
      error: error
        ? translateDbError(error, "definir a capa")
        : "Você não tem permissão para definir a capa.",
    }
  }

  revalidatePropertyPaths(property.id)
  return { ok: true, message: "Capa atualizada." }
}

export async function updateMediaCaptionAction(
  propertyId: string,
  mediaId: string,
  caption: string
): Promise<ActionResult> {
  const text = String(caption ?? "").trim()

  if (!isUuid(mediaId)) {
    return { ok: false, error: "Foto inválida." }
  }
  if (text.length > CAPTION_MAX_LENGTH) {
    return {
      ok: false,
      error: `A legenda pode ter no máximo ${CAPTION_MAX_LENGTH} caracteres.`,
    }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context
  const { data, error } = await supabase
    .from("property_media")
    .update({ caption: text || null })
    .eq("organization_id", organizationId)
    .eq("property_id", property.id)
    .eq("id", mediaId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDbError(error, "editar a legenda") }
  }
  if (!data?.length) {
    return {
      ok: false,
      error: "Foto não encontrada ou sem permissão para editar.",
    }
  }

  revalidatePropertyPaths(property.id)
  return { ok: true, message: "Legenda salva." }
}

/** Remove a foto (linha e arquivo). RLS: só dono e gerente removem mídias. */
export async function removeMediaAction(
  propertyId: string,
  mediaId: string
): Promise<ActionResult> {
  if (!isUuid(mediaId)) {
    return { ok: false, error: "Foto inválida." }
  }

  const loaded = await getPropertyActionContext(propertyId, {
    requireEdit: false,
  })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, role, property } = loaded.context

  if (!canDeletePropertyRecords(role)) {
    return { ok: false, error: REMOVE_MEDIA_DENIED_MESSAGE }
  }

  const { data: removed, error } = await supabase
    .from("property_media")
    .delete()
    .eq("organization_id", organizationId)
    .eq("property_id", property.id)
    .eq("id", mediaId)
    .select("id, storage_path, is_cover, kind")

  if (error) {
    return { ok: false, error: translateDbError(error, "remover fotos") }
  }

  const row = removed?.[0]
  if (!row) {
    return {
      ok: false,
      error: "Foto não encontrada ou sem permissão para remover.",
    }
  }

  let warning: string | undefined

  if (row.storage_path) {
    // Apaga também a miniatura `__thumb.webp` (fotos antigas não têm: remove ignora).
    const { error: storageError } = await supabase.storage
      .from(PROPERTY_MEDIA_BUCKET)
      .remove(propertyPhotoObjectPaths(row.storage_path))
    if (storageError) {
      warning = "A foto saiu do anúncio, mas o arquivo não pôde ser apagado do armazenamento."
    }
  }

  const { images } = await loadImages(supabase, organizationId, property.id)
  await persistOrder(supabase, images)

  const firstImage = images[0]
  if (row.is_cover && firstImage && !images.some((image) => image.is_cover)) {
    await supabase.from("property_media").update({ is_cover: true }).eq("id", firstImage.id)
  }

  await refreshImobScore(supabase, organizationId, property.id)
  revalidatePropertyPaths(property.id)

  return { ok: true, message: warning ?? "Foto removida." }
}
