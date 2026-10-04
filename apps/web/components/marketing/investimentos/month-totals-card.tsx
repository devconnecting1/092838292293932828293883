import { formatBRL } from "@workspace/core/billing/format"
import {
  formatMonthLabel,
  type SourceInvestmentSummary,
} from "@workspace/core/reports/marketing-investments"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { LEAD_SOURCE_LABELS } from "@/lib/leads/constants"
import type { LeadSource } from "@/lib/leads/db-types"

/** Total do mês por canal, com a divisão entre campanhas e o "canal inteiro". */
export function MonthTotalsCard({
  month,
  totalCents,
  sources,
  previous,
}: {
  month: string
  totalCents: number
  sources: readonly SourceInvestmentSummary<LeadSource>[]
  /** Totais dos meses anteriores, do mais antigo ao atual. */
  previous: readonly { month: string; totalCents: number }[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Total de {formatMonthLabel(month)}</CardTitle>
        <CardDescription>
          <span className="text-2xl font-semibold text-foreground tabular-nums">
            {formatBRL(totalCents)}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3" aria-label="Total por canal">
          {sources.map((summary) => (
            <li key={summary.source} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{LEAD_SOURCE_LABELS[summary.source]}</span>
                <span className="font-medium tabular-nums">{formatBRL(summary.totalCents)}</span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${totalCents > 0 ? Math.max((summary.totalCents / totalCents) * 100, 2) : 0}%`,
                  }}
                />
              </div>
              {summary.campaigns.length > 0 ? (
                <ul className="flex flex-col gap-0.5 ps-3 text-xs text-muted-foreground">
                  {summary.campaigns.map((item) => (
                    <li key={item.campaign} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">Campanha {item.campaign}</span>
                      <span className="tabular-nums">{formatBRL(item.amountCents)}</span>
                    </li>
                  ))}
                  {summary.channelCents > 0 ? (
                    <li className="flex justify-between gap-3">
                      <span>Canal inteiro (sem campanha)</span>
                      <span className="tabular-nums">{formatBRL(summary.channelCents)}</span>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>

        {previous.length > 1 ? (
          <div className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Meses anteriores</span>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
              {previous
                .filter((item) => item.month !== month)
                .map((item) => (
                  <li key={item.month} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{formatMonthLabel(item.month)}</span>
                    <span className="tabular-nums">{formatBRL(item.totalCents)}</span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
