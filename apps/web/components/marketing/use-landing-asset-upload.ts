"use client"

import * as React from "react"

import { formatBytes, formatSizeChange } from "@workspace/core/media/format"

import {
  confirmLandingAssetUploadAction,
  requestLandingAssetUploadAction,
} from "@/lib/marketing/asset-upload-actions"
import { LANDING_ASSETS_BUCKET, LANDING_MAX_IMAGE_BYTES } from "@/lib/marketing/constants"
import { translateLandingStorageError } from "@/lib/marketing/errors"
import { getImagePreparationMessage, prepareImage } from "@/lib/media/compress-image"
import { UPLOADS_BLOCKED_MESSAGE, isStorageForbiddenError } from "@/lib/media/upload-errors"
import { uploadWithTicket } from "@/lib/storage/signed-upload-client"

/** `banner`: JPEG até 1920 px (fundo, banners, compartilhamento). `logo`: até 512 px com transparência. */
export type LandingAssetKind = "banner" | "logo"

export type LandingUploadPhase = "optimizing" | "uploading"

export type LandingUploadResult =
  { ok: true; path: string; sizeLabel: string } | { ok: false; error: string }

/**
 * Otimiza a imagem no navegador e envia ao bucket landing-assets com um token
 * de URL assinada: a Server Action confere o papel e a página e escolhe o
 * caminho {organization_id}/landing/{page_id}/{uuid}.{ext}; o navegador envia
 * sem sessão; outra Server Action confere tamanho e tipo gravados. O caminho é
 * conferido de novo pela Server Action que salva a seção.
 */
export function useLandingAssetUpload({
  pageId,
  uploadsBlocked = false,
}: {
  /** Não é mais usado: o caminho do arquivo é decidido no servidor. */
  organizationId?: string
  pageId: string
  /** Assinatura em modo leitura: não tenta enviar. */
  uploadsBlocked?: boolean
}) {
  const [pendingCount, setPendingCount] = React.useState(0)
  const [phase, setPhase] = React.useState<LandingUploadPhase | null>(null)

  const upload = React.useCallback(
    async (file: File, kind: LandingAssetKind = "banner"): Promise<LandingUploadResult> => {
      if (uploadsBlocked) {
        return { ok: false, error: UPLOADS_BLOCKED_MESSAGE }
      }

      setPendingCount((count) => count + 1)
      setPhase("optimizing")

      try {
        let prepared: Awaited<ReturnType<typeof prepareImage>>
        try {
          prepared = await prepareImage(file, kind === "logo" ? "landingLogo" : "landingBanner")
        } catch (error) {
          return { ok: false, error: getImagePreparationMessage(error) }
        }

        const { main } = prepared
        if (main.bytes > LANDING_MAX_IMAGE_BYTES) {
          return {
            ok: false,
            error: `Mesmo otimizada, a imagem tem ${formatBytes(main.bytes)}; o limite é ${formatBytes(LANDING_MAX_IMAGE_BYTES)}.`,
          }
        }

        setPhase("uploading")

        const ticket = await requestLandingAssetUploadAction(pageId, {
          extension: main.extension,
        })

        if (!ticket.ok) {
          return { ok: false, error: ticket.error }
        }

        const { error } = await uploadWithTicket(LANDING_ASSETS_BUCKET, ticket.data, main.blob, {
          contentType: main.type,
          cacheControl: "31536000",
        })

        if (error) {
          return {
            ok: false,
            error: isStorageForbiddenError(error)
              ? UPLOADS_BLOCKED_MESSAGE
              : translateLandingStorageError(error, "enviar imagens para esta landing page"),
          }
        }

        const confirmed = await confirmLandingAssetUploadAction(pageId, ticket.data.path)

        if (!confirmed.ok) {
          return { ok: false, error: confirmed.error }
        }

        return {
          ok: true,
          path: ticket.data.path,
          sizeLabel: formatSizeChange(file.size, main.bytes),
        }
      } catch {
        return {
          ok: false,
          error: "Não foi possível enviar a imagem agora. Tente novamente.",
        }
      } finally {
        setPendingCount((count) => Math.max(0, count - 1))
        setPhase(null)
      }
    },
    [pageId, uploadsBlocked]
  )

  return { upload, isUploading: pendingCount > 0, phase }
}
