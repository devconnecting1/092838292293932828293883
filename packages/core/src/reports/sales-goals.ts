/**
 * Metas mensais (aba "Metas" de /relatorios).
 *
 * As definições são as do banco (`report_sales_goals`, migração
 * `gestao_comercial_equipes_metas`):
 * - leads atendidos = a coluna "Atendidos" de Por corretor com o período do mês;
 * - visitas = agenda com status "realizada" no mês;
 * - propostas = propostas criadas no mês;
 * - vendas e locações = propostas aceitas no mês (quantidade e valor).
 *
 * O mês viaja na URL como "AAAA-MM" e é sempre o mês civil de Brasília.
 */

import { todayInBrasilia } from "./period"

export const GOAL_METRICS = [
  "leadsAnswered",
  "visits",
  "proposals",
  "salesCount",
  "salesAmount",
  "rentalsCount",
  "rentalsAmount",
] as const

export type GoalMetric = (typeof GOAL_METRICS)[number]

export const GOAL_METRIC_LABELS: Record<GoalMetric, string> = {
  leadsAnswered: "Leads atendidos",
  visits: "Visitas realizadas",
  proposals: "Propostas feitas",
  salesCount: "Vendas",
  salesAmount: "Valor em vendas",
  rentalsCount: "Locações",
  rentalsAmount: "Valor em locações",
}

/** Indicadores em reais (os demais são quantidades inteiras). */
export const GOAL_AMOUNT_METRICS: readonly GoalMetric[] = ["salesAmount", "rentalsAmount"]

export function isGoalAmountMetric(metric: GoalMetric) {
  return GOAL_AMOUNT_METRICS.includes(metric)
}

export const GOAL_METRIC_DESCRIPTIONS: Record<GoalMetric, string> = {
  leadsAnswered: "Leads entregues no mês que tiveram o 1º contato registrado.",
  visits: "Visitas da agenda marcadas como realizadas no mês.",
  proposals: "Propostas criadas no mês.",
  salesCount: "Propostas de venda aceitas no mês.",
  salesAmount: "Soma das propostas de venda aceitas no mês.",
  rentalsCount: "Propostas de locação aceitas no mês.",
  rentalsAmount: "Soma das propostas de locação aceitas no mês.",
}

/** Valores de um conjunto de indicadores (meta ou realizado). */
export type GoalValues<Value> = Record<GoalMetric, Value>

// -----------------------------------------------------------------------------
// Mês
// -----------------------------------------------------------------------------

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/
const MIN_YEAR = 2000
const MAX_YEAR = 2099

const monthLabelFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
})

/** "AAAA-MM" dentro do intervalo que o banco aceita (2000 a 2099). */
export function isMonthKey(value: unknown): value is string {
  if (typeof value !== "string") return false

  const match = MONTH_PATTERN.exec(value)
  if (!match) return false

  const year = Number(match[1])
  return year >= MIN_YEAR && year <= MAX_YEAR
}

/** Mês atual de Brasília. */
export function currentMonthKey(now: Date = new Date()): string {
  return todayInBrasilia(now).slice(0, 7)
}

/** Mês da URL, ou o mês atual quando o valor não serve. */
export function resolveGoalMonth(value: unknown, now: Date = new Date()): string {
  return isMonthKey(value) ? value : currentMonthKey(now)
}

export function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4))
  const monthIndex = Number(month.slice(5, 7)) - 1 + delta
  const date = new Date(Date.UTC(year, monthIndex, 1))

  return date.toISOString().slice(0, 7)
}

/** Primeiro dia do mês ("AAAA-MM-01"), o formato do parâmetro `p_month`. */
export function monthFirstDay(month: string): string {
  return `${month}-01`
}

export function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))

  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
}

/** "setembro de 2026". */
export function formatMonthLabel(month: string): string {
  return monthLabelFormat.format(new Date(`${month}-01T00:00:00Z`))
}

/** Meses para o seletor: do mais recente (`after` meses à frente) ao mais antigo. */
export function goalMonthOptions(
  selected: string,
  now: Date = new Date(),
  { before = 12, after = 2 }: { before?: number; after?: number } = {}
): { value: string; label: string }[] {
  const current = currentMonthKey(now)
  const months = new Set<string>()

  for (let delta = after; delta >= -before; delta -= 1) {
    const month = shiftMonth(current, delta)
    if (isMonthKey(month)) months.add(month)
  }

  if (isMonthKey(selected)) months.add(selected)

  return [...months]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((value) => ({ value, label: formatMonthLabel(value) }))
}

// -----------------------------------------------------------------------------
// Progresso
// -----------------------------------------------------------------------------

export type GoalProgress = {
  /** Realizado ÷ meta, sem teto (1,25 = 125%). `null` sem meta. */
  ratio: number | null
  /** Largura da barra, de 0 a 100. */
  barValue: number
  reached: boolean
}

/**
 * Progresso de um indicador. Sem meta (`null`) não há barra. Meta zero conta
 * como atingida: não há o que perseguir.
 */
export function goalProgress(actual: number, goal: number | null): GoalProgress {
  if (goal === null || !Number.isFinite(goal) || goal < 0) {
    return { ratio: null, barValue: 0, reached: false }
  }

  const done = Number.isFinite(actual) ? Math.max(actual, 0) : 0

  if (goal === 0) {
    return { ratio: 1, barValue: 100, reached: true }
  }

  const ratio = done / goal

  return {
    ratio,
    barValue: Math.min(Math.round(ratio * 1000) / 10, 100),
    reached: ratio >= 1,
  }
}

/**
 * Projeção linear até o fim do mês: o ritmo dos dias já passados (incluindo
 * hoje) estendido ao mês inteiro. Mês fechado devolve o próprio realizado; mês
 * que ainda não começou devolve `null`.
 */
export function projectMonthEnd(
  actual: number,
  month: string,
  now: Date = new Date()
): number | null {
  if (!isMonthKey(month) || !Number.isFinite(actual)) return null

  const today = todayInBrasilia(now)
  const current = today.slice(0, 7)

  if (month < current) return actual
  if (month > current) return null

  const elapsed = Number(today.slice(8, 10))
  const projected = (Math.max(actual, 0) / elapsed) * daysInMonth(month)

  return Math.round(projected * 100) / 100
}

/** Pelo menos um indicador com meta definida. */
export function hasAnyGoal(goal: GoalValues<number | null>): boolean {
  return GOAL_METRICS.some((metric) => goal[metric] !== null)
}
