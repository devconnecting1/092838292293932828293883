/**
 * Formas de dados dos gráficos do Painel.
 *
 * As contagens vêm agregadas do Postgres (RPCs `dashboard_*` da migração
 * 20260916013329_painel_charts.sql, todas `security invoker`: o resultado já
 * respeita o RLS de quem está logado). Aqui só montamos a série completa,
 * escolhemos as cores do tema e formatamos os rótulos em pt-BR — no servidor,
 * para o HTML enviado e o do navegador baterem.
 */

import { PROPERTY_STATUS_LABELS, type PropertyStatus } from "@workspace/core/properties/enums"

import {
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
} from "@/lib/leads/constants"
import type { LeadSource, LeadStage } from "@/lib/leads/db-types"

/** O Brasil não tem horário de verão desde 2019: Brasília é sempre UTC-3. */
const TIME_ZONE = "America/Sao_Paulo"
const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** Semanas do gráfico de captação (a RPC aceita de 4 a 26). */
export const LEADS_CHART_WEEKS = 12
/** Janela do funil por etapa (a RPC aceita de 7 a 365). */
export const LEADS_FUNNEL_DAYS = 90

/** O tema define 5 cores de gráfico; acima disso as origens viram "Outras". */
const MAX_SOURCE_SERIES = 5
const OTHER_SOURCES_KEY = "outras"

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const

function chartColor(index: number): string {
  return CHART_COLORS[index] ?? CHART_COLORS[0]
}

// -----------------------------------------------------------------------------
// Datas e números
// -----------------------------------------------------------------------------

const brasiliaDayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

// As datas já chegam como dia civil (AAAA-MM-DD) do Postgres, então a leitura
// é feita em UTC: não existe hora para o fuso deslocar.
const dayMonthFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
})

const fullDateFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

const compactCurrencyFormat = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
})

const integerFormat = new Intl.NumberFormat("pt-BR")

/** "15/09" a partir de um dia civil AAAA-MM-DD. */
export function formatDayMonth(day: string) {
  return dayMonthFormat.format(new Date(`${day}T00:00:00Z`))
}

/** "15/09/2026" a partir de um dia civil AAAA-MM-DD. */
export function formatFullDate(day: string) {
  return fullDateFormat.format(new Date(`${day}T00:00:00Z`))
}

/** "R$ 12,4 mi" — para os rodapés, onde o valor exato não cabe. */
export function formatCompactCurrency(value: number) {
  return compactCurrencyFormat.format(value)
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`)
  return new Date(date.getTime() + days * ONE_DAY_MS).toISOString().slice(0, 10)
}

/** Segunda-feira da semana do dia informado (mesma regra do date_trunc de semana). */
function weekStartOf(day: string) {
  const date = new Date(`${day}T00:00:00Z`)
  const daysFromMonday = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - daysFromMonday * ONE_DAY_MS).toISOString().slice(0, 10)
}

// -----------------------------------------------------------------------------
// Leads por semana
// -----------------------------------------------------------------------------

/** Linha da RPC `dashboard_leads_by_week`. */
export type LeadsWeeklyRow = {
  week_start: string
  source: LeadSource
  total: number
}

export type LeadsWeeklySeries = {
  /** Chave da série: um valor de `lead_source` ou "outras". */
  key: string
  label: string
  /** Token do tema (`var(--chart-N)`), nunca uma cor crua. */
  color: string
}

export type LeadsWeeklyPoint = {
  weekStart: string
  /** Eixo X: "15/09". */
  label: string
  /** Tooltip: "15/09 a 21/09". */
  rangeLabel: string
  total: number
  /** Uma chave por série de origem, com a contagem da semana. */
  [seriesKey: string]: string | number
}

export type LeadsWeeklyChart = {
  points: LeadsWeeklyPoint[]
  series: LeadsWeeklySeries[]
  total: number
  weeks: number
  /** "22/06/2026 a 20/09/2026". */
  periodLabel: string
  /** Leads da semana corrente (último ponto da série). */
  currentWeekTotal: number
  /** Média semanal do período, com uma casa decimal. */
  weeklyAverage: number
}

export function buildLeadsWeeklyChart(
  rows: readonly LeadsWeeklyRow[],
  options: { weeks?: number; now?: Date } = {}
): LeadsWeeklyChart {
  const weeks = options.weeks ?? LEADS_CHART_WEEKS
  const currentWeek = weekStartOf(brasiliaDayFormat.format(options.now ?? new Date()))

  const weekDays: string[] = []
  for (let index = weeks - 1; index >= 0; index -= 1) {
    weekDays.push(addDays(currentWeek, -index * 7))
  }

  const totalsBySource = new Map<LeadSource, number>()
  for (const row of rows) {
    totalsBySource.set(row.source, (totalsBySource.get(row.source) ?? 0) + row.total)
  }

  // Origens mais fortes primeiro (ficam na base da pilha); empate pela ordem do enum.
  const ranked = [...totalsBySource.entries()]
    .filter(([, total]) => total > 0)
    .sort(
      ([sourceA, totalA], [sourceB, totalB]) =>
        totalB - totalA || LEAD_SOURCES.indexOf(sourceA) - LEAD_SOURCES.indexOf(sourceB)
    )

  const needsOtherSeries = ranked.length > MAX_SOURCE_SERIES
  const named = needsOtherSeries ? ranked.slice(0, MAX_SOURCE_SERIES - 1) : ranked
  const namedKeys = new Set<string>(named.map(([source]) => source))

  const series: LeadsWeeklySeries[] = named.map(([source], index) => ({
    key: source,
    label: LEAD_SOURCE_LABELS[source],
    color: chartColor(index),
  }))

  if (needsOtherSeries) {
    series.push({
      key: OTHER_SOURCES_KEY,
      label: "Outras origens",
      color: chartColor(MAX_SOURCE_SERIES - 1),
    })
  }

  const countsByWeek = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const key = namedKeys.has(row.source) ? row.source : OTHER_SOURCES_KEY
    let counts = countsByWeek.get(row.week_start)

    if (!counts) {
      counts = new Map<string, number>()
      countsByWeek.set(row.week_start, counts)
    }

    counts.set(key, (counts.get(key) ?? 0) + row.total)
  }

  let total = 0
  const points = weekDays.map((day) => {
    const counts = countsByWeek.get(day)
    const point: LeadsWeeklyPoint = {
      weekStart: day,
      label: formatDayMonth(day),
      rangeLabel: `${formatDayMonth(day)} a ${formatDayMonth(addDays(day, 6))}`,
      total: 0,
    }

    let weekTotal = 0
    for (const item of series) {
      const value = counts?.get(item.key) ?? 0
      point[item.key] = value
      weekTotal += value
    }

    point.total = weekTotal
    total += weekTotal
    return point
  })

  const firstDay = weekDays[0] ?? currentWeek
  const lastDay = weekDays[weekDays.length - 1] ?? currentWeek

  return {
    points,
    series,
    total,
    weeks,
    periodLabel: `${formatFullDate(firstDay)} a ${formatFullDate(addDays(lastDay, 6))}`,
    currentWeekTotal: points[points.length - 1]?.total ?? 0,
    weeklyAverage: weeks > 0 ? Math.round((total / weeks) * 10) / 10 : 0,
  }
}

// -----------------------------------------------------------------------------
// Funil de leads por etapa
// -----------------------------------------------------------------------------

/** Linha da RPC `dashboard_leads_by_stage`. */
export type LeadsStageRow = {
  stage: LeadStage
  total: number
}

export type LeadsFunnelBar = {
  stage: LeadStage
  label: string
  total: number
  /** Rótulo pronto, desenhado ao lado da barra (evita formatar no navegador). */
  totalLabel: string
  /** Fatia do total do período (0 a 1). */
  share: number
}

export type LeadsFunnelChart = {
  bars: LeadsFunnelBar[]
  total: number
  won: number
  lost: number
  /** Leads ainda em aberto (nem ganhos nem perdidos). */
  open: number
  days: number
}

export function buildLeadsFunnelChart(
  rows: readonly LeadsStageRow[],
  options: { days?: number } = {}
): LeadsFunnelChart {
  const totalsByStage = new Map<LeadStage, number>()
  for (const row of rows) {
    totalsByStage.set(row.stage, (totalsByStage.get(row.stage) ?? 0) + row.total)
  }

  let total = 0
  for (const value of totalsByStage.values()) {
    total += value
  }

  const bars = LEAD_STAGES.map((stage) => {
    const value = totalsByStage.get(stage) ?? 0

    return {
      stage,
      label: LEAD_STAGE_LABELS[stage],
      total: value,
      totalLabel: integerFormat.format(value),
      share: total > 0 ? value / total : 0,
    }
  })

  const won = totalsByStage.get("won") ?? 0
  const lost = totalsByStage.get("lost") ?? 0

  return {
    bars,
    total,
    won,
    lost,
    open: total - won - lost,
    days: options.days ?? LEADS_FUNNEL_DAYS,
  }
}

// -----------------------------------------------------------------------------
// Imóveis por status
// -----------------------------------------------------------------------------

/** Linha da RPC `dashboard_properties_by_status`. */
export type PropertiesStatusRow = {
  status: PropertyStatus
  total: number
  sale_value: number
  rent_value: number
}

export type PropertiesStatusSlice = {
  status: PropertyStatus
  label: string
  total: number
  saleValue: number
  rentValue: number
  color: string
}

export type PropertiesStatusChart = {
  slices: PropertiesStatusSlice[]
  total: number
  /** Imóveis prontos para anunciar (status "Ativo"). */
  active: number
  saleValue: number
  rentValue: number
}

/** Ordem de leitura: o que está na rua primeiro, rascunho por último. */
const PROPERTY_STATUS_ORDER: readonly PropertyStatus[] = [
  "active",
  "reserved",
  "sold",
  "rented",
  "inactive",
  "draft",
]

const PROPERTY_STATUS_COLORS: Record<PropertyStatus, string> = {
  active: "var(--chart-1)",
  reserved: "var(--chart-2)",
  sold: "var(--chart-3)",
  rented: "var(--chart-4)",
  inactive: "var(--chart-5)",
  // Rascunho não é carteira anunciada: fica com o cinza do tema, fora da paleta.
  draft: "var(--muted-foreground)",
}

export function buildPropertiesStatusChart(
  rows: readonly PropertiesStatusRow[]
): PropertiesStatusChart {
  const rowsByStatus = new Map<PropertyStatus, PropertiesStatusRow>()
  for (const row of rows) {
    rowsByStatus.set(row.status, row)
  }

  const slices: PropertiesStatusSlice[] = []
  let total = 0
  let saleValue = 0
  let rentValue = 0

  for (const status of PROPERTY_STATUS_ORDER) {
    const row = rowsByStatus.get(status)

    if (!row || row.total <= 0) {
      continue
    }

    slices.push({
      status,
      label: PROPERTY_STATUS_LABELS[status],
      total: row.total,
      saleValue: row.sale_value,
      rentValue: row.rent_value,
      color: PROPERTY_STATUS_COLORS[status],
    })

    total += row.total
    saleValue += row.sale_value
    rentValue += row.rent_value
  }

  return {
    slices,
    total,
    active: rowsByStatus.get("active")?.total ?? 0,
    saleValue,
    rentValue,
  }
}
