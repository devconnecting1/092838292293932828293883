import { CreditCardIcon, KeyRoundIcon } from "lucide-react"

import {
  BILLING_WEBHOOK_ACTIONS,
  BILLING_WEBHOOK_OUTCOME_LABELS,
  BILLING_WEBHOOK_OUTCOME_SHORT_LABELS,
  BILLING_WEBHOOK_OUTCOMES,
  BILLING_WEBHOOK_RULES,
  isBillingWebhookConfigProblem,
  type BillingWebhookOutcome,
} from "@workspace/core/status/billing-webhook"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"

import { formatDateTime, formatNumber } from "@/lib/format"
import type { BillingWebhookState } from "@/lib/status/console"

/**
 * Webhook da Stripe no Console (só a equipe vê): última entrega, o motivo e o
 * que fazer. Vem de platform_status_overview; nunca payload, ids ou valores.
 */

function OutcomeBadge({ outcome }: { outcome: BillingWebhookOutcome }) {
  const variant =
    outcome === "ok"
      ? "secondary"
      : isBillingWebhookConfigProblem(outcome)
        ? "destructive"
        : "outline"

  return <Badge variant={variant}>{BILLING_WEBHOOK_OUTCOME_SHORT_LABELS[outcome]}</Badge>
}

/** "Última entrega em 17/09/2026 09:42 · Configuração ausente" (ou nenhuma registrada). */
export function describeLastBillingWebhookDelivery(webhook: BillingWebhookState | null): string {
  if (!webhook?.lastReceivedAt || !webhook.lastOutcome) {
    return `Nenhuma entrega do webhook da Stripe registrada nos últimos ${BILLING_WEBHOOK_RULES.retentionDays} dias.`
  }

  return `Última entrega do webhook da Stripe em ${formatDateTime(webhook.lastReceivedAt)}: ${BILLING_WEBHOOK_OUTCOME_LABELS[webhook.lastOutcome]}.`
}

/**
 * Aviso quando a última entrega foi recusada por configuração (segredo
 * ausente ou que não confere): as assinaturas não sincronizam até corrigir.
 */
export function BillingWebhookConfigAlert({ webhook }: { webhook: BillingWebhookState | null }) {
  if (!webhook?.lastOutcome || !isBillingWebhookConfigProblem(webhook.lastOutcome)) {
    return null
  }

  return (
    <Alert variant="destructive">
      <KeyRoundIcon />
      <AlertTitle>O webhook da Stripe está recusando as entregas</AlertTitle>
      <AlertDescription>
        <p>{describeLastBillingWebhookDelivery(webhook)}</p>
        <p>{BILLING_WEBHOOK_ACTIONS[webhook.lastOutcome]}</p>
      </AlertDescription>
    </Alert>
  )
}

/** Detalhe do sinal de "Assinaturas e pagamentos" dentro das medições. */
export function BillingWebhookPanel({ webhook }: { webhook: BillingWebhookState | null }) {
  if (!webhook) {
    return (
      <div className="text-muted-foreground">
        O banco não devolveu as entregas do webhook da Stripe.
      </div>
    )
  }

  const action = webhook.lastOutcome ? BILLING_WEBHOOK_ACTIONS[webhook.lastOutcome] : null
  const facts = [
    {
      label: "Última entrega",
      value: webhook.lastReceivedAt
        ? [formatDateTime(webhook.lastReceivedAt), webhook.lastEventType]
            .filter(Boolean)
            .join(" · ")
        : "Nenhuma registrada",
    },
    {
      label: "Motivo",
      value: webhook.lastOutcome ? BILLING_WEBHOOK_OUTCOME_LABELS[webhook.lastOutcome] : "—",
    },
    { label: "Última entrega processada", value: formatDateTime(webhook.lastOkAt) },
    {
      label: "Último problema",
      value:
        webhook.lastProblemAt && webhook.lastProblemOutcome
          ? `${formatDateTime(webhook.lastProblemAt)} · ${BILLING_WEBHOOK_OUTCOME_SHORT_LABELS[webhook.lastProblemOutcome]}`
          : "Nenhum",
    },
    {
      label: "Últimas 2 h",
      value: BILLING_WEBHOOK_OUTCOMES.map(
        (outcome) =>
          `${BILLING_WEBHOOK_OUTCOME_SHORT_LABELS[outcome]}: ${formatNumber(webhook.counts2h[outcome])}`
      ).join(" · "),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      <span className="flex items-center gap-1.5 font-medium">
        <CreditCardIcon aria-hidden className="size-4 shrink-0" />
        Webhook da Stripe
      </span>
      {webhook.lastReceivedAt ? null : (
        <div className="text-muted-foreground">
          Sem entrega nos últimos {BILLING_WEBHOOK_RULES.retentionDays} dias, o sinal automático
          fica desligado: a parte só muda com incidente da equipe e, sem histórico, a página pública
          diz “Sem medição automática · acompanhado pela equipe”. Se há assinaturas, confira o
          endpoint em Stripe &gt; Webhooks e BILLING_SERVER_KEY na Vercel.
        </div>
      )}
      <dl className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-2">
        {facts.map((fact) => (
          <div key={fact.label} className="flex min-w-0 flex-col gap-0.5 sm:contents">
            <dt className="text-xs text-muted-foreground sm:text-sm">{fact.label}</dt>
            <dd className="min-w-0 break-words tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {action ? <div className="break-words">{action}</div> : null}
      {webhook.recent.length > 0 ? (
        <ul role="list" className="flex flex-col divide-y rounded-lg border">
          {webhook.recent.map((delivery, index) => (
            <li
              key={`${delivery.receivedAt}-${index}`}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 p-3"
            >
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDateTime(delivery.receivedAt)}
              </span>
              <OutcomeBadge outcome={delivery.outcome} />
              {delivery.eventType ? (
                <span className="min-w-0 font-mono text-xs break-all">{delivery.eventType}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
