import { CircleAlertIcon } from "lucide-react"

import {
  STATUS_COMPONENTS,
  STATUS_LEVEL_LABELS,
  type PublicStatusSnapshot,
} from "@workspace/core/status/public"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { BillingWebhookConfigAlert } from "@/components/plataforma/status/billing-webhook-panel"
import { formatUptime } from "@/components/plataforma/status/status-format"
import { StatusLevelBadge } from "@/components/plataforma/status/status-level-badge"
import { formatDateTime, formatNumber } from "@/lib/format"
import type { StatusConsoleComponent } from "@/lib/status/console"
import { PUBLIC_STATUS_REVALIDATE_SECONDS } from "@/lib/status/public"

function SourceInfo({ component }: { component: StatusConsoleComponent | undefined }) {
  if (!component) {
    return null
  }

  if (component.source === "manual") {
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline">Manual</Badge>
        Só muda com incidente ou manutenção
      </span>
    )
  }

  if (component.signalConfigured === false && !component.lastMeasuredAt) {
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline">Sinal desligado</Badge>
        Sem medição: só muda com incidente ou manutenção (o público lê “acompanhado pela equipe”)
      </span>
    )
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Badge variant="outline">Automática</Badge>
      {component.signalConfigured === false ? <span>Sinal desligado ·</span> : null}
      <span>
        Medição estável:{" "}
        {component.automaticLevel
          ? STATUS_LEVEL_LABELS[component.automaticLevel]
          : "nenhuma confirmada"}
      </span>
      {component.candidateLevel ? (
        <span>· aguardando 2ª medição: {STATUS_LEVEL_LABELS[component.candidateLevel]}</span>
      ) : null}
    </span>
  )
}

/**
 * O retrato público lido agora, sem cache: situação geral e de cada parte, a
 * disponibilidade de 90 dias e de onde vem a situação (medição ou equipe).
 */
export function PublicViewCard({
  snapshot,
  consoleComponents,
}: {
  snapshot: PublicStatusSnapshot | null
  /** null quando a visão do console não pôde ser lida (sem a coluna de origem). */
  consoleComponents: readonly StatusConsoleComponent[] | null
}) {
  if (!snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>O que o público vê agora</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível ler o status público agora</AlertTitle>
            <AlertDescription>
              A consulta pública do banco não respondeu ou voltou num formato inesperado. Enquanto
              isso, a página /status avisa que não foi possível verificar. Tente atualizar em
              instantes.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  const publicComponents = new Map(
    snapshot.components.map((component) => [component.key, component])
  )
  const consoleByKey = new Map(consoleComponents?.map((component) => [component.key, component]))
  const billingWebhook = consoleByKey.get("billing")?.billingWebhook ?? null
  const openIncidents = snapshot.activeIncidents.filter((incident) => incident.kind === "incident")
  const runningMaintenances = snapshot.activeIncidents.filter(
    (incident) => incident.kind === "maintenance"
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>O que o público vê agora</CardTitle>
        <CardDescription>
          Mesmo retrato da página /status, lido agora sem cache. A página pública se renova a cada{" "}
          {PUBLIC_STATUS_REVALIDATE_SECONDS} segundos; o que é publicado aqui aparece na hora.
        </CardDescription>
        <CardAction>
          <StatusLevelBadge level={snapshot.overall} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <BillingWebhookConfigAlert webhook={billingWebhook} />
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Situação geral</dt>
            <dd className="font-medium">{STATUS_LEVEL_LABELS[snapshot.overall]}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Última medição automática</dt>
            <dd className="font-medium tabular-nums">
              {snapshot.lastCheckedAt ? formatDateTime(snapshot.lastCheckedAt) : "Nenhuma ainda"}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Incidentes em aberto</dt>
            <dd className="font-medium tabular-nums">{formatNumber(openIncidents.length)}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Manutenções</dt>
            <dd className="font-medium tabular-nums">
              {formatNumber(runningMaintenances.length)} em andamento ·{" "}
              {formatNumber(snapshot.upcomingMaintenances.length)} agendadas
            </dd>
          </div>
        </dl>

        <ul className="flex flex-col divide-y" aria-label="Partes do sistema">
          {STATUS_COMPONENTS.map((info) => {
            const component = publicComponents.get(info.key)

            return (
              <li
                key={info.key}
                className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between md:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{info.name}</span>
                  <span className="text-xs break-words text-muted-foreground">
                    {info.description}
                  </span>
                  <SourceInfo component={consoleByKey.get(info.key)} />
                </div>
                <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
                  {component ? (
                    <StatusLevelBadge level={component.level} />
                  ) : (
                    <Badge variant="outline">Sem dado</Badge>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    90 dias: {formatUptime(component?.uptime90dPct)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
