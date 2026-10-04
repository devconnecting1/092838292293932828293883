import { STATUS_HYSTERESIS_SAMPLES } from "@workspace/core/status/levels"
import {
  describeMeasurementDetail,
  STATUS_COMPONENT_RULES,
} from "@workspace/core/status/measurements"
import { STATUS_COMPONENTS, STATUS_LEVEL_LABELS } from "@workspace/core/status/public"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { BillingWebhookPanel } from "@/components/plataforma/status/billing-webhook-panel"
import { StatusLevelBadge } from "@/components/plataforma/status/status-level-badge"
import { formatDateTime, formatNumber } from "@/lib/format"
import type { StatusConsoleComponent, StatusMeasurement } from "@/lib/status/console"

function ConfirmedLevel({ level }: { level: StatusMeasurement["level"] }) {
  return level ? (
    <StatusLevelBadge level={level} />
  ) : (
    <span className="text-xs text-muted-foreground">Sem nível confirmado</span>
  )
}

/** Tabela (a partir de 640 px) e lista (celular) das medições mais recentes. */
function RecentMeasurements({ recent }: { recent: readonly StatusMeasurement[] }) {
  if (recent.length === 0) {
    return <div className="text-muted-foreground">Nenhuma medição registrada ainda.</div>
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border max-sm:hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Horário</TableHead>
              <TableHead>Medido</TableHead>
              <TableHead>Depois da confirmação</TableHead>
              <TableHead>Motivo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((sample) => (
              <TableRow key={sample.measuredAt}>
                <TableCell className="tabular-nums">{formatDateTime(sample.measuredAt)}</TableCell>
                <TableCell>
                  <StatusLevelBadge level={sample.measuredLevel} />
                </TableCell>
                <TableCell>
                  <ConfirmedLevel level={sample.level} />
                </TableCell>
                <TableCell className="break-words whitespace-normal">
                  {describeMeasurementDetail(sample.detail) ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul role="list" className="flex flex-col divide-y rounded-lg border sm:hidden">
        {recent.map((sample) => {
          const detail = describeMeasurementDetail(sample.detail)

          return (
            <li key={sample.measuredAt} className="flex min-w-0 flex-col gap-1.5 p-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDateTime(sample.measuredAt)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusLevelBadge level={sample.measuredLevel} />
                <span className="text-xs text-muted-foreground">depois da confirmação:</span>
                <ConfirmedLevel level={sample.level} />
              </span>
              {detail ? <span className="break-words">{detail}</span> : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function ComponentMeasurements({ component }: { component: StatusConsoleComponent }) {
  if (component.source === "manual") {
    return (
      <div className="text-muted-foreground">
        Sem sinal automático: nenhuma medição é feita nesta parte.
      </div>
    )
  }

  const facts = [
    ...(component.signalConfigured === null
      ? []
      : [
          {
            label: "Sinal automático",
            value: component.signalConfigured
              ? "Ligado"
              : "Desligado: a página pública diz “acompanhado pela equipe” enquanto não houver medição",
          },
        ]),
    {
      label: "Nível automático estável",
      value: <ConfirmedLevel level={component.automaticLevel} />,
    },
    {
      label: "Aguardando confirmação",
      value: component.candidateLevel
        ? `${STATUS_LEVEL_LABELS[component.candidateLevel]} (${formatNumber(component.candidateCount)} de ${STATUS_HYSTERESIS_SAMPLES} medições)`
        : "Nada",
    },
    { label: "Nível mudou em", value: formatDateTime(component.changedAt) },
    {
      label: "Última medição",
      value: component.lastMeasuredAt
        ? [
            formatDateTime(component.lastMeasuredAt),
            describeMeasurementDetail(component.lastDetail),
          ]
            .filter(Boolean)
            .join(" · ")
        : "Nunca medida",
    },
  ]

  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-2">
        {facts.map((fact) => (
          <div key={fact.label} className="flex min-w-0 flex-col gap-0.5 sm:contents">
            <dt className="text-xs text-muted-foreground sm:text-sm">{fact.label}</dt>
            <dd className="min-w-0 break-words tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {component.key === "billing" ? (
        <BillingWebhookPanel webhook={component.billingWebhook} />
      ) : null}
      <RecentMeasurements recent={component.recent} />
    </>
  )
}

/** Regra de cada parte, nível automático e as últimas medições. Nada daqui vai ao público. */
export function MeasurementsCard({
  components,
}: {
  components: readonly StatusConsoleComponent[]
}) {
  const byKey = new Map(components.map((component) => [component.key, component]))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Medições automáticas</CardTitle>
        <CardDescription>
          Regra de cada parte e as medições mais recentes. O nível automático só muda depois de{" "}
          {STATUS_HYSTERESIS_SAMPLES} medições seguidas iguais, para não piscar. Motivos e regras
          ficam só aqui: o público vê apenas a situação.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion multiple>
          {STATUS_COMPONENTS.map((info) => {
            const component = byKey.get(info.key)

            return (
              <AccordionItem key={info.key} value={info.key}>
                <AccordionTrigger>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5 pe-2 sm:flex-row sm:items-center sm:justify-between">
                    <span>{info.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 font-normal">
                      {!component ? (
                        <Badge variant="outline">Sem dados</Badge>
                      ) : component.source === "manual" ? (
                        <Badge variant="outline">Manual</Badge>
                      ) : (
                        <StatusLevelBadge level={component.automaticLevel} />
                      )}
                      {component?.source === "automatic" ? (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {component.lastMeasuredAt
                            ? `Última: ${formatDateTime(component.lastMeasuredAt)}`
                            : "Nunca medida"}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-3">
                    <div className="break-words">{STATUS_COMPONENT_RULES[info.key]}</div>
                    {component ? (
                      <ComponentMeasurements component={component} />
                    ) : (
                      <div className="text-muted-foreground">
                        O banco não devolveu dados desta parte.
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </CardContent>
    </Card>
  )
}
