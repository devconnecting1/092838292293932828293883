import { CheckIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { lpDisplayFont, type LandingTone } from "./primitives"

const checkBadge: Record<LandingTone, string> = {
  surface: "bg-(--lp-primary-soft) text-(--lp-on-primary-soft)",
  dark: "bg-(--lp-on-secondary) text-(--lp-secondary)",
  scrim: "bg-(--lp-on-scrim) text-(--lp-scrim)",
}

const ruleColor: Record<LandingTone, string> = {
  surface: "border-(--lp-line)",
  dark: "border-(--lp-secondary-border)",
  scrim: "border-current",
}

/**
 * Benefícios, garantias e diferenciais.
 * - checks: lista com marcador de confirmação.
 * - statements: frases curtas em corpo grande separadas por fio (números e
 *   diferenciais da imobiliária).
 */
export function HighlightList({
  items,
  variant = "checks",
  tone = "surface",
  className,
}: {
  items: string[]
  variant?: "checks" | "statements"
  tone?: LandingTone
  className?: string
}) {
  if (items.length === 0) return null

  if (variant === "statements") {
    return (
      <ul className={cn("grid gap-x-8 @xl:grid-cols-2", className)}>
        {items.map((item, index) => (
          <li
            key={`${index}-${item}`}
            className={cn(
              "border-t py-5 text-[1.375rem] leading-snug font-semibold text-balance @3xl:text-[1.625rem]",
              lpDisplayFont,
              "tracking-tight",
              ruleColor[tone]
            )}
          >
            {item}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className={cn("flex flex-col gap-3.5", className)}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`} className="flex items-start gap-3 leading-relaxed">
          <span
            aria-hidden="true"
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
              checkBadge[tone]
            )}
          >
            <CheckIcon className="size-3.5" strokeWidth={3} />
          </span>
          <span className="text-pretty">{item}</span>
        </li>
      ))}
    </ul>
  )
}
