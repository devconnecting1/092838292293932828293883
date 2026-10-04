import type { BillingState } from "@workspace/core/billing"
import { Badge } from "@workspace/ui/components/badge"

import {
  BILLING_STATE_BADGE_VARIANTS,
  BILLING_STATE_LABELS,
} from "@/components/billing/overview-view"

export function BillingStateBadge({ state }: { state: BillingState }) {
  return <Badge variant={BILLING_STATE_BADGE_VARIANTS[state]}>{BILLING_STATE_LABELS[state]}</Badge>
}
