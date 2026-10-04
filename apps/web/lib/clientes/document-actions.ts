"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { CLIENT_DOCUMENT_PDF_MAX_BYTES } from "@workspace/core/media/limits"
import { uploadedObjectProblemMessage } from "@workspace/core/media/uploaded-object"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import type { ActionResultWithData } from "@/lib/clientes/action-result"
import {
  CLIENT_DOCUMENT_MAX_BYTES,
  CLIENT_DOCUMENT_MIME_TYPES,
  CLIENT_DOCUMENT_SIGNED_URL_TTL,
  CLIENT_DOCUMENTS_BUCKET,
  CLIENTS_PATH,
} from "@/lib/clientes/constants"
import { permissionDeniedMessage, translateDatabaseError } from "@/lib/clientes/db-errors"
import { buildClientDocumentPath, type ClientDocumentMimeType } from "@/lib/clientes/documents"
import { canDeleteClientData } from "@/lib/clientes/permissions"
import { UPLOADS_BLOCKED_MESSAGE } from "@/lib/media/upload-errors"
import {
  createSignedUpload,
  inspectUploadedObject,
  removeUnregisteredUploads,
} from "@/lib/storage/signed-upload"
import type { SignedUploadActionResult } from "@/lib/storage/signed-upload-ticket"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.guid()

const UPLOAD_ACTION = "enviar documentos deste cliente"

const documentFileSchema = z
  .object({
    clientId: z.guid(),
    name: z.string().trim().min(1, "Arquivo sem nome.").max(200, "Nome de arquivo longo demais."),
    mimeType: z.enum(CLIENT_DOCUMENT_MIME_TYPES, {
      error: "Formato não aceito. Envie PDF, JPG, PNG ou WebP.",
    }),
    sizeBytes: z
      .number()
      .int()
      .positive("Arquivo vazio.")
      .max(CLIENT_DOCUMENT_MAX_BYTES, "O arquivo passa de 20 MB."),
  })
  .refine(
    (input) =>
      input.mimeType !== "application/pdf" || input.sizeBytes <= CLIENT_DOCUMENT_PDF_MAX_BYTES,
    {
      message: "O PDF passa de 10 MB. Gere uma versão reduzida e envie de novo.",
      path: ["sizeBytes"],
    }
  )

const registerDocumentSchema = documentFileSchema.and(
  z.object({ storagePath: z.string().min(1).max(512) })
)

export type RequestClientDocumentUploadInput = z.input<typeof documentFileSchema>
export type RegisterClientDocumentInput = z.input<typeof registerDocumentSchema>

/** PDF até 10 MB; imagem até o limite geral (o bucket ainda aplica o dele). */
function maxBytesFor(mimeType: ClientDocumentMimeType) {
  return mimeType === "application/pdf" ? CLIENT_DOCUMENT_PDF_MAX_BYTES : CLIENT_DOCUMENT_MAX_BYTES
}

/**
 * Autoriza o envio de UM documento já preparado no navegador: confere o papel,
 * formato e tamanho, escolhe o caminho `{org}/clients/{cliente}/{uuid}-{nome}`
 * e gera o token de envio. O RLS do Storage (quem edita o cliente e assinatura
 * fora do modo leitura) é testado pelo próprio Storage ao gerar o token.
 */
export async function requestClientDocumentUpload(
  input: RequestClientDocumentUploadInput
): Promise<SignedUploadActionResult> {
  const parsed = documentFileSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Arquivo inválido." }
  }

  const { membership } = await requireMembership()

  if (membership.role === "finance") {
    return { ok: false, error: permissionDeniedMessage(UPLOAD_ACTION) }
  }

  const { clientId, name } = parsed.data
  const path = buildClientDocumentPath(
    membership.organizationId,
    clientId,
    name,
    crypto.randomUUID()
  )
  const supabase = await createClient()
  const signed = await createSignedUpload(supabase, CLIENT_DOCUMENTS_BUCKET, path)

  if (!signed.ok) {
    return signed.forbidden
      ? { ok: false, error: UPLOADS_BLOCKED_MESSAGE, blocked: true }
      : { ok: false, error: "Não foi possível autorizar o envio agora. Tente novamente." }
  }

  return { ok: true, data: signed.ticket }
}

/**
 * Apaga o arquivo enviado se nenhuma linha o registra. O RLS do bucket também
 * só deixa o autor apagar arquivo sem registro (dono e gerente apagam qualquer um).
 */
async function discardUnregisteredDocument(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  storagePath: string
) {
  const { data, error } = await supabase
    .from("client_documents")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("storage_path", storagePath)
    .limit(1)

  if (error || (data?.length ?? 0) > 0) return

  await removeUnregisteredUploads(supabase, CLIENT_DOCUMENTS_BUCKET, [storagePath])
}

/**
 * Registra a linha do documento depois que o navegador enviou o arquivo ao
 * bucket privado com o token de `requestClientDocumentUpload`. O caminho
 * precisa ser da imobiliária e do cliente informados; tamanho e tipo são lidos
 * do bucket. Se o registro falhar, o arquivo sem registro é apagado.
 */
export async function registerClientDocument(
  input: RegisterClientDocumentInput
): Promise<ActionResult> {
  const parsed = registerDocumentSchema.safeParse(input)

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Arquivo inválido.",
    }
  }

  const { membership } = await requireMembership()

  if (membership.role === "finance") {
    return { ok: false, error: permissionDeniedMessage(UPLOAD_ACTION) }
  }

  const { clientId, storagePath, name, mimeType } = parsed.data
  const prefix = `${membership.organizationId}/clients/${clientId}/`
  const fileSegment = storagePath.slice(prefix.length)

  if (!storagePath.startsWith(prefix) || !fileSegment || fileSegment.includes("/")) {
    return { ok: false, error: "O caminho do arquivo é inválido." }
  }

  const supabase = await createClient()
  const maxBytes = maxBytesFor(mimeType)
  const uploaded = await inspectUploadedObject(supabase, CLIENT_DOCUMENTS_BUCKET, storagePath, {
    allowedTypes: CLIENT_DOCUMENT_MIME_TYPES,
    maxBytes,
    expectedType: mimeType,
  })

  if (!uploaded.ok) {
    await discardUnregisteredDocument(supabase, membership.organizationId, storagePath)
    return {
      ok: false,
      error: uploadedObjectProblemMessage(uploaded.problem, {
        formats: "PDF, JPG, PNG ou WebP",
        maxBytes,
      }),
    }
  }

  const { error } = await supabase.from("client_documents").insert({
    organization_id: membership.organizationId,
    client_id: clientId,
    name,
    storage_path: storagePath,
    mime_type: mimeType,
    size_bytes: uploaded.size,
  })

  if (error) {
    await discardUnregisteredDocument(supabase, membership.organizationId, storagePath)
    return { ok: false, error: translateDatabaseError(error, UPLOAD_ACTION) }
  }

  revalidatePath(`${CLIENTS_PATH}/${clientId}`)

  return { ok: true, message: "Documento enviado." }
}

/**
 * URL assinada de curta duração para baixar o documento. O download só é
 * liberado se o acesso for registrado (LGPD).
 */
export async function getClientDocumentDownloadUrl(
  documentId: string
): Promise<ActionResultWithData<{ url: string }>> {
  if (!idSchema.safeParse(documentId).success) {
    return { ok: false, error: "Documento inválido." }
  }

  const { membership } = await requireMembership()
  const supabase = await createClient()
  const { data: document, error } = await supabase
    .from("client_documents")
    .select("id, name, storage_path")
    .eq("id", documentId)
    .eq("organization_id", membership.organizationId)
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "baixar este documento"),
    }
  }

  if (!document) {
    return {
      ok: false,
      error: "Documento não encontrado. Ele pode ter sido removido.",
    }
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(CLIENT_DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, CLIENT_DOCUMENT_SIGNED_URL_TTL, {
      download: document.name,
    })

  if (signError || !signed?.signedUrl) {
    return {
      ok: false,
      error: "Não foi possível gerar o link de download. Tente novamente.",
    }
  }

  const { error: logError } = await supabase.rpc("log_access_event", {
    p_entity: "client_documents",
    p_entity_id: document.id,
    p_action: "download",
  })

  if (logError) {
    console.error("[clientes] falha ao registrar download de documento:", logError.code ?? "erro")
    return {
      ok: false,
      error: "Não foi possível registrar o acesso ao documento. Tente novamente.",
    }
  }

  return { ok: true, data: { url: signed.signedUrl } }
}

/** Remove o documento (dono/gerente): a linha e o arquivo no Storage. */
export async function deleteClientDocument(
  documentId: string,
  clientId: string
): Promise<ActionResult> {
  if (!idSchema.safeParse(documentId).success || !idSchema.safeParse(clientId).success) {
    return { ok: false, error: "Documento inválido." }
  }

  const { membership } = await requireMembership()
  const action = "remover documentos"

  if (!canDeleteClientData(membership.role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("client_documents")
    .delete()
    .eq("id", documentId)
    .eq("client_id", clientId)
    .eq("organization_id", membership.organizationId)
    .select("storage_path")

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  const removed = data[0]

  if (!removed) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const { error: storageError } = await supabase.storage
    .from(CLIENT_DOCUMENTS_BUCKET)
    .remove([removed.storage_path])

  if (storageError) {
    console.error(
      "[clientes] documento excluído, mas o arquivo ficou no Storage:",
      storageError.name
    )
  }

  revalidatePath(`${CLIENTS_PATH}/${clientId}`)

  return { ok: true, message: "Documento removido." }
}
