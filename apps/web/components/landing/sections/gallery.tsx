import { ImageIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { LandingImage, MediaFallback, lpFocus, type LandingMode } from "./primitives"

export type GalleryImage = { url: string; alt: string }

/**
 * Galeria: faixa com rolagem horizontal no mobile (acessível por teclado) e
 * mosaico a partir de @3xl. Com 3 ou 5 imagens a primeira ganha destaque;
 * nas demais quantidades a grade é uniforme.
 * Sem imagens: some na página pública; na pré-visualização mostra os espaços.
 */
export function Gallery({
  images,
  mode,
  label,
  placeholderCount = 3,
  placeholderLabel = "Imagem",
}: {
  images: GalleryImage[]
  mode: LandingMode
  /** Nome acessível da região rolável. */
  label: string
  placeholderCount?: number
  placeholderLabel?: string
}) {
  const placeholders =
    images.length === 0 && mode === "preview"
      ? Array.from({ length: Math.max(1, placeholderCount) }, (_, index) => index + 1)
      : []
  const count = images.length || placeholders.length

  if (count === 0) return null

  const featured = count === 3 || count === 5
  const itemClass = (index: number) =>
    cn(
      "relative aspect-4/3 w-[82%] shrink-0 snap-start overflow-hidden rounded-(--lp-radius) bg-(--lp-surface-alt) @3xl:w-auto",
      count === 1 && "@3xl:aspect-video",
      featured && index === 0 && "@3xl:col-span-2 @3xl:row-span-2 @3xl:aspect-auto"
    )

  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 @3xl:mx-0 @3xl:grid @3xl:gap-4 @3xl:overflow-visible @3xl:px-0 @3xl:pb-0",
        count === 1 && "@3xl:grid-cols-1",
        (count === 2 || count === 4) && "@3xl:grid-cols-2",
        count === 3 && "@3xl:grid-cols-3",
        count === 5 && "@3xl:grid-cols-4",
        count >= 6 && "@3xl:grid-cols-3",
        lpFocus
      )}
    >
      {images.length > 0
        ? images.map((image, index) => (
            <figure key={`${index}-${image.url}`} className={itemClass(index)}>
              <LandingImage
                src={image.url}
                alt={image.alt}
                width={1200}
                height={900}
                sizes="(min-width: 768px) 50vw, 82vw"
                className="size-full"
              />
            </figure>
          ))
        : placeholders.map((slot, index) => (
            <figure key={slot} className={itemClass(index)}>
              <MediaFallback
                icon={ImageIcon}
                label={`${placeholderLabel} ${slot}`}
                className="size-full"
              />
            </figure>
          ))}
    </div>
  )
}
