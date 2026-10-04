import { CircleAlertIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react"

import { HEALTH_STATUS_LABELS, type HealthStatus } from "@workspace/core/platform/health"
import { Badge } from "@workspace/ui/components/badge"

/** Estado com ícone e texto (a cor nunca é o único sinal). */
export function HealthStatusBadge({ status }: { status: HealthStatus }) {
  const label = HEALTH_STATUS_LABELS[status]

  if (status === "problema") {
    return (
      <Badge variant="destructive">
        <CircleAlertIcon data-icon="inline-start" />
        {label}
      </Badge>
    )
  }

  if (status === "atencao") {
    return (
      <Badge variant="outline">
        <TriangleAlertIcon data-icon="inline-start" />
        {label}
      </Badge>
    )
  }

  return (
    <Badge variant="secondary">
      <CircleCheckIcon data-icon="inline-start" />
      {label}
    </Badge>
  )
}
