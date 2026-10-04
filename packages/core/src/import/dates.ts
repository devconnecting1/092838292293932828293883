/**
 * Datas com hora da planilha (entrada do lead, 1º contato, ganho ou perda).
 * Módulo puro. Aceita o que os sistemas antigos e o Excel brasileiro exportam
 * e devolve ISO 8601 no fuso de Brasília (-03:00), o formato que a RPC
 * import_batch confere.
 */

import { cleanText, type NormalizedResult } from "./normalize"

/** Brasil sem horário de verão desde 2019: o app grava sempre -03:00. */
export const IMPORT_TIME_ZONE_OFFSET = "-03:00"

/** Data sem hora entra ao meio-dia: não muda de dia (nem de mês) em nenhum fuso do país. */
const DATE_ONLY_HOUR = 12

/** Datas antes disso são quase sempre erro de digitação ou de formato. */
export const IMPORT_MIN_DATE = "1990-01-01"

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)

type Parts = { year: number; month: number; day: number; hour: number; minute: number }

function pad(value: number, size = 2) {
  return String(value).padStart(size, "0")
}

function isValidParts(parts: Parts): boolean {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))

  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    parts.hour >= 0 &&
    parts.hour <= 23 &&
    parts.minute >= 0 &&
    parts.minute <= 59
  )
}

function toIso(parts: Parts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:00${IMPORT_TIME_ZONE_OFFSET}`
}

function readTime(text: string | undefined): { hour: number; minute: number } | null {
  if (!text) {
    return { hour: DATE_ONLY_HOUR, minute: 0 }
  }

  const match = text.trim().match(/^(\d{1,2})[:h](\d{2})(?::\d{2}(?:[.,]\d+)?)?$/i)

  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null
}

function parseParts(text: string): Parts | null {
  const iso = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?(?:Z|[+-]\d{2}:?\d{2})?$/
  )

  if (iso) {
    const time = readTime(iso[4])
    return time
      ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]), ...time }
      : null
  }

  const br = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:,?\s+(?:às\s+)?(.+))?$/i)

  if (br) {
    let year = Number(br[3])

    if ((br[3] ?? "").length === 2) {
      year += year > 30 ? 1900 : 2000
    }

    const time = readTime(br[4])
    return time ? { year, month: Number(br[2]), day: Number(br[1]), ...time } : null
  }

  // Número serial do Excel (a fração é a hora do dia).
  if (/^\d{4,5}([.,]\d+)?$/.test(text)) {
    const serial = Number(text.replace(",", "."))
    const date = new Date(EXCEL_EPOCH_UTC + Math.round(serial * 86_400) * 1_000)
    const hasTime = serial % 1 !== 0

    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: hasTime ? date.getUTCHours() : DATE_ONLY_HOUR,
      minute: hasTime ? date.getUTCMinutes() : 0,
    }
  }

  return null
}

/**
 * "15/03/2025", "15/03/2025 14:30", "15/03/25 às 9h05", "2025-03-15T14:30" ou
 * serial do Excel → "2025-03-15T14:30:00-03:00". Vazio vira `null`. Data
 * inválida, antes de 1990 ou no futuro (mais de um dia) é erro.
 */
export function parseImportDateTime(
  raw: string | null | undefined,
  now: Date = new Date()
): NormalizedResult<string> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const parts = parseParts(text)

  if (!parts || !isValidParts(parts)) {
    return { ok: false }
  }

  const iso = toIso(parts)
  const time = Date.parse(iso)

  if (
    !Number.isFinite(time) ||
    iso.slice(0, 10) < IMPORT_MIN_DATE ||
    time > now.getTime() + 86_400_000
  ) {
    return { ok: false }
  }

  return { ok: true, value: iso }
}

/** `a` vem antes de `b` (datas ISO geradas por parseImportDateTime). */
export function isImportDateBefore(a: string, b: string): boolean {
  return Date.parse(a) < Date.parse(b)
}
