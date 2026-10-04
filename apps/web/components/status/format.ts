/**
 * Textos e datas da página de status. Módulo puro: roda no servidor e no
 * navegador com o mesmo resultado (as datas são montadas a partir de partes
 * numéricas no fuso de Brasília, sem depender do ICU de cada ambiente, para
 * não dar diferença na hidratação).
 */
import {
  INCIDENT_IMPACT_LABELS,
  STATUS_COMPONENTS,
  type IncidentImpact,
  type PublicIncident,
  type PublicStatusSnapshot,
  type StatusComponentKey,
  type StatusDay,
  type StatusLevel,
} from "@workspace/core/status/public"

export const STATUS_TIME_ZONE = "America/Sao_Paulo"

/** Quantos dias de incidentes passados a página mostra. */
export const PAST_INCIDENT_DAYS = 14

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const

const DATE_KEY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/

const zonedPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: STATUS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

type ZonedParts = { year: number; month: number; day: number; hour: string; minute: string }

/**
 * Data de um timestamptz do Postgres ("2026-09-17T07:22:10.74878+00:00"): os
 * microssegundos viram milissegundos, porque navegadores antigos não leem mais
 * de 3 casas. null quando inválida.
 */
export function parseStatusDate(value: string) {
  const date = new Date(value.replace(/(\.\d{3})\d+/, "$1"))
  return Number.isNaN(date.getTime()) ? null : date
}

function zonedParts(value: string): ZonedParts | null {
  const date = parseStatusDate(value)

  if (!date) {
    return null
  }

  const parts: Record<string, string> = {}

  for (const part of zonedPartsFormatter.formatToParts(date)) {
    parts[part.type] = part.value
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: (parts.hour ?? "00").padStart(2, "0"),
    minute: (parts.minute ?? "00").padStart(2, "0"),
  }
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

/** "AAAA-MM-DD" do instante, no calendário de Brasília. */
export function toStatusDateKey(value: string) {
  const parts = zonedParts(value)
  return parts ? `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` : null
}

/** "14:05" no relógio de Brasília. */
export function formatStatusTime(value: string) {
  const parts = zonedParts(value)
  return parts ? `${parts.hour}:${parts.minute}` : "--:--"
}

/** "17/09 às 14:05" (com o ano quando for outro que o da referência). */
export function formatStatusDateTime(value: string, referenceIso?: string) {
  const parts = zonedParts(value)

  if (!parts) {
    return "data indisponível"
  }

  const reference = referenceIso ? zonedParts(referenceIso) : null
  const year = reference && reference.year !== parts.year ? `/${parts.year}` : ""

  return `${pad2(parts.day)}/${pad2(parts.month)}${year} às ${parts.hour}:${parts.minute}`
}

/** "17 de setembro de 2026" a partir de "2026-09-17". */
export function formatDateKeyLong(dateKey: string) {
  const match = DATE_KEY_REGEX.exec(dateKey)
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined

  if (!match || !month) {
    return dateKey
  }

  return `${Number(match[3])} de ${month} de ${match[1]}`
}

export function addDaysToDateKey(dateKey: string, amount: number) {
  const match = DATE_KEY_REGEX.exec(dateKey)

  if (!match) {
    return dateKey
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount))
    .toISOString()
    .slice(0, 10)
}

/** "99,95%": arredonda para baixo, para 99,996 não virar 100%. */
export function formatUptime(pct: number) {
  const floored = Math.floor(Math.min(100, Math.max(0, pct)) * 100) / 100
  return `${String(floored).replace(".", ",")}%`
}

export function getComponentName(key: StatusComponentKey) {
  return STATUS_COMPONENTS.find((component) => component.key === key)?.name ?? key
}

/**
 * Partes afetadas num texto curto: o nome quando é uma só (os nomes já têm "e",
 * então juntar dois ficaria ambíguo) ou "N partes do sistema".
 */
export function describeComponents(keys: readonly StatusComponentKey[]) {
  const unique = [...new Set(keys)]

  if (unique.length === 0) {
    return null
  }

  if (unique.length === 1) {
    return getComponentName(unique[0]!)
  }

  return `${unique.length} partes do sistema`
}

export function listComponentNames(keys: readonly StatusComponentKey[]) {
  return [...new Set(keys)].map(getComponentName).join(", ")
}

/** Âncora do incidente na página (#incidente-...), só com caracteres seguros. */
export function incidentAnchorId(id: string) {
  return `incidente-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`
}

/** Nível usado para a cor e o ícone de um incidente. */
export function getIncidentLevel(incident: Pick<PublicIncident, "kind" | "impact">): StatusLevel {
  if (incident.kind === "maintenance") {
    return "under_maintenance"
  }

  const byImpact: Record<IncidentImpact, StatusLevel> = {
    none: "operational",
    minor: "degraded_performance",
    major: "partial_outage",
    critical: "major_outage",
  }

  return byImpact[incident.impact]
}

export function getImpactLabel(impact: IncidentImpact) {
  return INCIDENT_IMPACT_LABELS[impact]
}

export type OverallSummary = {
  level: StatusLevel
  title: string
  description: string | null
}

/** Frase grande do topo da página a partir do retrato. */
export function getOverallSummary(snapshot: PublicStatusSnapshot): OverallSummary {
  const { overall } = snapshot
  const hasIncident = snapshot.activeIncidents.some((incident) => incident.kind === "incident")

  if (overall === "operational") {
    const next = snapshot.upcomingMaintenances[0]
    const nextStart = next ? (next.scheduledFor ?? next.startedAt) : null

    return {
      level: overall,
      title: "Todos os sistemas operacionais",
      description: nextStart
        ? `Próxima manutenção agendada: ${formatStatusDateTime(nextStart, snapshot.generatedAt)}.`
        : null,
    }
  }

  const affected = snapshot.components
    .filter((component) =>
      overall === "under_maintenance"
        ? component.level === "under_maintenance"
        : component.level !== "operational" && component.level !== "under_maintenance"
    )
    .map((component) => component.key)
  const target = describeComponents(affected)
  const names = affected.length > 1 ? `Afeta: ${listComponentNames(affected)}. ` : ""

  if (overall === "under_maintenance") {
    return {
      level: overall,
      title: target ? `Em manutenção: ${target}` : "Em manutenção",
      description: `${names}Pode haver lentidão ou indisponibilidade durante a janela programada.`,
    }
  }

  const follow = hasIncident
    ? "A equipe está acompanhando: veja as atualizações abaixo."
    : "Detectado pela checagem automática."

  const titles: Record<Exclude<StatusLevel, "operational" | "under_maintenance">, string> = {
    degraded_performance: target ? `Lentidão em ${target}` : "Lentidão no sistema",
    partial_outage: target ? `Instabilidade em ${target}` : "Instabilidade no sistema",
    major_outage: target ? `Fora do ar: ${target}` : "Sistema fora do ar",
  }

  return { level: overall, title: titles[overall], description: `${names}${follow}` }
}

/**
 * Frase curta da faixa do CRM: só quando há incidente ou manutenção em
 * andamento (null nos demais casos).
 */
export function getActiveIncidentHeadline(snapshot: PublicStatusSnapshot) {
  const incidents = snapshot.activeIncidents.filter((incident) => incident.kind === "incident")
  const maintenances = snapshot.activeIncidents.filter(
    (incident) => incident.kind === "maintenance"
  )

  if (incidents.length > 0) {
    const target = describeComponents(incidents.flatMap((incident) => incident.componentKeys))
    return target ? `Instabilidade em ${target}` : "Instabilidade no sistema"
  }

  if (maintenances.length > 0) {
    const target = describeComponents(maintenances.flatMap((incident) => incident.componentKeys))
    return target ? `Manutenção em andamento: ${target}` : "Manutenção em andamento"
  }

  return null
}

export type IncidentDayGroup = { dateKey: string; incidents: PublicIncident[] }

/**
 * Incidentes agrupados pelo dia em que começaram (ou em que foram resolvidos, se
 * começaram antes da janela), do dia mais recente para o mais antigo, com os
 * dias sem incidente incluídos.
 *
 * Recebe também os que ainda estão abertos: sem eles, o dia de um incidente em
 * andamento mostrava "Nenhum incidente" enquanto a barra do mesmo dia dizia
 * "1 incidente" e o aviso no topo da página continuava lá.
 */
export function groupPastIncidentsByDay(
  incidents: readonly PublicIncident[],
  referenceIso: string,
  days = PAST_INCIDENT_DAYS
): IncidentDayGroup[] {
  const today = toStatusDateKey(referenceIso)

  if (!today) {
    return []
  }

  const oldest = addDaysToDateKey(today, -(days - 1))
  const groups = Array.from({ length: days }, (_, index) => ({
    dateKey: addDaysToDateKey(today, -index),
    incidents: [] as PublicIncident[],
  }))

  for (const incident of incidents) {
    let key = toStatusDateKey(incident.scheduledFor ?? incident.startedAt)

    if (key && key < oldest && incident.resolvedAt) {
      key = toStatusDateKey(incident.resolvedAt)
    }

    groups.find((group) => group.dateKey === key)?.incidents.push(incident)
  }

  return groups
}

/** Nível que pinta o traço do dia: cinza quando não houve medição nem incidente. */
export function getDayLevel(day: StatusDay): StatusLevel | "none" {
  if (day.uptimePct === null && day.worstLevel === "operational") {
    return "none"
  }

  return day.worstLevel
}

export function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}
