"use client"

import * as React from "react"
import { RefreshCwIcon } from "lucide-react"

import type { PublicIncident, PublicStatusSnapshot } from "@workspace/core/status/public"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import {
  ComponentList,
  ComponentListUnavailable,
  StatusLegend,
} from "@/components/status/component-list"
import { formatStatusTime } from "@/components/status/format"
import { IncidentCard } from "@/components/status/incident-card"
import { OverallBanner, UnavailableBanner } from "@/components/status/overall-banner"
import { PastIncidents } from "@/components/status/past-incidents"
import { useStatusRefresh } from "@/components/status/use-status-refresh"

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  const headingId = `${id}-titulo`

  return (
    <section id={id} aria-labelledby={headingId} className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function RefreshInfo({
  snapshot,
  failed,
  paused,
  onRefresh,
}: {
  snapshot: PublicStatusSnapshot | null
  failed: boolean
  paused: boolean
  onRefresh: () => void
}) {
  const updatedAt = snapshot ? (
    <>
      Atualizado às{" "}
      <time dateTime={snapshot.generatedAt}>{formatStatusTime(snapshot.generatedAt)}</time> (horário
      de Brasília).
    </>
  ) : null

  const note = failed
    ? "Não foi possível atualizar agora; nova tentativa em 1 minuto."
    : paused
      ? "Atualização automática pausada por inatividade."
      : snapshot
        ? "A página se atualiza sozinha a cada minuto."
        : null

  if (!updatedAt && !note) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <p>
        {updatedAt} {note}
      </p>
      {paused || failed ? (
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCwIcon data-icon="inline-start" />
          Atualizar agora
        </Button>
      ) : null}
    </div>
  )
}

function useIncidentsById(snapshot: PublicStatusSnapshot | null) {
  return React.useMemo(() => {
    const map = new Map<string, PublicIncident>()

    if (snapshot) {
      for (const incident of [
        ...snapshot.pastIncidents,
        ...snapshot.upcomingMaintenances,
        ...snapshot.activeIncidents,
      ]) {
        map.set(incident.id, incident)
      }
    }

    return map
  }, [snapshot])
}

/**
 * Conteúdo da página de status. Começa com o retrato do servidor e troca pelo
 * de /api/status a cada minuto (ver useStatusRefresh). Sem retrato, diz que não
 * foi possível verificar, sem inventar "operacional".
 */
export function StatusLive({
  initialSnapshot,
  autoRefresh = true,
  isExample = false,
}: {
  initialSnapshot: PublicStatusSnapshot | null
  autoRefresh?: boolean
  /** Só em desenvolvimento (?exemplo=...): avisa que os dados são fictícios. */
  isExample?: boolean
}) {
  const { snapshot, failed, paused, announcement, refreshNow } = useStatusRefresh(
    initialSnapshot,
    autoRefresh
  )
  const incidentsById = useIncidentsById(snapshot)
  const activeIncidents = snapshot?.activeIncidents.filter((item) => item.kind === "incident")
  const activeMaintenances = snapshot?.activeIncidents.filter((item) => item.kind === "maintenance")
  // O que já está em andamento entra na lista por dia junto com o que terminou:
  // o cartão mostra o estado ("Investigando"), então o leitor vê que não acabou.
  const dayIncidents = React.useMemo(
    () => (snapshot ? [...snapshot.activeIncidents, ...snapshot.pastIncidents] : []),
    [snapshot]
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Status do sistema</h1>
            {isExample ? <Badge variant="outline">Dados de exemplo</Badge> : null}
          </div>
          <RefreshInfo snapshot={snapshot} failed={failed} paused={paused} onRefresh={refreshNow} />
          <p aria-live="polite" aria-atomic="true" className="sr-only">
            {announcement}
          </p>
        </div>
        {snapshot ? <OverallBanner snapshot={snapshot} /> : <UnavailableBanner />}
      </div>

      {snapshot && activeIncidents && activeIncidents.length > 0 ? (
        <Section id="incidentes-ativos" title="Incidentes em andamento">
          {activeIncidents.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              referenceIso={snapshot.generatedAt}
            />
          ))}
        </Section>
      ) : null}

      {snapshot && activeMaintenances && activeMaintenances.length > 0 ? (
        <Section id="manutencao-em-andamento" title="Manutenção em andamento">
          {activeMaintenances.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              referenceIso={snapshot.generatedAt}
            />
          ))}
        </Section>
      ) : null}

      {snapshot && snapshot.upcomingMaintenances.length > 0 ? (
        <Section
          id="manutencoes-agendadas"
          title="Manutenções agendadas"
          description="Durante a janela, a parte indicada pode ficar lenta ou fora do ar."
        >
          {snapshot.upcomingMaintenances.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              referenceIso={snapshot.generatedAt}
            />
          ))}
        </Section>
      ) : null}

      <Section
        id="partes"
        title="Partes do sistema"
        description="Situação atual e disponibilidade dos últimos 90 dias. Toque num dia para ver os detalhes."
      >
        {snapshot ? (
          <>
            <ComponentList components={snapshot.components} incidentsById={incidentsById} />
            <StatusLegend />
          </>
        ) : (
          <ComponentListUnavailable />
        )}
      </Section>

      {snapshot ? (
        <Section id="incidentes-anteriores" title="Incidentes anteriores">
          <PastIncidents incidents={dayIncidents} referenceIso={snapshot.generatedAt} />
        </Section>
      ) : null}
    </div>
  )
}
