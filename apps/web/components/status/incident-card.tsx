import { ScanSearchIcon } from "lucide-react"

import { INCIDENT_SOURCE_LABELS } from "@workspace/core/status/automation"
import {
  INCIDENT_STATUS_LABELS,
  type PublicIncident,
  type PublicIncidentUpdate,
} from "@workspace/core/status/public"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import {
  formatStatusDateTime,
  getImpactLabel,
  getIncidentLevel,
  incidentAnchorId,
  listComponentNames,
} from "@/components/status/format"
import { STATUS_LEVEL_VISUALS } from "@/components/status/status-level"

function IncidentTimeline({
  updates,
  referenceIso,
}: {
  updates: readonly PublicIncidentUpdate[]
  referenceIso: string
}) {
  if (updates.length === 0) {
    return null
  }

  return (
    <ol aria-label="Atualizações" className="flex flex-col gap-4 border-s ps-4">
      {updates.map((update, index) => (
        <li key={`${update.createdAt}-${index}`} className="flex flex-col gap-1">
          <p className="text-sm break-words whitespace-pre-line">
            <span className="font-medium">{INCIDENT_STATUS_LABELS[update.status]}.</span>{" "}
            {update.message}
          </p>
          <time dateTime={update.createdAt} className="text-xs text-muted-foreground">
            {formatStatusDateTime(update.createdAt, referenceIso)}
          </time>
        </li>
      ))}
    </ol>
  )
}

/** Período da manutenção ("20/09 às 23:00 até 21/09 às 02:00"), quando houver. */
function maintenanceWindow(incident: PublicIncident, referenceIso: string) {
  if (!incident.scheduledFor) {
    return null
  }

  const start = formatStatusDateTime(incident.scheduledFor, referenceIso)

  return incident.scheduledUntil
    ? `De ${start} até ${formatStatusDateTime(incident.scheduledUntil, referenceIso)}`
    : `A partir de ${start}`
}

/**
 * Incidente ou manutenção com a linha do tempo das atualizações da equipe
 * (da mais recente para a mais antiga). `id` na âncora: o detalhe de cada dia
 * da barra de 90 dias aponta para cá.
 */
export function IncidentCard({
  incident,
  referenceIso,
  headingLevel = "h3",
  compact = false,
}: {
  incident: PublicIncident
  referenceIso: string
  headingLevel?: "h3" | "h4"
  compact?: boolean
}) {
  const level = getIncidentLevel(incident)
  const visual = STATUS_LEVEL_VISUALS[level]
  const Icon = visual.icon
  const Heading = headingLevel
  const period = incident.kind === "maintenance" ? maintenanceWindow(incident, referenceIso) : null
  const affected = listComponentNames(incident.componentKeys)

  return (
    <Card
      id={incidentAnchorId(incident.id)}
      tabIndex={-1}
      size={compact ? "sm" : "default"}
      className="scroll-mt-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <CardHeader>
        <CardTitle>
          <Heading className="flex items-start gap-2 text-pretty">
            <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", visual.iconColor)} />
            <span className="min-w-0 break-words">{incident.title}</span>
          </Heading>
        </CardTitle>
        <CardDescription className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline">{INCIDENT_STATUS_LABELS[incident.status]}</Badge>
            {incident.kind === "incident" ? getImpactLabel(incident.impact) : null}
            {incident.source === "automatic" ? (
              <span className="inline-flex items-center gap-1 text-xs">
                <ScanSearchIcon aria-hidden className="size-3.5 shrink-0" />
                {INCIDENT_SOURCE_LABELS.automatic}
              </span>
            ) : null}
          </span>
          {period ? <span>{period}</span> : null}
          {affected ? <span>Afeta: {affected}</span> : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <IncidentTimeline updates={incident.updates} referenceIso={referenceIso} />
      </CardContent>
    </Card>
  )
}
