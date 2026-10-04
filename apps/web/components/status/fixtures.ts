import "server-only"

import {
  STATUS_COMPONENTS,
  type PublicIncident,
  type PublicStatusComponent,
  type PublicStatusSnapshot,
  type StatusComponentKey,
  type StatusDay,
  type StatusLevel,
} from "@workspace/core/status/public"

import { addDaysToDateKey, toStatusDateKey } from "@/components/status/format"

/**
 * Retratos FICTÍCIOS para ver os estados da página em desenvolvimento
 * (/status?exemplo=ok|incidente|manutencao|sem-dados). Só são carregados por
 * app/status/page.tsx dentro de `process.env.NODE_ENV === "development"`: no
 * build de produção esse ramo é removido e este módulo nem entra no pacote.
 */
export const STATUS_EXAMPLE_NAMES = ["ok", "incidente", "manutencao", "sem-dados"] as const

export type StatusExampleName = (typeof STATUS_EXAMPLE_NAMES)[number]

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Número pseudoaleatório estável (mesma página a cada recarga). */
function noise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function iso(ms: number) {
  return new Date(ms).toISOString()
}

function buildPastIncidents(now: number): PublicIncident[] {
  return [
    {
      id: "exemplo-passado-1",
      kind: "incident",
      title: "Leads dos portais chegando com atraso",
      impact: "minor",
      status: "resolved",
      componentKeys: ["integrations"],
      startedAt: iso(now - 3 * DAY - 2 * HOUR),
      resolvedAt: iso(now - 3 * DAY),
      scheduledFor: null,
      scheduledUntil: null,
      updates: [
        {
          status: "resolved",
          message: "Os leads atrasados foram entregues e o recebimento voltou ao normal.",
          createdAt: iso(now - 3 * DAY),
        },
        {
          status: "monitoring",
          message: "Correção aplicada. Acompanhando a chegada dos leads.",
          createdAt: iso(now - 3 * DAY - HOUR),
        },
        {
          status: "investigating",
          message:
            "Alguns leads do ZAP e do Viva Real estão chegando com até 20 minutos de atraso.",
          createdAt: iso(now - 3 * DAY - 2 * HOUR),
        },
      ],
    },
    {
      id: "exemplo-passado-automatico",
      kind: "incident",
      title: "Instabilidade em Avisos por e-mail e no celular",
      impact: "major",
      status: "resolved",
      componentKeys: ["notifications"],
      startedAt: iso(now - 5 * DAY - 40 * 60 * 1000),
      resolvedAt: iso(now - 5 * DAY),
      scheduledFor: null,
      scheduledUntil: null,
      source: "automatic",
      updates: [
        {
          status: "resolved",
          message: "Resolvido. O funcionamento está normal.",
          createdAt: iso(now - 5 * DAY),
        },
        {
          status: "monitoring",
          message: "O funcionamento voltou ao normal. Seguimos acompanhando.",
          createdAt: iso(now - 5 * DAY - 15 * 60 * 1000),
        },
        {
          status: "investigating",
          message:
            "Detectamos automaticamente uma instabilidade nesta parte do sistema. Estamos verificando.",
          createdAt: iso(now - 5 * DAY - 40 * 60 * 1000),
        },
      ],
    },
    {
      id: "exemplo-passado-2",
      kind: "maintenance",
      title: "Manutenção programada do banco de dados",
      impact: "none",
      status: "completed",
      componentKeys: ["crm", "login"],
      startedAt: iso(now - 9 * DAY),
      resolvedAt: iso(now - 9 * DAY + HOUR),
      scheduledFor: iso(now - 9 * DAY),
      scheduledUntil: iso(now - 9 * DAY + HOUR),
      updates: [
        {
          status: "completed",
          message: "Manutenção concluída sem impacto.",
          createdAt: iso(now - 9 * DAY + HOUR),
        },
      ],
    },
  ]
}

function buildDays(
  componentIndex: number,
  key: StatusComponentKey,
  today: string,
  now: number,
  todayLevel: StatusLevel,
  todayIncidentIds: string[]
): StatusDay[] {
  // Catálogo da Caixa: medição começou há 50 dias (os anteriores ficam cinza).
  const monitoredDays = key === "caixa_catalog" ? 50 : 90

  return Array.from({ length: 90 }, (_, index) => {
    const date = addDaysToDateKey(today, index - 89)
    const daysAgo = 89 - index

    if (daysAgo === 0) {
      return {
        date,
        uptimePct: todayLevel === "operational" ? 100 : 97.3,
        worstLevel: todayLevel,
        incidentIds: todayIncidentIds,
      }
    }

    if (daysAgo >= monitoredDays) {
      return { date, uptimePct: null, worstLevel: "operational", incidentIds: [] }
    }

    if (key === "integrations" && date === toStatusDateKey(iso(now - 3 * DAY))) {
      return {
        date,
        uptimePct: 99.12,
        worstLevel: "degraded_performance",
        incidentIds: ["exemplo-passado-1"],
      }
    }

    if ((key === "crm" || key === "login") && date === toStatusDateKey(iso(now - 9 * DAY))) {
      return {
        date,
        uptimePct: 100,
        worstLevel: "under_maintenance",
        incidentIds: ["exemplo-passado-2"],
      }
    }

    const roll = noise(componentIndex * 97 + index)

    if (daysAgo > 14 && roll > 0.992) {
      return {
        date,
        uptimePct: 96.4,
        worstLevel: "partial_outage",
        incidentIds: [`exemplo-antigo-${key}-${index}`],
      }
    }

    if (roll > 0.975) {
      return { date, uptimePct: 99.6, worstLevel: "degraded_performance", incidentIds: [] }
    }

    return { date, uptimePct: 100, worstLevel: "operational", incidentIds: [] }
  })
}

function averageUptime(days: StatusDay[]) {
  const measured = days.flatMap((day) => (day.uptimePct === null ? [] : [day.uptimePct]))
  return measured.length === 0
    ? null
    : Math.round((measured.reduce((sum, value) => sum + value, 0) / measured.length) * 100) / 100
}

export function getStatusExample(
  name: string,
  now = Date.now()
): PublicStatusSnapshot | null | undefined {
  if (!(STATUS_EXAMPLE_NAMES as readonly string[]).includes(name)) {
    return undefined
  }

  if (name === "sem-dados") {
    return null
  }

  const today = toStatusDateKey(iso(now)) ?? "2026-01-01"
  const example = name as Exclude<StatusExampleName, "sem-dados">
  const activeIncidents: PublicIncident[] = []
  const upcomingMaintenances: PublicIncident[] = []
  const levels: Partial<Record<StatusComponentKey, StatusLevel>> = {}

  if (example === "incidente") {
    levels.notifications = "partial_outage"
    activeIncidents.push({
      id: "exemplo-ativo-1",
      kind: "incident",
      title: "Atraso nos avisos por e-mail",
      impact: "major",
      status: "identified",
      componentKeys: ["notifications"],
      startedAt: iso(now - 50 * 60 * 1000),
      resolvedAt: null,
      scheduledFor: null,
      scheduledUntil: null,
      updates: [
        {
          status: "identified",
          message:
            "O provedor de e-mail está recusando parte dos envios. Os avisos no celular seguem funcionando.",
          createdAt: iso(now - 20 * 60 * 1000),
        },
        {
          status: "investigating",
          message: "Avisos de novo lead por e-mail estão chegando com atraso.",
          createdAt: iso(now - 50 * 60 * 1000),
        },
      ],
    })
  }

  if (example === "manutencao") {
    levels.billing = "under_maintenance"
    activeIncidents.push({
      id: "exemplo-manutencao-1",
      kind: "maintenance",
      title: "Atualização do sistema de cobrança",
      impact: "minor",
      status: "in_progress",
      componentKeys: ["billing"],
      startedAt: iso(now - 30 * 60 * 1000),
      resolvedAt: null,
      scheduledFor: iso(now - 30 * 60 * 1000),
      scheduledUntil: iso(now + 90 * 60 * 1000),
      updates: [
        {
          status: "in_progress",
          message: "Troca de plano e faturas ficam indisponíveis até o fim da janela.",
          createdAt: iso(now - 30 * 60 * 1000),
        },
      ],
    })
    upcomingMaintenances.push({
      id: "exemplo-agendada-1",
      kind: "maintenance",
      title: "Migração do catálogo de imóveis da Caixa",
      impact: "minor",
      status: "scheduled",
      componentKeys: ["caixa_catalog"],
      startedAt: iso(now + 3 * DAY),
      resolvedAt: null,
      scheduledFor: iso(now + 3 * DAY),
      scheduledUntil: iso(now + 3 * DAY + 2 * HOUR),
      updates: [
        {
          status: "scheduled",
          message: "A busca de imóveis da Caixa pode ficar fora do ar por até 2 horas.",
          createdAt: iso(now - DAY),
        },
      ],
    })
  }

  const components: PublicStatusComponent[] = STATUS_COMPONENTS.map((info, index) => {
    const level = levels[info.key] ?? "operational"
    const todayIncidentIds = activeIncidents
      .filter((incident) => incident.componentKeys.includes(info.key))
      .map((incident) => incident.id)
    const days = buildDays(index, info.key, today, now, level, todayIncidentIds)

    return { ...info, level, automaticSignal: true, uptime90dPct: averageUptime(days), days }
  })

  const overall: StatusLevel =
    example === "incidente"
      ? "partial_outage"
      : example === "manutencao"
        ? "under_maintenance"
        : "operational"

  return {
    generatedAt: iso(now),
    lastCheckedAt: iso(now - 40 * 1000),
    overall,
    components,
    activeIncidents,
    upcomingMaintenances,
    pastIncidents: buildPastIncidents(now),
  }
}
