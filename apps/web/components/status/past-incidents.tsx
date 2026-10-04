import type { PublicIncident } from "@workspace/core/status/public"

import {
  formatDateKeyLong,
  groupPastIncidentsByDay,
  PAST_INCIDENT_DAYS,
} from "@/components/status/format"
import { IncidentCard } from "@/components/status/incident-card"

/** Incidentes resolvidos dos últimos 14 dias, por dia; "Nenhum incidente" nos dias sem. */
export function PastIncidents({
  incidents,
  referenceIso,
}: {
  incidents: readonly PublicIncident[]
  referenceIso: string
}) {
  const groups = groupPastIncidentsByDay(incidents, referenceIso, PAST_INCIDENT_DAYS)

  return (
    <ol className="flex flex-col divide-y">
      {groups.map((group) => {
        return (
          <li key={group.dateKey} className="flex flex-col gap-3 py-4 first:pt-1">
            <h3 className="text-sm font-medium">
              <time dateTime={group.dateKey}>{formatDateKeyLong(group.dateKey)}</time>
            </h3>
            {group.incidents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum incidente.</p>
            ) : (
              group.incidents.map((incident) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  referenceIso={referenceIso}
                  headingLevel="h4"
                  compact
                />
              ))
            )}
          </li>
        )
      })}
    </ol>
  )
}
