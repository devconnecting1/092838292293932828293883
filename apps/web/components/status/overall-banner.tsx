import { CircleQuestionMarkIcon } from "lucide-react"

import type { PublicStatusSnapshot } from "@workspace/core/status/public"
import { cn } from "@workspace/ui/lib/utils"

import { SupportHelpButton } from "@/components/crm/support-help-button"
import { getOverallSummary } from "@/components/status/format"
import { STATUS_LEVEL_VISUALS } from "@/components/status/status-level"

/** Faixa grande com a situação geral, na cor do nível (com ícone e texto). */
export function OverallBanner({ snapshot }: { snapshot: PublicStatusSnapshot }) {
  const summary = getOverallSummary(snapshot)
  const visual = STATUS_LEVEL_VISUALS[summary.level]
  const Icon = visual.icon

  return (
    <section
      aria-label="Situação geral"
      className={cn(
        "flex items-start gap-3 rounded-lg px-4 py-4 sm:px-5",
        visual.fill,
        visual.onFill
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-6 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-lg leading-snug font-semibold text-balance sm:text-xl">
          {summary.title}
        </p>
        {summary.description ? <p className="text-sm text-pretty">{summary.description}</p> : null}
      </div>
    </section>
  )
}

/** Sem retrato (falha ou ainda sem dados): não afirma nada sobre a situação. */
export function UnavailableBanner() {
  return (
    <section
      aria-label="Situação geral"
      className="flex flex-col gap-3 rounded-lg bg-card px-4 py-4 ring-1 ring-foreground/10 sm:flex-row sm:items-start sm:px-5"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <CircleQuestionMarkIcon
          aria-hidden
          className="mt-0.5 size-6 shrink-0 text-muted-foreground"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-lg leading-snug font-semibold text-balance sm:text-xl">
            Não foi possível verificar agora
          </p>
          <p className="text-sm text-pretty text-muted-foreground">
            A página tenta de novo a cada minuto. Se o sistema não abrir para você, fale com o
            suporte.
          </p>
        </div>
      </div>
      <SupportHelpButton label="Falar com o suporte" className="self-start" />
    </section>
  )
}
