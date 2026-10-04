import "server-only"

import { LISTING_PHOTO_MAX_BYTES } from "@workspace/core/billing/plans"
import { IMAGE_PRESETS } from "@workspace/core/media/image-sizing"

/**
 * Otimização da foto baixada por link, no servidor, no mesmo formato do upload
 * pelo navegador: JPEG de até 1600 px sem EXIF/GPS (fundo branco sob
 * transparência) e miniatura WebP de 400 px ao lado. A foto final respeita
 * LISTING_PHOTO_MAX_BYTES (2 MB, o limite do bucket property-media).
 */

/** Imagem gigante (bomba de descompressão) é recusada antes de decodificar tudo. */
const MAX_INPUT_PIXELS = 60_000_000

const MAIN_ATTEMPTS = [
  { size: IMAGE_PRESETS.propertyPhoto.maxDimension, quality: 82 },
  { size: IMAGE_PRESETS.propertyPhoto.maxDimension, quality: 70 },
  { size: 1280, quality: 65 },
  { size: IMAGE_PRESETS.propertyPhoto.minDimension, quality: 60 },
] as const

export type OptimizedPhoto = { main: Buffer; thumb: Buffer | null }

export async function optimizeImportedPhoto(input: Buffer): Promise<OptimizedPhoto | null> {
  const { default: sharp } = await import("sharp")

  const open = () =>
    sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false }).rotate()

  try {
    for (const attempt of MAIN_ATTEMPTS) {
      const main = await open()
        .resize({
          width: attempt.size,
          height: attempt.size,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: IMAGE_PRESETS.propertyPhoto.background ?? "#ffffff" })
        .jpeg({ quality: attempt.quality, mozjpeg: true })
        .toBuffer()

      if (main.byteLength <= LISTING_PHOTO_MAX_BYTES) {
        const thumb = await open()
          .resize({
            width: IMAGE_PRESETS.propertyThumb.maxDimension,
            height: IMAGE_PRESETS.propertyThumb.maxDimension,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: Math.round(IMAGE_PRESETS.propertyThumb.quality * 100) })
          .toBuffer()
          .catch(() => null)

        return { main, thumb }
      }
    }
  } catch {
    return null
  }

  return null
}
