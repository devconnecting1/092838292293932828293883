import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { LeadInterestNotice } from "@/components/landing/lead-interest"

/**
 * Moldura do formulário de lead (sempre clara, para o formulário injetado com
 * tokens do shadcn funcionar em qualquer fundo). `id` é a âncora dos CTAs.
 *
 * Altura variável (formulário em 2 etapas do L3): a área do formulário
 * reserva altura mínima por tamanho e o painel fica em coluna própria nos
 * layouts de desktop (`items-start`), então trocar de etapa não empurra o
 * conteúdo lateral. No mobile a reserva evita salto ao hidratar.
 */
export function LeadFormPanel({
  id,
  title,
  description,
  size = "full",
  seal,
  children,
  className,
}: {
  id: string
  title: string
  description?: string
  size?: "short" | "full"
  /** Selo de confiança sob o formulário (ex.: <CreciSeal />). */
  seal?: ReactNode
  children: ReactNode
  className?: string
}) {
  const titleId = `${id}-title`

  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn(
        "flex w-full scroll-mt-6 flex-col gap-5 rounded-[calc(var(--lp-radius)*1.5)] border border-(--lp-line) bg-(--lp-surface) p-5 text-(--lp-ink) shadow-[0_24px_48px_-24px_rgb(0_0_0/0.35)] @md:p-7",
        className
      )}
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={titleId} className="text-xl leading-snug font-semibold text-balance">
          {title}
        </h2>
        {description ? (
          <p className="text-sm leading-relaxed text-pretty text-(--lp-ink-muted)">{description}</p>
        ) : null}
      </div>
      <LeadInterestNotice />
      <div className={cn("flex flex-col", size === "short" ? "min-h-56" : "min-h-88")}>
        {children ?? (
          <p className="rounded-(--lp-radius) bg-(--lp-surface-alt) p-4 text-sm text-(--lp-ink-muted)">
            Formulário indisponível no momento.
          </p>
        )}
      </div>
      {seal ? <div className="border-t border-(--lp-line) pt-4">{seal}</div> : null}
    </section>
  )
}
