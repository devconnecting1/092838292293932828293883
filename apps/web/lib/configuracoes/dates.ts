// Datas "só dia" (colunas date) comparadas no fuso de Brasília, sem passar por Date/UTC.
const TIME_ZONE = "America/Sao_Paulo"
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function isDateOnly(value: string) {
  const match = DATE_ONLY_PATTERN.exec(value)

  if (!match) return false

  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  )
}

/** Hoje em Brasília, no formato AAAA-MM-DD. */
export function todayInSaoPaulo(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export function addDaysToDateOnly(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days))
  return date.toISOString().slice(0, 10)
}

/** "2026-09-30" → "30/09/2026" (sem converter fuso). */
export function formatDateOnly(value: string | null | undefined) {
  if (!value || !isDateOnly(value)) return "—"

  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

export type CreciStatus = "missing" | "valid" | "expiring" | "expired"

/** Situação da validade do CRECI; "expiring" quando vence nos próximos `warnDays` dias. */
export function getCreciStatus(
  validUntil: string | null | undefined,
  today: string,
  warnDays = 30
): CreciStatus {
  if (!validUntil || !isDateOnly(validUntil)) return "missing"
  if (validUntil < today) return "expired"
  if (validUntil <= addDaysToDateOnly(today, warnDays)) return "expiring"
  return "valid"
}
