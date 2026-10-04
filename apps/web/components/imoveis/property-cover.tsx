import { HouseIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { FallbackImage } from "@/components/media/fallback-image"
import { getPropertyPhotoUrls } from "@/lib/media/paths"

/**
 * Foto do imóvel pela URL pública do bucket, com <img> simples (sem next/image
 * nem o otimizador da Vercel).
 * - `thumb` (padrão): miniatura WebP de 400 px, para listas e cards.
 * - `responsive`: `srcset` com miniatura e principal; o navegador escolhe pelo `sizes`.
 * Fotos antigas sem miniatura caem para a principal.
 */
export function PropertyCover({
  storagePath,
  alt,
  className,
  variant = "thumb",
  sizes = "100vw",
}: {
  storagePath: string | null | undefined
  alt: string
  className?: string
  variant?: "thumb" | "responsive"
  /** Largura exibida, para o `srcset` da variante `responsive`. */
  sizes?: string
}) {
  const photo = getPropertyPhotoUrls(storagePath)

  if (!photo.main || !photo.thumb) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md bg-muted text-muted-foreground",
          className
        )}
        aria-hidden="true"
      >
        <HouseIcon />
      </div>
    )
  }

  const responsive = variant === "responsive"

  return (
    <FallbackImage
      src={responsive ? photo.main : photo.thumb}
      srcSet={responsive ? photo.srcSet : undefined}
      sizes={responsive ? sizes : undefined}
      fallbackSrc={photo.main}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("rounded-md object-cover", className)}
    />
  )
}
