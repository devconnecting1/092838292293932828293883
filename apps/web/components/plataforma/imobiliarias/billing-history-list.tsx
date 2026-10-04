import { billingIntervalLabel, platformPlanLabel } from "@workspace/core/platform/accounts"
import { STRIPE_STATUS_LABELS } from "@workspace/core/platform/billing"
import { Badge } from "@workspace/ui/components/badge"

import { formatDate, formatDateTime } from "@/lib/format"
import type { PlatformBillingHistoryEntry } from "@/lib/plataforma/imobiliarias"

const SOURCE_LABELS: Record<string, string> = {
  inicial: "Início do histórico",
  criacao: "Conta criada",
  stripe: "Sincronização da Stripe",
  plataforma: "Mudança pela plataforma",
}

function statusLabel(status: string | null): string {
  if (!status) return "sem status"
  return STRIPE_STATUS_LABELS[status]?.[0] ?? status
}

function fieldText(entry: PlatformBillingHistoryEntry, field: string): string | null {
  switch (field) {
    case "plan_key":
      return `Plano: ${platformPlanLabel(entry.planKey)}`
    case "billing_interval":
      return `Ciclo: ${billingIntervalLabel(entry.interval) ?? "sem ciclo"}`
    case "status":
      return `Status na Stripe: ${statusLabel(entry.status)}`
    case "trial_ends_at":
      return `Fim do teste: ${formatDate(entry.trialEndsAt)}`
    case "current_period_end":
      return `Fim do período: ${formatDate(entry.currentPeriodEnd)}`
    case "cancel_at_period_end":
      return entry.cancelAtPeriodEnd ? "Cancelamento agendado" : "Cancelamento desfeito"
    case "platform_blocked":
      return entry.platformBlocked ? "Conta bloqueada" : "Conta desbloqueada"
    default:
      return null
  }
}

function snapshotText(entry: PlatformBillingHistoryEntry): string {
  const interval = billingIntervalLabel(entry.interval)

  return [
    `${platformPlanLabel(entry.planKey)}${interval ? ` (${interval.toLowerCase()})` : ""}`,
    statusLabel(entry.status),
    entry.status === "trialing" && entry.trialEndsAt
      ? `teste até ${formatDate(entry.trialEndsAt)}`
      : entry.currentPeriodEnd
        ? `período até ${formatDate(entry.currentPeriodEnd)}`
        : null,
    entry.platformBlocked ? "bloqueada" : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** Histórico de assinatura (private.billing_account_history), do mais novo. */
export function BillingHistoryList({ entries }: { entries: PlatformBillingHistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma mudança registrada ainda.</p>
  }

  return (
    <ul className="flex flex-col divide-y">
      {entries.map((entry, index) => {
        const changes = entry.changedFields
          .map((field) => fieldText(entry, field))
          .filter((value): value is string => Boolean(value))

        return (
          <li
            key={`${entry.occurredAt}-${index}`}
            className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium tabular-nums">
                {formatDateTime(entry.occurredAt)}
              </span>
              <Badge variant="outline">{SOURCE_LABELS[entry.source] ?? entry.source}</Badge>
            </div>
            <p className="text-sm break-words text-muted-foreground">
              {changes.length > 0 ? changes.join(" · ") : snapshotText(entry)}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
