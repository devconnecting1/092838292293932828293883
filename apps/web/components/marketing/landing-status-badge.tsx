import { Badge } from "@workspace/ui/components/badge"

import { LANDING_STATUS_LABELS, type LandingStatus } from "@/lib/marketing/constants"

const VARIANTS = {
  draft: "secondary",
  published: "default",
  archived: "outline",
} as const satisfies Record<LandingStatus, "default" | "secondary" | "outline">

export function LandingStatusBadge({ status }: { status: LandingStatus }) {
  return <Badge variant={VARIANTS[status]}>{LANDING_STATUS_LABELS[status]}</Badge>
}
