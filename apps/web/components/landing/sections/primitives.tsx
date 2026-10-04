import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { FallbackImage } from "@/components/media/fallback-image"

/** Âncora do formulário de lead (CTAs e barra fixa rolam até aqui). */
export const LEAD_FORM_ANCHOR = "lead-form"

export type LandingMode = "public" | "preview"

/**
 * Tom do fundo onde um bloco está: define as cores de texto seguras.
 * - surface: página clara (`--lp-ink`)
 * - dark: faixa da cor secundária (`--lp-on-secondary`)
 * - scrim: sobre foto com véu ou fundo escuro de hero (`--lp-on-scrim`, branco)
 */
export type LandingTone = "surface" | "dark" | "scrim"

export const toneText: Record<LandingTone, string> = {
  surface: "text-(--lp-ink)",
  dark: "text-(--lp-on-secondary)",
  scrim: "text-(--lp-on-scrim)",
}

/** Texto de apoio legível (≥ 4.5:1) em cada tom. Sobre foto não há "apagado". */
export const toneMuted: Record<LandingTone, string> = {
  surface: "text-(--lp-ink-muted)",
  dark: "text-(--lp-on-secondary-muted)",
  scrim: "text-(--lp-on-scrim)",
}

// ---------------------------------------------------------------------------
// Classes compartilhadas (tokens --lp-* definidos em lib/landing/theme.ts)
// ---------------------------------------------------------------------------

/** Foco visível sobre superfícies claras (anel ≥ 3:1). */
export const lpFocus =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--lp-focus)"

/** Foco visível sobre fundos escuros, fotos e faixas da marca (usa a cor do texto). */
export const lpFocusInverse =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"

/**
 * Anel de foco em dois tons (tinta escura por dentro, branco por fora): visível
 * em qualquer fundo. Para elementos cuja cor de texto não é a do fundo ao redor.
 */
export const lpFocusTwoTone =
  "outline-none focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-(--lp-ink) focus-visible:shadow-[0_0_0_6px_var(--lp-surface)]"

export type LpButtonTone =
  "primary" | "accent" | "secondary" | "light" | "outline" | "outline-inverse"

const toneClasses: Record<LpButtonTone, string> = {
  primary: cn("bg-(--lp-primary) text-(--lp-on-primary) hover:bg-(--lp-primary-hover)", lpFocus),
  accent: cn("bg-(--lp-accent) text-(--lp-on-accent) hover:bg-(--lp-accent-hover)", lpFocus),
  secondary: cn(
    "bg-(--lp-secondary) text-(--lp-on-secondary) hover:bg-(--lp-secondary-hover)",
    lpFocus
  ),
  // Sobre foto/faixa da marca (fundo claro ou escuro): anel em dois tons.
  light: cn("bg-(--lp-surface) text-(--lp-ink) hover:bg-(--lp-primary-soft)", lpFocusTwoTone),
  outline: cn(
    "border border-(--lp-primary-border) bg-transparent text-(--lp-primary-text) hover:bg-(--lp-primary-soft)",
    lpFocus
  ),
  "outline-inverse": cn(
    "border border-current bg-transparent text-inherit hover:bg-white/10",
    lpFocusInverse
  ),
}

/** Botão/link de ação das landing pages (alvo de toque ≥ 44px). */
export function lpButtonClass({
  tone = "primary",
  size = "md",
  className,
}: {
  tone?: LpButtonTone
  size?: "md" | "lg"
  className?: string
} = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-(--lp-radius) text-center font-semibold text-balance motion-safe:transition-colors [&_svg]:size-[1.1em] [&_svg]:shrink-0",
    size === "md" ? "min-h-11 px-5 py-2 text-[0.9375rem]" : "min-h-13 px-7 py-3 text-base",
    toneClasses[tone],
    className
  )
}

export const lpDisplayFont = "font-sans"
export const lpSerifFont = "font-sans"

// ---------------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------------

export type SectionTone = "surface" | "alt" | "dark" | "brand"

const sectionTones: Record<SectionTone, string> = {
  surface: "bg-(--lp-surface) text-(--lp-ink)",
  alt: "bg-(--lp-surface-alt) text-(--lp-ink)",
  dark: "bg-(--lp-secondary) text-(--lp-on-secondary)",
  brand: "bg-(--lp-primary) text-(--lp-on-primary)",
}

export function Section({
  id,
  labelledBy,
  tone = "surface",
  width = "default",
  className,
  innerClassName,
  children,
}: {
  id?: string
  labelledBy?: string
  tone?: SectionTone
  width?: "default" | "narrow" | "wide"
  className?: string
  innerClassName?: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("scroll-mt-4 px-4 py-14 @3xl:px-8 @3xl:py-20", sectionTones[tone], className)}
    >
      <div
        className={cn(
          "mx-auto w-full",
          width === "narrow" && "max-w-3xl",
          width === "default" && "max-w-6xl",
          width === "wide" && "max-w-7xl",
          innerClassName
        )}
      >
        {children}
      </div>
    </section>
  )
}

export function SectionHeading({
  id,
  title,
  description,
  font = "sans",
  align = "start",
  tone = "surface",
  className,
}: {
  id: string
  title: ReactNode
  description?: ReactNode
  font?: "sans" | "display" | "serif"
  align?: "start" | "center"
  tone?: LandingTone
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex max-w-2xl flex-col gap-3",
        align === "center" && "mx-auto items-center text-center",
        className
      )}
    >
      <h2
        id={id}
        className={cn(
          "text-[1.75rem] leading-[1.12] font-semibold tracking-tight text-balance @3xl:text-[2.375rem]",
          font === "display" && cn(lpDisplayFont, "font-bold tracking-tight"),
          font === "serif" && cn(lpSerifFont, "leading-[1.05] font-medium tracking-normal")
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className={cn("text-base leading-relaxed text-pretty", toneMuted[tone])}>
          {description}
        </p>
      ) : null}
    </div>
  )
}

/** Texto com parágrafos separados por linha em branco. */
export function Paragraphs({ text, className }: { text: string; className?: string }) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  return (
    <div className={cn("flex max-w-[68ch] flex-col gap-4 leading-relaxed", className)}>
      {blocks.map((block, index) => (
        <p key={index} className="text-pretty whitespace-pre-line">
          {block}
        </p>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------

/**
 * <img> simples: o domínio do Storage não está em images.remotePatterns, então
 * next/image não pode ser usado (e o otimizador da Vercel custaria caro).
 * `priority` só na imagem principal do hero (eager + fetchpriority high);
 * `eager` para o logo do cabeçalho. `fallbackSrc`: URL usada se `src` falhar
 * (miniatura `__thumb.webp` que não existe em fotos antigas).
 */
export function LandingImage({
  src,
  alt,
  width,
  height,
  priority = false,
  eager = false,
  fit = "cover",
  sizes,
  fallbackSrc,
  className,
}: {
  src: string
  alt: string
  width: number
  height: number
  priority?: boolean
  eager?: boolean
  fit?: "cover" | "contain"
  sizes?: string
  fallbackSrc?: string | null
  className?: string
}) {
  const imageProps = {
    src,
    alt,
    width,
    height,
    sizes,
    loading: priority || eager ? ("eager" as const) : ("lazy" as const),
    decoding: "async" as const,
    fetchPriority: priority ? ("high" as const) : ("auto" as const),
    className: cn(fit === "cover" ? "object-cover" : "object-contain", className),
  }

  if (fallbackSrc && fallbackSrc !== src) {
    return <FallbackImage {...imageProps} fallbackSrc={fallbackSrc} />
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...imageProps} />
  )
}

/**
 * Fundo com as cores do tema quando falta imagem.
 * - `scrim`: base escura do véu com brilho da marca a no máx. 28% — texto branco
 *   por cima continua ≥ 4.5:1 (mesma garantia do véu sobre foto).
 * - `brand`: gradiente da marca, só decorativo (nada de texto direto por cima).
 * `label` (use só em pré-visualização) aparece numa etiqueta clara legível.
 */
export function MediaFallback({
  tone = "brand",
  icon: Icon,
  label,
  className,
}: {
  tone?: "scrim" | "brand"
  icon?: LucideIcon
  label?: string | null
  className?: string
}) {
  return (
    <div
      aria-hidden={label ? undefined : true}
      className={cn(
        "relative flex items-center justify-center overflow-hidden",
        tone === "scrim"
          ? "bg-(--lp-scrim) bg-[radial-gradient(circle_at_82%_18%,color-mix(in_srgb,var(--lp-brand)_28%,transparent),transparent_62%)]"
          : "bg-(--lp-brand) bg-[linear-gradient(150deg,var(--lp-brand)_0%,var(--lp-secondary)_85%)]",
        className
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_71px,rgb(255_255_255/0.07)_71px_72px),repeating-linear-gradient(0deg,transparent_0_71px,rgb(255_255_255/0.07)_71px_72px)]"
      />
      {Icon || label ? (
        <div className="relative flex flex-col items-center gap-2 px-4 text-center">
          {Icon ? (
            <span className="flex size-12 items-center justify-center rounded-full bg-(--lp-surface) text-(--lp-primary-text)">
              <Icon aria-hidden="true" className="size-5" />
            </span>
          ) : null}
          {label ? (
            <span className="rounded-(--lp-radius) bg-(--lp-surface) px-2.5 py-1 text-xs font-medium text-(--lp-ink)">
              {label}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
