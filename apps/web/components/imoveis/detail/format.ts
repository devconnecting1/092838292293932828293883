import { formatDate } from "@/lib/format"
import { todayInSaoPaulo } from "@/lib/imoveis/mappers"

/** Brasília é sempre UTC-3 (sem horário de verão desde 2019). */
const BRASILIA_UTC_OFFSET = "-03:00"

const percentFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
})

/**
 * Colunas `date` (AAAA-MM-DD). `new Date("2026-09-15")` é meia-noite UTC e
 * cairia no dia anterior em São Paulo; ancoramos ao meio-dia de Brasília.
 */
export function formatDateOnly(value: string | null | undefined) {
  if (!value) return "—"
  return formatDate(`${value}T12:00:00${BRASILIA_UTC_OFFSET}`)
}

/** Data (AAAA-MM-DD) em São Paulo de um timestamptz, para inputs type="date". */
export function timestampToDateInput(value: string | null | undefined) {
  if (!value) return ""
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "" : todayInSaoPaulo(parsed)
}

/** Data de assinatura (input date) gravada ao meio-dia de Brasília. */
export function dateInputToTimestamp(value: string) {
  return value ? `${value}T12:00:00${BRASILIA_UTC_OFFSET}` : null
}

export function formatPercent(value: number | null | undefined) {
  return value == null ? "—" : `${percentFormat.format(value)}%`
}

export function formatPostalCode(value: string | null | undefined) {
  if (!value) return "—"
  return /^\d{8}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5)}` : value
}

export function formatPhone(value: string | null | undefined) {
  if (!value) return "—"
  let digits = value.replace(/\D/g, "")
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2)
  if (digits.length === 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return value
}

export function formatYesNo(value: boolean) {
  return value ? "Sim" : "Não"
}

export function formatFloor(value: number | null | undefined) {
  if (value == null) return "—"
  if (value === 0) return "Térreo"
  if (value < 0) return `Subsolo ${Math.abs(value)}`
  return `${value}º`
}
