import { HouseIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { FallbackImage } from "@/components/media/fallback-image"
import type { PublicPropertyPhoto } from "@/lib/imovel-publico/view-model"

const SIZES = "(min-width: 1024px) 640px, (min-width: 640px) 70vw, 88vw"

/**
 * <img> simples, nunca next/image (o domínio do Storage e o das fotos
 * importadas não passam pelo otimizador). Fotos do Storage usam o `srcset` com
 * a miniatura e caem para a principal se ela faltar; fotos externas saem sem
 * Referer (sites de origem costumam bloquear links diretos).
 */
function Photo({ photo, priority }: { photo: PublicPropertyPhoto; priority: boolean }) {
  const common = {
    alt: photo.alt,
    loading: priority ? ("eager" as const) : ("lazy" as const),
    fetchPriority: priority ? ("high" as const) : ("auto" as const),
    decoding: "async" as const,
    className: "size-full object-cover",
  }

  if (photo.external) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- foto hospedada na origem do imóvel importado: sem otimizador e sem Referer.
      <img src={photo.src} referrerPolicy="no-referrer" {...common} />
    )
  }

  return (
    <FallbackImage
      src={photo.src}
      srcSet={photo.srcSet ?? undefined}
      sizes={photo.srcSet ? SIZES : undefined}
      fallbackSrc={photo.fallbackSrc}
      {...common}
    />
  )
}

/**
 * Galeria em faixa com rolagem horizontal (toque, trackpad e teclado), em
 * qualquer largura: todas as fotos ficam acessíveis sem script.
 */
export function PropertyGallery({
  photos,
  title,
}: {
  photos: PublicPropertyPhoto[]
  title: string
}) {
  if (photos.length === 0) {
    return (
      <div
        className="flex h-40 w-full items-center justify-center rounded-xl bg-muted text-muted-foreground sm:h-56"
        aria-hidden="true"
      >
        <HouseIcon className="size-10" />
      </div>
    )
  }

  const single = photos.length === 1

  return (
    <div className="flex flex-col gap-2">
      <div
        role="region"
        aria-label={`Fotos de ${title}`}
        tabIndex={0}
        className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:mx-0 sm:px-0"
      >
        {photos.map((photo, index) => (
          <figure
            key={`${index}-${photo.src}`}
            className={cn(
              "relative aspect-4/3 shrink-0 snap-start overflow-hidden rounded-xl bg-muted",
              single ? "w-full sm:aspect-video" : "w-[88%] sm:w-[70%] lg:w-[640px]"
            )}
          >
            <Photo photo={photo} priority={index === 0} />
          </figure>
        ))}
      </div>
      {single ? null : (
        <p className="text-sm text-muted-foreground">
          {photos.length} fotos. Deslize para ver todas.
        </p>
      )}
    </div>
  )
}
