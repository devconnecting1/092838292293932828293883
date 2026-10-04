/**
 * Datas e horários de agenda, tarefas e clientes, sempre no fuso de Brasília.
 * O Brasil não tem horário de verão desde 2019: o deslocamento é fixo em
 * -03:00 (mesma premissa do painel). Módulo puro, usado no servidor e no
 * navegador.
 *
 * Convenções:
 *   - date key:  "AAAA-MM-DD" no calendário de Brasília
 *   - time key:  "HH:MM" (24 h) no relógio de Brasília
 *   - month key: "AAAA-MM"
 */
export const TIME_ZONE = "America/Sao_Paulo"
export const SAO_PAULO_UTC_OFFSET = "-03:00"

const DATE_KEY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_KEY_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/
const MONTH_KEY_REGEX = /^(\d{4})-(0[1-9]|1[0-2])$/

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

const timeKeyFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

// Datas-chave são formatadas em UTC ao meio-dia para não "escorregarem" de dia.
const shortDateKeyFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  dateStyle: "short",
})

const longDateKeyFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
  year: "numeric",
})

const weekdayDateKeyFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
})

const monthKeyFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
})

type DateInput = string | number | Date

function toDate(value: DateInput) {
  return value instanceof Date ? value : new Date(value)
}

function parseDateKey(value: string) {
  const match = DATE_KEY_REGEX.exec(value)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))

  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && parseDateKey(value) !== null
}

export function isTimeKey(value: unknown): value is string {
  return typeof value === "string" && TIME_KEY_REGEX.test(value)
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_REGEX.test(value)
}

/** "AAAA-MM-DD" do instante informado, no calendário de Brasília. */
export function toDateKey(value: DateInput) {
  return dateKeyFormatter.format(toDate(value))
}

/** "HH:MM" do instante informado, no relógio de Brasília. */
export function toTimeKey(value: DateInput) {
  return timeKeyFormatter.format(toDate(value))
}

export function toMonthKey(value: DateInput) {
  return toDateKey(value).slice(0, 7)
}

/** Converte data e hora de Brasília em ISO (UTC) para gravar em timestamptz. */
export function zonedToIso(dateKey: string, timeKey = "00:00") {
  return new Date(`${dateKey}T${timeKey}:00${SAO_PAULO_UTC_OFFSET}`).toISOString()
}

export function addDays(dateKey: string, amount: number) {
  const parsed = parseDateKey(dateKey)

  if (!parsed) {
    return dateKey
  }

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount))
    .toISOString()
    .slice(0, 10)
}

export function addMonths(monthKey: string, amount: number) {
  const match = MONTH_KEY_REGEX.exec(monthKey)

  if (!match) {
    return monthKey
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + amount, 1))
    .toISOString()
    .slice(0, 7)
}

/** Intervalo [start, end) do dia em Brasília, em ISO. */
export function getDayRange(dateKey: string) {
  return {
    start: zonedToIso(dateKey),
    end: zonedToIso(addDays(dateKey, 1)),
  }
}

/** Intervalo [start, end) do mês em Brasília, em ISO. */
export function getMonthRange(monthKey: string) {
  return {
    start: zonedToIso(`${monthKey}-01`),
    end: zonedToIso(`${addMonths(monthKey, 1)}-01`),
  }
}

/** Data local (meia-noite do navegador) para o componente Calendar. */
export function dateKeyToLocalDate(dateKey: string) {
  const parsed = parseDateKey(dateKey)

  if (!parsed) {
    return undefined
  }

  return new Date(parsed.year, parsed.month - 1, parsed.day)
}

/** Date local escolhida no Calendar para "AAAA-MM-DD". */
export function localDateToDateKey(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

export function formatDateKey(dateKey: string, style: "short" | "long" | "weekday" = "short") {
  const parsed = parseDateKey(dateKey)

  if (!parsed) {
    return "—"
  }

  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12))
  const formatter =
    style === "long"
      ? longDateKeyFormatter
      : style === "weekday"
        ? weekdayDateKeyFormatter
        : shortDateKeyFormatter

  return formatter.format(date)
}

export function formatMonthKey(monthKey: string) {
  const match = MONTH_KEY_REGEX.exec(monthKey)

  if (!match) {
    return "—"
  }

  return monthKeyFormatter.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15)))
}
