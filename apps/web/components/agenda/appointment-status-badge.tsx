import { CircleAlertIcon } from "lucide-react"

import { APPOINTMENT_STATUS_LABELS } from "@workspace/core/properties/enums"
import type { Enums } from "@workspace/database/types"
import { Badge } from "@workspace/ui/components/badge"

const STATUS_VARIANTS: Record<
  Enums<"appointment_status">,
  "outline" | "secondary" | "default" | "destructive"
> = {
  scheduled: "outline",
  confirmed: "secondary",
  done: "default",
  no_show: "destructive",
  canceled: "outline",
}

/** Status da visita em pt-BR; visita passada sem retorno vira "Sem retorno". */
export function AppointmentStatusBadge({
  status,
  overdue,
}: {
  status: Enums<"appointment_status">
  overdue?: boolean
}) {
  if (overdue && (status === "scheduled" || status === "confirmed")) {
    return (
      <Badge variant="destructive">
        <CircleAlertIcon data-icon="inline-start" />
        Sem retorno
      </Badge>
    )
  }

  return <Badge variant={STATUS_VARIANTS[status]}>{APPOINTMENT_STATUS_LABELS[status]}</Badge>
}
