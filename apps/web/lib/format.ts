// Formatação pt-BR com fuso fixo, para o HTML do servidor e o do navegador baterem.
const TIME_ZONE = "America/Sao_Paulo"

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
})

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 })

const date = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: TIME_ZONE,
})

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: TIME_ZONE,
})

const time = new Intl.DateTimeFormat("pt-BR", {
  timeStyle: "short",
  timeZone: TIME_ZONE,
})

type DateInput = string | Date | null | undefined

function toDate(value: DateInput) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatCurrency(value: number | null | undefined) {
  return value == null ? "—" : currency.format(value)
}

export function formatNumber(value: number | null | undefined) {
  return value == null ? "—" : number.format(value)
}

export function formatArea(value: number | null | undefined) {
  return value == null ? "—" : `${number.format(value)} m²`
}

export function formatDate(value: DateInput) {
  const parsed = toDate(value)
  return parsed ? date.format(parsed) : "—"
}

export function formatDateTime(value: DateInput) {
  const parsed = toDate(value)
  return parsed ? dateTime.format(parsed) : "—"
}

export function formatTime(value: DateInput) {
  const parsed = toDate(value)
  return parsed ? time.format(parsed) : "—"
}
