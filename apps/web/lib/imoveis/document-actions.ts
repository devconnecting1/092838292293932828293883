"use server"

import { z } from "zod"

import { uploadedObjectProblemMessage } from "@workspace/core/media/uploaded-object"
import {
  buildPropertyDocumentPath,
  isPropertyDocumentPath,
  PROPERTY_DOCUMENT_DESCRIPTION_MAX_LENGTH,
  PROPERTY_DOCUMENT_KIND_VALUES,
  PROPERTY_DOCUMENT_MAX_BYTES,
  PROPERTY_DOCUMENT_MIME_TYPES,
  PROPERTY_DOCUMENTS_BUCKET,
  propertyDocumentFileName,
  type PropertyDocumentKind,
  type PropertyDocumentMimeType,
} from "@workspace/core/properties/documents"

import type { ActionResult } from "@/lib/auth/action-result"
import { translateDbError } from "@/lib/imoveis/db-errors"
import { isUuid } from "@/lib/imoveis/ids"
import { canManageProperty, MANAGE_PROPERTY_DENIED_MESSAGE } from "@/lib/imoveis/permissions"
import type { ServerSupabaseClient } from "@/lib/imoveis/queries"
import { getPropertyActionContext, revalidatePropertyPaths } from "@/lib/imoveis/server-context"
import { UPLOADS_BLOCKED_MESSAGE } from "@/lib/media/upload-errors"
import {
  createSignedUpload,
  inspectUploadedObject,
  removeUnregisteredUploads,
} from "@/lib/storage/signed-upload"
import type { SignedUploadActionResult } from "@/lib/storage/signed-upload-ticket"

const DOCUMENT_FORMATS_LABEL = "PDF, JPG, PNG ou WebP"

/**
 * Apaga o arquivo enviado se nenhuma linha o registra (caminho já validado
 * para o imóvel). Nunca apaga o arquivo de um documento existente.
 */
async function discardUnregisteredDocument(
  supabase: ServerSupabaseClient,
  organizationId: string,
  storagePath: string
) {
  const { data, error } = await supabase
    .from("property_documents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("storage_path", storagePath)
    .limit(1)

  if (error || (data?.length ?? 0) > 0) return

  await removeUnregisteredUploads(supabase, PROPERTY_DOCUMENTS_BUCKET, [storagePath])
}

/** Validade da URL assinada de download, em segundos. */
const DOWNLOAD_URL_TTL_SECONDS = 60

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

const registerDocumentSchema = z.object({
  storagePath: z.string().min(1).max(512),
  kind: z.enum(PROPERTY_DOCUMENT_KIND_VALUES as [PropertyDocumentKind, ...PropertyDocumentKind[]], {
    error: "Escolha o tipo do documento.",
  }),
  description: z
    .string()
    .trim()
    .max(
      PROPERTY_DOCUMENT_DESCRIPTION_MAX_LENGTH,
      `A descrição pode ter no máximo ${PROPERTY_DOCUMENT_DESCRIPTION_MAX_LENGTH} caracteres.`
    )
    .refine((value) => !/\p{Cc}/u.test(value), "A descrição não pode ter quebra de linha."),
  validUntil: z.string().refine((value) => value === "" || isIsoDate(value), "Data inválida."),
  mimeType: z.enum(
    PROPERTY_DOCUMENT_MIME_TYPES as [PropertyDocumentMimeType, ...PropertyDocumentMimeType[]],
    { error: "Formato não aceito. Envie PDF, JPG, PNG ou WebP." }
  ),
  sizeBytes: z
    .number()
    .int()
    .positive("Arquivo vazio.")
    .max(PROPERTY_DOCUMENT_MAX_BYTES, "O arquivo passa de 10 MB."),
})

export type RegisterPropertyDocumentInput = z.input<typeof registerDocumentSchema>

const requestUploadSchema = registerDocumentSchema.pick({ mimeType: true, sizeBytes: true })

/**
 * Autoriza o envio de UM documento já preparado no navegador: confere quem
 * gerencia o imóvel, formato e tamanho, escolhe o caminho (nome aleatório) e
 * gera o token de envio. O RLS do Storage é testado ao gerar o token.
 */
export async function requestPropertyDocumentUploadAction(
  propertyId: string,
  input: z.input<typeof requestUploadSchema>
): Promise<SignedUploadActionResult> {
  if (!isUuid(propertyId)) {
    return { ok: false, error: "Imóvel inválido." }
  }

  const parsed = requestUploadSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Documento inválido." }
  }

  const loaded = await getPropertyActionContext(propertyId, { requireEdit: false })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, userId, role, property } = loaded.context

  if (!canManageProperty(role, userId, property)) {
    return { ok: false, error: MANAGE_PROPERTY_DENIED_MESSAGE }
  }

  const path = buildPropertyDocumentPath(
    organizationId,
    property.id,
    crypto.randomUUID(),
    parsed.data.mimeType
  )
  const signed = await createSignedUpload(supabase, PROPERTY_DOCUMENTS_BUCKET, path)

  if (!signed.ok) {
    return signed.forbidden
      ? { ok: false, error: UPLOADS_BLOCKED_MESSAGE, blocked: true }
      : { ok: false, error: "Não foi possível autorizar o envio agora. Tente novamente." }
  }

  return { ok: true, data: signed.ticket }
}

/**
 * Registra o documento depois que o navegador enviou o arquivo ao bucket
 * privado com o token de `requestPropertyDocumentUploadAction`. Tamanho e tipo
 * são lidos do bucket (o tamanho gravado é o real); o banco confere de novo
 * quem pode enviar, o caminho e se o arquivo existe. Se o registro falhar, o
 * arquivo sem registro é apagado.
 */
export async function registerPropertyDocumentAction(
  propertyId: string,
  input: RegisterPropertyDocumentInput
): Promise<ActionResult> {
  if (!isUuid(propertyId)) {
    return { ok: false, error: "Imóvel inválido." }
  }

  const parsed = registerDocumentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Documento inválido." }
  }

  const loaded = await getPropertyActionContext(propertyId, { requireEdit: false })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, userId, role, property } = loaded.context

  if (!canManageProperty(role, userId, property)) {
    return { ok: false, error: MANAGE_PROPERTY_DENIED_MESSAGE }
  }

  const { storagePath, kind, description, validUntil, mimeType } = parsed.data

  if (!isPropertyDocumentPath(storagePath, organizationId, property.id, mimeType)) {
    return { ok: false, error: "O caminho do arquivo é inválido." }
  }

  const uploaded = await inspectUploadedObject(supabase, PROPERTY_DOCUMENTS_BUCKET, storagePath, {
    allowedTypes: PROPERTY_DOCUMENT_MIME_TYPES,
    maxBytes: PROPERTY_DOCUMENT_MAX_BYTES,
    expectedType: mimeType,
  })

  if (!uploaded.ok) {
    await discardUnregisteredDocument(supabase, organizationId, storagePath)
    return {
      ok: false,
      error: uploadedObjectProblemMessage(uploaded.problem, {
        formats: DOCUMENT_FORMATS_LABEL,
        maxBytes: PROPERTY_DOCUMENT_MAX_BYTES,
      }),
    }
  }

  const { error } = await supabase.from("property_documents").insert({
    organization_id: organizationId,
    property_id: property.id,
    kind,
    description: description || null,
    valid_until: validUntil || null,
    storage_path: storagePath,
    mime_type: mimeType,
    size_bytes: uploaded.size,
  })

  if (error) {
    await discardUnregisteredDocument(supabase, organizationId, storagePath)
    return { ok: false, error: translateDbError(error, "enviar documentos deste imóvel") }
  }

  revalidatePropertyPaths(property.id)

  return { ok: true, message: "Documento adicionado ao dossiê." }
}

/**
 * URL assinada de curta duração para baixar o documento. O download só é
 * liberado se o acesso ficar registrado (quem baixou e quando).
 */
export async function getPropertyDocumentDownloadUrlAction(
  propertyId: string,
  documentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!isUuid(propertyId) || !isUuid(documentId)) {
    return { ok: false, error: "Documento inválido." }
  }

  const loaded = await getPropertyActionContext(propertyId, { requireEdit: false })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context

  const { data: document, error } = await supabase
    .from("property_documents")
    .select("id, kind, storage_path, mime_type")
    .eq("organization_id", organizationId)
    .eq("property_id", property.id)
    .eq("id", documentId)
    .maybeSingle()

  if (error) {
    return { ok: false, error: translateDbError(error, "baixar este documento") }
  }

  if (!document) {
    return { ok: false, error: "Documento não encontrado. Ele pode ter sido removido." }
  }

  const mimeType = PROPERTY_DOCUMENT_MIME_TYPES.find((type) => type === document.mime_type)

  if (!mimeType) {
    return { ok: false, error: "Formato de documento inválido." }
  }

  const { error: logError } = await supabase.rpc("log_access_event", {
    p_entity: "property_documents",
    p_entity_id: document.id,
    p_action: "download",
  })

  if (logError) {
    console.error("[imoveis] falha ao registrar download do dossiê:", logError.code ?? "erro")
    return {
      ok: false,
      error: "Não foi possível registrar o acesso ao documento. Tente novamente.",
    }
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(PROPERTY_DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, DOWNLOAD_URL_TTL_SECONDS, {
      download: propertyDocumentFileName(document.kind, property.code, mimeType),
    })

  if (signError || !signed?.signedUrl) {
    return { ok: false, error: "Não foi possível gerar o link de download. Tente novamente." }
  }

  return { ok: true, url: signed.signedUrl }
}

/** Remove o documento: a linha e o arquivo no bucket. */
export async function deletePropertyDocumentAction(
  propertyId: string,
  documentId: string
): Promise<ActionResult> {
  if (!isUuid(propertyId) || !isUuid(documentId)) {
    return { ok: false, error: "Documento inválido." }
  }

  const loaded = await getPropertyActionContext(propertyId, { requireEdit: false })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, userId, role, property } = loaded.context

  if (!canManageProperty(role, userId, property)) {
    return { ok: false, error: MANAGE_PROPERTY_DENIED_MESSAGE }
  }

  const { data, error } = await supabase
    .from("property_documents")
    .delete()
    .eq("organization_id", organizationId)
    .eq("property_id", property.id)
    .eq("id", documentId)
    .select("storage_path")

  if (error) {
    return { ok: false, error: translateDbError(error, "remover documentos deste imóvel") }
  }

  const removed = data?.[0]

  if (!removed) {
    return { ok: false, error: "Documento não encontrado. Ele pode já ter sido removido." }
  }

  const { error: storageError } = await supabase.storage
    .from(PROPERTY_DOCUMENTS_BUCKET)
    .remove([removed.storage_path])

  if (storageError) {
    console.error("[imoveis] documento excluído, mas o arquivo ficou no bucket:", storageError.name)
  }

  revalidatePropertyPaths(property.id)

  return { ok: true, message: "Documento removido do dossiê." }
}
