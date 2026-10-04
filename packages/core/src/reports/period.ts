/**
 * Período dos relatórios.
 *
 * O período é sempre um intervalo de DIAS CIVIS de Brasília, fechado no começo
 * e aberto no fim: "01/09 a 16/09" vira `[2026-09-01T00:00:00-03:00,
 * 2026-09-17T00:00:00-03:00)`. É esse par que vai para as RPCs, e é por isso
 * que o relatório de um dia não perde o que aconteceu às 23h.
 *
 * O Brasil não tem horário de verão desde 2019: Brasília é sempre UTC-3, então
 * dá para montar o instante com o deslocamento fixo em vez de carregar uma base
 * de fusos. As contas de dia são feitas em UTC (`AAAA-MM-DDT00:00:00Z`), onde
 * somar 24 h é sempre somar um dia.
 */

export const REPORT_TIME_ZONE = "America/Sao_Paulo"
const BRASILIA_UTC_OFFSET = "-03:00"
const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** Mesmo teto de `private.report_window` na migração `relatorios_desempenho`. */
export const REPORT_MAX_DAYS = 400

export const REPORT_PERIOD_PRESETS = [
  "7-dias",
  "30-dias",
  "90-dias",
  "mes-atual",
  "mes-passado",
  "ano-atual",
] as const

export type ReportPeriodPreset = (typeof REPORT_PERIOD_PRESETS)[number]

export const REPORT_PERIOD_PRESET_LABELS: Record<ReportPeriodPreset, string> = {
  "7-dias": "Últimos 7 dias",
  "30-dias": "Últimos 30 dias",
  "90-dias": "Últimos 90 dias",
  "mes-atual": "Mês atual",
  "mes-passado": "Mês passado",
  "ano-atual": "Ano atual",
}

export const DEFAULT_REPORT_PERIOD_PRESET: ReportPeriodPreset = "30-dias"

export type ReportPeriod = {
  /** `null` quando as datas foram escolhidas à mão. */
  preset: ReportPeriodPreset | null
  /** Primeiro dia do período ("AAAA-MM-DD"), incluído. */
  fromDay: string
  /** Último dia do período ("AAAA-MM-DD"), incluído. */
  toDay: string
  /** Começo do período em ISO, para a RPC. */
  from: string
  /** Fim EXCLUSIVO em ISO (meia-noite do dia seguinte a `toDay`). */
  to: string
  /** Quantidade de dias do período (mínimo 1). */
  days: number
  /** "01/09/2026 a 16/09/2026". */
  label: string
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

// A data já é um dia civil, então a leitura é em UTC: não há hora para o fuso mexer.
const brazilianDayFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

/** "AAAA-MM-DD" que existe de verdade no calendário. */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) {
    return false
  }

  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isReportPeriodPreset(value: unknown): value is ReportPeriodPreset {
  return typeof value === "string" && (REPORT_PERIOD_PRESETS as readonly string[]).includes(value)
}

/** Hoje em Brasília, como dia civil. */
export function todayInBrasilia(now: Date = new Date()): string {
  return dayFormat.format(now)
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  return new Date(date.getTime() + days * ONE_DAY_MS).toISOString().slice(0, 10)
}

/** Dias de `from` até `to`, contando os dois extremos. */
export function daysBetween(fromDay: string, toDay: string): number {
  const from = new Date(`${fromDay}T00:00:00Z`).getTime()
  const to = new Date(`${toDay}T00:00:00Z`).getTime()
  return Math.floor((to - from) / ONE_DAY_MS) + 1
}

function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`
}

function endOfMonth(day: string): string {
  return addDays(addDays(startOfMonth(day), 31).slice(0, 7) + "-01", -1)
}

/** Meia-noite do dia, no fuso de Brasília, em ISO. */
export function dayStartIso(day: string): string {
  return new Date(`${day}T00:00:00${BRASILIA_UTC_OFFSET}`).toISOString()
}

/** "01/09/2026 a 16/09/2026" (ou só a data quando o período tem um dia só). */
export function formatPeriodLabel(fromDay: string, toDay: string): string {
  const from = brazilianDayFormat.format(new Date(`${fromDay}T00:00:00Z`))

  if (fromDay === toDay) {
    return from
  }

  return `${from} a ${brazilianDayFormat.format(new Date(`${toDay}T00:00:00Z`))}`
}

function daysOfPreset(
  preset: ReportPeriodPreset,
  today: string
): { fromDay: string; toDay: string } {
  switch (preset) {
    case "7-dias":
      return { fromDay: addDays(today, -6), toDay: today }
    case "90-dias":
      return { fromDay: addDays(today, -89), toDay: today }
    case "mes-atual":
      return { fromDay: startOfMonth(today), toDay: today }
    case "mes-passado": {
      const lastMonthDay = addDays(startOfMonth(today), -1)
      return { fromDay: startOfMonth(lastMonthDay), toDay: endOfMonth(lastMonthDay) }
    }
    case "ano-atual":
      return { fromDay: `${today.slice(0, 4)}-01-01`, toDay: today }
    default:
      return { fromDay: addDays(today, -29), toDay: today }
  }
}

function buildPeriod(
  preset: ReportPeriodPreset | null,
  fromDay: string,
  toDay: string
): ReportPeriod {
  return {
    preset,
    fromDay,
    toDay,
    from: dayStartIso(fromDay),
    // Fim exclusivo: o dia inteiro de `toDay` entra no relatório.
    to: dayStartIso(addDays(toDay, 1)),
    days: daysBetween(fromDay, toDay),
    label: formatPeriodLabel(fromDay, toDay),
  }
}

export type ReportPeriodInput = {
  preset?: string | null
  from?: string | null
  to?: string | null
}

/**
 * Período a partir do que veio na URL. Nada aqui confia no parâmetro:
 *
 * - preset conhecido vence (é o caminho normal da tela);
 * - datas à mão só valem se as duas forem dias reais; invertidas, são trocadas;
 * - o fim nunca passa de hoje e o começo nunca fica a mais de 400 dias do fim
 *   (o mesmo teto do banco, para a tela não pedir o que a RPC vai recortar);
 * - qualquer outra coisa cai nos últimos 30 dias.
 */
export function resolveReportPeriod(
  input: ReportPeriodInput = {},
  now: Date = new Date()
): ReportPeriod {
  const today = todayInBrasilia(now)

  if (isDayKey(input.from) && isDayKey(input.to)) {
    const [rawFrom, rawTo] =
      input.from <= input.to ? [input.from, input.to] : [input.to, input.from]
    const toDay = rawTo > today ? today : rawTo
    const earliest = addDays(toDay, -(REPORT_MAX_DAYS - 1))
    const fromDay = rawFrom < earliest ? earliest : rawFrom > toDay ? toDay : rawFrom

    return buildPeriod(null, fromDay, toDay)
  }

  const preset = isReportPeriodPreset(input.preset) ? input.preset : DEFAULT_REPORT_PERIOD_PRESET
  const { fromDay, toDay } = daysOfPreset(preset, today)

  return buildPeriod(preset, fromDay, toDay)
}
