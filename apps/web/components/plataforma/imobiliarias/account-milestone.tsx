import {
  ACCOUNT_MILESTONE_LABELS,
  resolveAccountMilestone,
  type AccountMilestoneInput,
} from "@workspace/core/platform/accounts"

import { formatDate } from "@/lib/format"

/** "Fim do teste 29/09/26", "Próxima cobrança 10/10/26"... ou travessão. */
export function AccountMilestone({ input, now }: { input: AccountMilestoneInput; now: Date }) {
  const milestone = resolveAccountMilestone(input)

  if (!milestone) {
    return <span className="text-muted-foreground">—</span>
  }

  const past = Date.parse(milestone.at) < now.getTime()

  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-xs text-muted-foreground">
        {ACCOUNT_MILESTONE_LABELS[milestone.kind]}
        {past ? " (já passou)" : ""}
      </span>
      <span className="tabular-nums">{formatDate(milestone.at)}</span>
    </span>
  )
}
