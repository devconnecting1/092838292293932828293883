import { PROPERTY_STATUS_LABELS, type PropertyStatus } from "@workspace/core/properties/enums"
import { Badge } from "@workspace/ui/components/badge"

const STATUS_VARIANTS: Record<PropertyStatus, "default" | "secondary" | "outline" | "destructive"> =
  {
    draft: "outline",
    active: "default",
    reserved: "secondary",
    sold: "secondary",
    rented: "secondary",
    inactive: "outline",
  }

export function PropertyStatusBadge({ status }: { status: PropertyStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{PROPERTY_STATUS_LABELS[status]}</Badge>
}
