import { cn } from "@workspace/ui/lib/utils"

import { lpDisplayFont } from "./primitives"

export type LandingStep = { title: string; description: string }

/** Passo a passo (sequência real: lista ordenada, números só visuais). */
export function Steps({ steps, className }: { steps: LandingStep[]; className?: string }) {
  return (
    <ol className={cn("grid gap-10 @3xl:grid-cols-3 @3xl:gap-8", className)}>
      {steps.map((step, index) => (
        <li key={step.title} className="flex flex-col gap-3">
          <div aria-hidden="true" className="flex items-center gap-4">
            <span
              className={cn(
                lpDisplayFont,
                "flex size-12 shrink-0 items-center justify-center rounded-full bg-(--lp-primary) text-xl font-bold text-(--lp-on-primary)"
              )}
            >
              {index + 1}
            </span>
            {index < steps.length - 1 ? (
              <span className="hidden h-0.5 flex-1 bg-(--lp-primary-border) @3xl:block" />
            ) : null}
          </div>
          <h3 className="text-lg leading-snug font-semibold text-balance">{step.title}</h3>
          <p className="leading-relaxed text-pretty text-(--lp-ink-muted)">{step.description}</p>
        </li>
      ))}
    </ol>
  )
}
