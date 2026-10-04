"use server"

import {
  expectedContentTypeForPath,
  uploadedObjectProblemMessage,
} from "@workspace/core/media/uploaded-object"

import { requireMembership } from "@/lib/auth/session"
import { isUuid } from "@/lib/imoveis/ids"
import { isLandingAssetPath } from "@/lib/marketing/asset-url"
import {
  LANDING_ACCEPTED_IMAGE_TYPES,
  LANDING_ASSETS_BUCKET,
  LANDING_MAX_IMAGE_BYTES,
} from "@/lib/marketing/constants"
import { LANDING_PERMISSION_MESSAGE } from "@/lib/marketing/errors"
import { canEditLandingPages } from "@/lib/marketing/permissions"
import { getLandingPageRow } from "@/lib/marketing/queries"
import { UPLOADS_BLOCKED_MESSAGE } from "@/lib/media/upload-errors"
import {
  createSignedUpload,
  inspectUploadedObject,
  removeUnregisteredUploads,
} from "@/lib/storage/signed-upload"
import type { SignedUploadActionResult } from "@/lib/storage/signed-upload-ticket"
import { createClient } from "@/lib/supabase/server"

const LANDING_CONTENT_TYPES = Object.keys(LANDING_ACCEPTED_IMAGE_TYPES)
const LANDING_EXTENSIONS = new Set(Object.values(LANDING_ACCEPTED_IMAGE_TYPES))

/** Papel de editor e landing page da imobiliária atual (o RLS continua valendo). */
async function getUploadContext(pageId: string) {
  const { membership } = await requireMembership()

  if (!canEditLandingPages(membership.role)) {
    return { ok: false as const, error: LANDING_PERMISSION_MESSAGE }
  }
  if (!isUuid(pageId)) {
    return { ok: false as const, error: "Landing page inválida." }
  }

  const supabase = await createClient()

  try {
    const row = await getLandingPageRow(supabase, membership.organizationId, pageId)

    if (!row) {
      return { ok: false as const, error: "Landing page não encontrada nesta imobiliária." }
    }

    return {
      ok: true as const,
      supabase,
      organizationId: membership.organizationId,
      pageId: row.id,
    }
  } catch {
    return {
      ok: false as const,
      error: "Não foi possível carregar a landing page agora. Tente novamente.",
    }
  }
}

/**
 * Autoriza o envio de UMA imagem já otimizada no navegador para a landing
 * page: caminho `{org}/landing/{página}/{uuid}.{ext}` decidido aqui e token de
 * envio. O RLS do bucket (papel e assinatura fora do modo leitura) é testado
 * pelo Storage ao gerar o token.
 */
export async function requestLandingAssetUploadAction(
  pageId: string,
  input: { extension: string }
): Promise<SignedUploadActionResult> {
  const extension = String(input?.extension ?? "").toLowerCase()

  if (!LANDING_EXTENSIONS.has(extension)) {
    return { ok: false, error: "Formato não aceito. Envie JPG, PNG ou WebP." }
  }

  const context = await getUploadContext(pageId)
  if (!context.ok) return context

  const path = `${context.organizationId}/landing/${context.pageId}/${crypto.randomUUID()}.${extension}`
  const signed = await createSignedUpload(context.supabase, LANDING_ASSETS_BUCKET, path)

  if (!signed.ok) {
    return signed.forbidden
      ? { ok: false, error: UPLOADS_BLOCKED_MESSAGE, blocked: true }
      : { ok: false, error: "Não foi possível autorizar o envio agora. Tente novamente." }
  }

  return { ok: true, data: signed.ticket }
}

/**
 * Confere no bucket o tamanho e o tipo da imagem enviada com o token. Se não
 * passar, apaga o arquivo (a página ainda não o referencia).
 */
export async function confirmLandingAssetUploadAction(
  pageId: string,
  path: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const context = await getUploadContext(pageId)
  if (!context.ok) return context

  if (!isLandingAssetPath(path, context.organizationId, context.pageId)) {
    return { ok: false, error: "O caminho da imagem é inválido." }
  }

  const uploaded = await inspectUploadedObject(context.supabase, LANDING_ASSETS_BUCKET, path, {
    allowedTypes: LANDING_CONTENT_TYPES,
    maxBytes: LANDING_MAX_IMAGE_BYTES,
    expectedType: expectedContentTypeForPath(path),
  })

  if (!uploaded.ok) {
    await removeUnregisteredUploads(context.supabase, LANDING_ASSETS_BUCKET, [path])
    return {
      ok: false,
      error: uploadedObjectProblemMessage(uploaded.problem, {
        formats: "JPG, PNG ou WebP",
        maxBytes: LANDING_MAX_IMAGE_BYTES,
      }),
    }
  }

  return { ok: true }
}
