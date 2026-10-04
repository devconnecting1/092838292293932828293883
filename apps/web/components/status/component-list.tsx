import * as React from "react"

import {
  STATUS_COMPONENTS,
  type PublicIncident,
  type PublicStatusComponent,
} from "@workspace/core/status/public"
import { uptimeCaption } from "@workspace/core/status/uptime"
import { Card, CardContent } from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import { formatUptime } from "@/components/status/format"
import {
  getLevelLabel,
  STATUS_LEVEL_VISUALS,
  StatusLevelLabel,
} from "@/components/status/status-level"
import { UPTIME_BAR_HINT_ID, UptimeBar } from "@/components/status/uptime-bar"

function ComponentHeading({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h3 className="text-sm font-medium">{name}</h3>
      <p className="text-xs text-pretty text-muted-foreground">{description}</p>
    </div>
  )
}

const ComponentRow = React.memo(function ComponentRow({
  component,
  incidentsById,
}: {
  component: PublicStatusComponent
  incidentsById: ReadonlyMap<string, PublicIncident>
}) {
  return (
    <li className="flex flex-col gap-2.5 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <ComponentHeading name={component.name} description={component.description} />
        <StatusLevelLabel level={component.level} className="shrink-0 pt-px" />
      </div>
      {component.days.length > 0 ? (
        <>
          <UptimeBar component={component} incidentsById={incidentsById} />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">
              <span className="sm:hidden">30 dias atrás</span>
              <span className="hidden sm:inline md:hidden">60 dias atrás</span>
              <span className="hidden md:inline">90 dias atrás</span>
            </span>
            <span className="text-center text-pretty tabular-nums">
              {uptimeCaption(component, formatUptime)}
            </span>
            <span className="shrink-0">Hoje</span>
          </div>
        </>
      ) : null}
    </li>
  )
})

/** Partes do sistema com a situação atual e a barra de 90 dias. */
export function ComponentList({
  components,
  incidentsById,
}: {
  components: readonly PublicStatusComponent[]
  incidentsById: ReadonlyMap<string, PublicIncident>
}) {
  return (
    <Card>
      <CardContent>
        <p id={UPTIME_BAR_HINT_ID} className="sr-only">
          Cada traço é um dia. Use as setas para mudar de dia e Enter para ver os detalhes.
        </p>
        <ul className="flex flex-col divide-y">
          {components.map((component) => (
            <ComponentRow key={component.key} component={component} incidentsById={incidentsById} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Sem retrato: lista as partes acompanhadas, sem inventar situação nem barra. */
export function ComponentListUnavailable() {
  return (
    <Card>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {STATUS_COMPONENTS.map((component) => (
            <li
              key={component.key}
              className="flex items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"
            >
              <ComponentHeading name={component.name} description={component.description} />
              <StatusLevelLabel
                level="none"
                label="Sem informação"
                className="shrink-0 pt-px text-muted-foreground"
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Legenda das cores dos traços da barra. */
export function StatusLegend() {
  const items = [
    "operational",
    "degraded_performance",
    "partial_outage",
    "major_outage",
    "under_maintenance",
    "none",
  ] as const

  return (
    <ul
      aria-label="Legenda das cores da barra"
      className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"
    >
      {items.map((level) => (
        <li key={level} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("size-2.5 rounded-[2px]", STATUS_LEVEL_VISUALS[level].fill)}
          />
          {getLevelLabel(level)}
        </li>
      ))}
    </ul>
  )
}
