import type { Metadata } from "next"
import Link from "next/link"
import { ExternalLinkIcon, RadarIcon } from "lucide-react"

import { isClosedIncidentStatus } from "@workspace/core/status/incidents"
import { STATUS_PAST_INCIDENT_DAYS } from "@workspace/core/status/uptime"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { PageHeading } from "@/components/crm/page-placeholder"
import { PlatformReadOnlyNotice } from "@/components/plataforma/equipe/read-only-notice"
import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { RefreshButton } from "@/components/plataforma/refresh-button"
import { AutomationCard } from "@/components/plataforma/status/automation-card"
import { IncidentCreateDialog } from "@/components/plataforma/status/incident-create-dialog"
import { IncidentsSection } from "@/components/plataforma/status/incidents-section"
import { MeasurementsCard } from "@/components/plataforma/status/measurements-card"
import { ProbeCard, ProbeSetupAlerts } from "@/components/plataforma/status/probe-card"
import { PublicViewCard } from "@/components/plataforma/status/public-view-card"
import { canAct, requirePlatformAdmin } from "@/lib/plataforma/admin"
import {
  getStatusConsoleOverview,
  listStatusIncidents,
  PLATFORM_STATUS_PATH,
  type StatusConsoleIncident,
} from "@/lib/status/console"
import { getPublicStatusUncached } from "@/lib/status/public"

export const metadata: Metadata = {
  title: "Status público",
}

/** Encerrados mostrados no console (a página pública lista só os dos últimos 14 dias). */
const CLOSED_LIMIT = 20

type OriginFilter = "" | "automatico" | "equipe"

const ORIGIN_FILTERS: readonly { value: OriginFilter; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "automatico", label: "Detectados automaticamente" },
  { value: "equipe", label: "Da equipe" },
]

type PlatformStatusPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function parseOriginFilter(params: Record<string, string | string[] | undefined>): OriginFilter {
  const raw = params.origem
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === "automatico" || value === "equipe" ? value : ""
}

function matchesOrigin(incident: StatusConsoleIncident, filter: OriginFilter): boolean {
  if (filter === "automatico") return incident.source === "automatic"
  if (filter === "equipe") return incident.source === "team"
  return true
}

function originHref(filter: OriginFilter): string {
  return filter ? `${PLATFORM_STATUS_PATH}?origem=${filter}` : PLATFORM_STATUS_PATH
}

/** Incidentes primeiro (mais novos antes); depois manutenções pela data prevista. */
function compareOpen(a: StatusConsoleIncident, b: StatusConsoleIncident): number {
  if (a.kind !== b.kind) {
    return a.kind === "incident" ? -1 : 1
  }

  if (a.kind === "maintenance") {
    return Date.parse(a.scheduledFor ?? a.startedAt) - Date.parse(b.scheduledFor ?? b.startedAt)
  }

  return Date.parse(b.startedAt) - Date.parse(a.startedAt)
}

/**
 * Status público no Console da Plataforma: o que os clientes veem em /status,
 * a medição automática por parte (só para a equipe) e os incidentes e
 * manutenções escritos pela equipe. Cada mudança grava o registro do console
 * na mesma transação (RPC) e invalida o cache da página pública.
 */
export default async function PlatformStatusPage({ searchParams }: PlatformStatusPageProps) {
  const admin = await requirePlatformAdmin()
  const readOnly = !canAct(admin)
  const origin = parseOriginFilter(await searchParams)

  const [overview, incidentsResult, snapshot] = await Promise.all([
    getStatusConsoleOverview(),
    listStatusIncidents(),
    getPublicStatusUncached(),
  ])

  const now = new Date()
  const allIncidents = incidentsResult.ok ? incidentsResult.data : []
  const incidents = allIncidents.filter((incident) => matchesOrigin(incident, origin))
  const open = incidents
    .filter((incident) => !isClosedIncidentStatus(incident.effectiveStatus))
    .sort(compareOpen)
  const closed = incidents
    .filter((incident) => isClosedIncidentStatus(incident.effectiveStatus))
    .slice(0, CLOSED_LIMIT)
  const showIncidentsFailure =
    !incidentsResult.ok && (overview.ok || overview.reason !== incidentsResult.reason)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <PageHeading
          title="Status público"
          description="O que os clientes veem em /status: só o nome de cada parte, a situação, a disponibilidade por dia e os textos que a equipe publica. Nada da Saúde do sistema (filas, rotinas, segredos, erros) vai ao público."
        />
        <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
          <RefreshButton />
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href="/status" target="_blank" rel="noopener" />}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            Abrir página pública
            <span className="sr-only">(abre em outra aba)</span>
          </Button>
          <IncidentCreateDialog readOnly={readOnly} />
        </div>
      </div>

      {readOnly ? <PlatformReadOnlyNotice /> : null}

      {!overview.ok ? <PlatformRpcFailureAlert failure={overview} /> : null}
      {showIncidentsFailure && !incidentsResult.ok ? (
        <PlatformRpcFailureAlert failure={incidentsResult} />
      ) : null}
      {overview.ok ? <ProbeSetupAlerts probe={overview.data.probe} /> : null}

      <PublicViewCard
        snapshot={snapshot}
        consoleComponents={overview.ok ? overview.data.components : null}
      />

      {overview.ok ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] xl:items-start">
          <ProbeCard probe={overview.data.probe} />
          <MeasurementsCard components={overview.data.components} />
        </div>
      ) : null}

      {overview.ok ? (
        <AutomationCard
          automation={overview.data.automation}
          vendors={overview.data.vendors}
          alerts={overview.data.alerts}
          now={now}
        />
      ) : null}

      {incidentsResult.ok && allIncidents.length > 0 ? (
        <nav aria-label="Filtrar incidentes por origem" className="flex flex-wrap gap-2">
          {ORIGIN_FILTERS.map((filter) => {
            const active = filter.value === origin
            const total = allIncidents.filter((incident) =>
              matchesOrigin(incident, filter.value)
            ).length

            return (
              <Button
                key={filter.value || "todos"}
                size="sm"
                variant={active ? "secondary" : "ghost"}
                nativeButton={false}
                render={
                  <Link
                    href={originHref(filter.value)}
                    aria-current={active ? "page" : undefined}
                  />
                }
              >
                {filter.label} ({total})
              </Button>
            )
          })}
        </nav>
      ) : null}

      {incidentsResult.ok && allIncidents.length > 0 && incidents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum incidente com esta origem.</p>
      ) : null}

      {incidentsResult.ok && allIncidents.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RadarIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum incidente ou manutenção ainda</EmptyTitle>
            <EmptyDescription>
              Publique um incidente quando algo parar ou ficar lento, ou agende uma manutenção. Os
              clientes veem o texto em /status e numa faixa no CRM.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <IncidentCreateDialog variant="outline" readOnly={readOnly} />
          </EmptyContent>
        </Empty>
      ) : null}

      {incidentsResult.ok && incidents.length > 0 ? (
        open.length > 0 ? (
          <IncidentsSection
            title="Incidentes e manutenções em aberto"
            description="O que aparece agora na página pública e na faixa do CRM. Publique uma atualização a cada mudança; “Resolvido” ou “Concluída” encerra."
            incidents={open}
            now={now}
            readOnly={readOnly}
          />
        ) : (
          <section className="flex flex-col gap-1">
            <h2 className="text-base font-medium">Incidentes e manutenções em aberto</h2>
            <p className="text-sm text-muted-foreground">
              Nada em aberto agora: a página pública mostra só a medição automática.
            </p>
          </section>
        )
      ) : null}

      {closed.length > 0 ? (
        <IncidentsSection
          title="Encerrados"
          description={`Até ${CLOSED_LIMIT} resolvidos ou concluídos, do mais recente para o mais antigo. A página pública lista os dos últimos ${STATUS_PAST_INCIDENT_DAYS} dias. Só o título pode ser corrigido.`}
          incidents={closed}
          now={now}
          readOnly={readOnly}
        />
      ) : null}
    </div>
  )
}
