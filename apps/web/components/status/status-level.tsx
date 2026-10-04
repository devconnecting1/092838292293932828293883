import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleQuestionMarkIcon,
  CircleXIcon,
  TriangleAlertIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"

import { STATUS_LEVEL_LABELS, type StatusLevel } from "@workspace/core/status/public"
import { cn } from "@workspace/ui/lib/utils"

/** Nível da página mais o "sem medição" (dia sem dado). */
export type StatusVisualLevel = StatusLevel | "none"

type LevelVisual = {
  icon: LucideIcon
  /** Preenchimento (faixa, traço do dia). */
  fill: string
  /** Texto sobre o preenchimento. */
  onFill: string
  /** Ícone colorido sobre o fundo do card. */
  iconColor: string
}

/**
 * Classes literais (o Tailwind precisa encontrá-las no código). Os tokens
 * `--status-*` estão em status-colors.css.
 */
export const STATUS_LEVEL_VISUALS: Record<StatusVisualLevel, LevelVisual> = {
  operational: {
    icon: CircleCheckIcon,
    fill: "bg-(--status-operational)",
    onFill: "text-(--status-operational-foreground)",
    iconColor: "text-(--status-operational)",
  },
  degraded_performance: {
    icon: TriangleAlertIcon,
    fill: "bg-(--status-degraded)",
    onFill: "text-(--status-degraded-foreground)",
    iconColor: "text-(--status-degraded)",
  },
  partial_outage: {
    icon: CircleAlertIcon,
    fill: "bg-(--status-partial)",
    onFill: "text-(--status-partial-foreground)",
    iconColor: "text-(--status-partial)",
  },
  major_outage: {
    icon: CircleXIcon,
    fill: "bg-(--status-major)",
    onFill: "text-(--status-major-foreground)",
    iconColor: "text-(--status-major)",
  },
  under_maintenance: {
    icon: WrenchIcon,
    fill: "bg-(--status-maintenance)",
    onFill: "text-(--status-maintenance-foreground)",
    iconColor: "text-(--status-maintenance)",
  },
  none: {
    icon: CircleQuestionMarkIcon,
    fill: "bg-(--status-none)",
    onFill: "text-foreground",
    iconColor: "text-muted-foreground",
  },
}

export function getLevelLabel(level: StatusVisualLevel) {
  return level === "none" ? "Sem medição" : STATUS_LEVEL_LABELS[level]
}

/** Ícone colorido + texto: a cor nunca é o único sinal. */
export function StatusLevelLabel({
  level,
  label = getLevelLabel(level),
  className,
}: {
  level: StatusVisualLevel
  label?: string
  className?: string
}) {
  const visual = STATUS_LEVEL_VISUALS[level]
  const Icon = visual.icon

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <Icon aria-hidden className={cn("size-4 shrink-0", visual.iconColor)} />
      <span>{label}</span>
    </span>
  )
}
