import { TASK_PRIORITY_LABELS } from "@workspace/core/properties/enums"
import type { Enums } from "@workspace/database/types"
import { Badge } from "@workspace/ui/components/badge"

const PRIORITY_VARIANTS: Record<Enums<"task_priority">, "default" | "secondary" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "outline",
}

export function TaskPriorityBadge({ priority }: { priority: Enums<"task_priority"> }) {
  return (
    <Badge variant={PRIORITY_VARIANTS[priority]}>
      Prioridade {TASK_PRIORITY_LABELS[priority].toLowerCase()}
    </Badge>
  )
}
