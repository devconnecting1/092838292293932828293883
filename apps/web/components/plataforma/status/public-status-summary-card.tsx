import Link from "next/link"
import { RadarIcon } from "lucide-react"

import { summarizeVendorSignals } from "@workspace/core/status/automation"
import { isBillingWebhookConfigProblem } from "@workspace/core/status/billing-webhook"
import { STATUS_LEVEL_LABELS, type PublicStatusSnapshot } from "@workspace/core/status/public"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import {
  BillingWebhookConfigAlert,
  describeLastBillingWebhookDelivery,
} from "@/components/plataforma/status/billing-webhook-panel"
import { StatusLevelBadge } from "@/components/plataforma/status/status-level-badge"
import { formatNumber } from "@/lib/format"
import { getStatusConsoleOverview, PLATFORM_STATUS_PATH } from "@/lib/status/console"

/**
 * Atalho da Saúde do sistema para o status público: a situação que os clientes
 * veem (retrato com cache, o mesmo da página /status), o que está em aberto, a
 * situação dos fornecedores (só sinal interno) e a última entrega do webhook da
 * Stripe, com o que fazer quando ele recusa por configuração. Sem a visão do
 * console, as linhas internas somem e o resto continua.
 */
export async function PublicStatusSummaryCard({
  snapshot,
}: {
  snapshot: PublicStatusSnapshot | null
}) {
  const overview = await getStatusConsoleOverview(1)
  const vendors = overview.ok ? overview.data.vendors.filter((vendor) => vendor.enabled) : []
  const billingWebhook = overview.ok
    ? (overview.data.components.find((component) => component.key === "billing")?.billingWebhook ??
      null)
    : null
  const automaticOpen =
    snapshot?.activeIncidents.filter((incident) => incident.source === "automatic").length ?? 0
  const openIncidents =
    snapshot?.activeIncidents.filter((incident) => incident.kind === "incident").length ?? 0
  const runningMaintenances =
    snapshot?.activeIncidents.filter((incident) => incident.kind === "maintenance").length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status público</CardTitle>
        <CardDescription>
          {snapshot
            ? `O que os clientes veem em /status: ${STATUS_LEVEL_LABELS[snapshot.overall]}.`
            : "Não foi possível ler o status público agora."}
        </CardDescription>
        {snapshot ? (
          <CardAction>
            <StatusLevelBadge level={snapshot.overall} />
          </CardAction>
        ) : null}
      </CardHeader>
      {snapshot || vendors.length > 0 || billingWebhook ? (
        <CardContent className="flex flex-col gap-4">
          {snapshot ? (
            <dl className="grid grid-cols-3 gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Incidentes em aberto</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {formatNumber(openIncidents)}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Manutenções em andamento</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {formatNumber(runningMaintenances)}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">Manutenções agendadas</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {formatNumber(snapshot.upcomingMaintenances.length)}
                </dd>
              </div>
            </dl>
          ) : null}
          {automaticOpen > 0 ? (
            <p className="text-sm text-muted-foreground">
              {automaticOpen === 1
                ? "1 incidente em aberto foi detectado automaticamente."
                : `${formatNumber(automaticOpen)} incidentes em aberto foram detectados automaticamente.`}
            </p>
          ) : null}
          {vendors.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {summarizeVendorSignals(vendors, new Date())}
            </p>
          ) : null}
          {billingWebhook && isBillingWebhookConfigProblem(billingWebhook.lastOutcome) ? (
            <BillingWebhookConfigAlert webhook={billingWebhook} />
          ) : billingWebhook ? (
            <p className="text-sm text-muted-foreground">
              {describeLastBillingWebhookDelivery(billingWebhook)}
            </p>
          ) : null}
        </CardContent>
      ) : null}
      <CardFooter>
        <Button
          variant="outline"
          render={<Link href={PLATFORM_STATUS_PATH} />}
          nativeButton={false}
        >
          <RadarIcon data-icon="inline-start" />
          Abrir status público
        </Button>
      </CardFooter>
    </Card>
  )
}
