import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react"

import type { AnyIncidentStatus } from "@workspace/core/status/incidents"
import {
  INCIDENT_IMPACT_LABELS,
  INCIDENT_STATUS_LABELS,
  STATUS_LEVEL_LABELS,
  type IncidentImpact,
  type StatusLevel,
} from "@workspace/core/status/public"
import { Badge } from "@workspace/ui/components/badge"

/**
 * Situação de uma parte com ícone e texto (a cor nunca é o único sinal). Mesmas
 * variantes da Saúde do sistema: operacional discreto, lentidão e instabilidade
 * em atenção, fora do ar em destaque, manutenção neutra. null = sem medição.
 */
export function StatusLevelBadge({ level }: { level: StatusLevel | null }) {
  if (level === null) {
    return (
      <Badge variant="outline">
        <CircleDashedIcon data-icon="inline-start" />
        Sem medição
      </Badge>
    )
  }

  const label = STATUS_LEVEL_LABELS[level]

  switch (level) {
    case "major_outage":
      return (
        <Badge variant="destructive">
          <CircleAlertIcon data-icon="inline-start" />
          {label}
        </Badge>
      )
    case "partial_outage":
    case "degraded_performance":
      return (
        <Badge variant="outline">
          <TriangleAlertIcon data-icon="inline-start" />
          {label}
        </Badge>
      )
    case "under_maintenance":
      return (
        <Badge variant="secondary">
          <WrenchIcon data-icon="inline-start" />
          {label}
        </Badge>
      )
    default:
      return (
        <Badge variant="secondary">
          <CircleCheckIcon data-icon="inline-start" />
          {label}
        </Badge>
      )
  }
}

const INCIDENT_STATUS_VARIANTS: Record<AnyIncidentStatus, "default" | "secondary" | "outline"> = {
  investigating: "default",
  identified: "default",
  monitoring: "default",
  in_progress: "default",
  scheduled: "secondary",
  resolved: "outline",
  completed: "outline",
}

/** Estado do incidente ou da manutenção (mesma lógica de cor dos comunicados). */
export function IncidentStatusBadge({ status }: { status: AnyIncidentStatus }) {
  return <Badge variant={INCIDENT_STATUS_VARIANTS[status]}>{INCIDENT_STATUS_LABELS[status]}</Badge>
}

/** Impacto declarado pela equipe; crítico em destaque. */
export function IncidentImpactBadge({ impact }: { impact: IncidentImpact }) {
  return (
    <Badge variant={impact === "critical" ? "destructive" : "outline"}>
      {impact === "none" ? null : <TriangleAlertIcon data-icon="inline-start" />}
      {INCIDENT_IMPACT_LABELS[impact]}
    </Badge>
  )
}
