import { formatBRL } from "@workspace/core/billing/format"
import { aiUsageRatio } from "@workspace/core/platform/accounts"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "cn"

/** Custo de IA do ciclo contra o teto (plano + excedente), com barra. */
export function AiUsageMeter({
  costCents,
  capCents,
  className,
}: {
  costCents: number | null
  capCents: number | null
  className?: string
}) {
  if (costCents === null && capCents === null) {
    return <span className="text-muted-foreground">—</span>
  }

  const ratio = aiUsageRatio(costCents, capCents)
  const percent = ratio === null ? null : Math.round(ratio * 100)
  const label =
    capCents && capCents > 0
      ? `${formatBRL(costCents ?? 0)} de ${formatBRL(capCents)}`
      : `${formatBRL(costCents ?? 0)} (sem IA no plano)`

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-sm whitespace-nowrap tabular-nums">{label}</span>
      {percent !== null ? (
        <Progress
          value={Math.min(percent, 100)}
          aria-label={`Uso de IA no ciclo: ${percent}% do teto`}
          className={cn(
            "w-full max-w-32",
            percent >= 100 && "[&_[data-slot=progress-indicator]]:bg-destructive"
          )}
        />
      ) : null}
    </div>
  )
}
