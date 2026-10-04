import { cn } from "@workspace/ui/lib/utils"

import { LandingImage, MediaFallback, type LandingMode } from "./primitives"

/**
 * Fundo do hero: foto com véu (`--lp-scrim`) ou, sem foto, a base escura do
 * tema. O conteúdo por cima usa `text-(--lp-on-scrim)`.
 *
 * Véu (regra 5 de lib/landing/theme.ts): 72% de opacidade garante texto
 * branco ≥ 4.5:1 sobre qualquer pixel.
 * - full: 72% em toda a área.
 * - left: 72% no mobile; a partir de @5xl, 85% → 72% até 65% da largura →
 *   30% na borda direita. Use só quando o texto fica na coluna esquerda e a
 *   direita tem elementos com fundo próprio (ex.: cartão do formulário).
 */
export function HeroBackdrop({
  imageUrl,
  alt = "",
  scrim = "full",
  mode,
  fallbackLabel,
}: {
  imageUrl: string | null
  /** Vazio quando a imagem é decorativa; descreva quando é a foto do imóvel. */
  alt?: string
  scrim?: "full" | "left"
  mode: LandingMode
  /** Nome do espaço de imagem, mostrado só na pré-visualização. */
  fallbackLabel?: string
}) {
  if (!imageUrl) {
    return (
      <div className="absolute inset-0 -z-10">
        <MediaFallback
          tone="scrim"
          className="size-full"
          label={mode === "preview" ? fallbackLabel : null}
        />
      </div>
    )
  }

  return (
    <div className="absolute inset-0 -z-10 bg-(--lp-scrim)">
      <LandingImage
        src={imageUrl}
        alt={alt}
        width={1920}
        height={1280}
        priority
        sizes="100vw"
        className="size-full"
      />
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-(--lp-scrim)/72",
          scrim === "left" &&
            "@5xl:bg-transparent @5xl:bg-linear-to-r @5xl:from-(--lp-scrim)/85 @5xl:via-(--lp-scrim)/72 @5xl:via-65% @5xl:to-(--lp-scrim)/30"
        )}
      />
    </div>
  )
}
