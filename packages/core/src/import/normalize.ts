/**
 * Normalização das células da planilha para os formatos gravados no banco.
 * Módulo puro. Cada função recebe o texto da célula (já convertido pela tela:
 * número do .xlsx com vírgula decimal, data como AAAA-MM-DD) e devolve o valor
 * normalizado ou `null` quando não dá para aproveitar.
 */

import {
  isValidCnpj,
  isValidCpf,
  isValidPhoneBr,
  normalizeCnpj,
  normalizePhoneBr,
  onlyDigits,
} from "../br/documents"
import { BRAZILIAN_STATES, isStateCode, type StateCode } from "../br/states"

/** Minúsculas, sem acento e só letras/números separados por um espaço. */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Texto aparado, com espaços internos repetidos reduzidos a um. Vazio vira null. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const cleaned = value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned.length > 0 ? cleaned : null
}

/** Texto longo (observações, descrição): mantém as quebras de linha. */
export function cleanLongText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const cleaned = value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{Cc}\n\t]/gu, "")
    .trim()

  return cleaned.length > 0 ? cleaned : null
}

/** Corta no limite e avisa se cortou. */
export function truncate(value: string, max: number): { value: string; truncated: boolean } {
  if (value.length <= max) {
    return { value, truncated: false }
  }

  return { value: value.slice(0, max).trimEnd(), truncated: true }
}

// ---------------------------------------------------------------------------
// Contato
// ---------------------------------------------------------------------------

const EMAIL_PATTERN =
  /^[a-z0-9._+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/

/** Mesma regra do banco (leads_before_write): minúsculo, sem espaço e sem "..". */
export function isValidImportEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value) && !value.includes("..")
}

/** Várias opções na mesma célula ("a@x.com; b@y.com"): fica a primeira. */
function firstPart(value: string): string {
  return (value.split(/\s*[;,|/]\s*|\s+e\s+|\s+ou\s+/)[0] ?? "").trim()
}

export type NormalizedResult<T> = { ok: true; value: T | null } | { ok: false }

/** E-mail em minúsculas. Célula vazia é ok com `null`; formato ruim é erro. */
export function normalizeImportEmail(raw: string | null | undefined): NormalizedResult<string> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const email = firstPart(text.replace(/^mailto:/i, "")).toLowerCase()

  return isValidImportEmail(email) ? { ok: true, value: email } : { ok: false }
}

/**
 * Telefone brasileiro só com dígitos e com DDD (10 ou 11 dígitos). Tira o +55,
 * o zero da operadora ("0 11 ...") e, com vários números na célula, usa o
 * primeiro. Sem DDD ou com DDD inexistente é erro.
 */
export function normalizeImportPhone(raw: string | null | undefined): NormalizedResult<string> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const parts = text.split(/\s*[;,|/]\s*|\s+e\s+|\s+ou\s+/).filter((part) => onlyDigits(part))

  for (const part of parts.length > 0 ? parts : [text]) {
    let digits = normalizePhoneBr(part)

    if ((digits.length === 11 || digits.length === 12) && digits.startsWith("0")) {
      digits = digits.slice(1)
    }

    if (isValidPhoneBr(digits)) {
      return { ok: true, value: digits }
    }
  }

  return { ok: false }
}

/** Chave de duplicidade do telefone: os últimos 11 dígitos (igual ao índice do banco). */
export function phoneKey(phone: string): string {
  return phone.slice(-11)
}

/**
 * CPF (11 dígitos) ou CNPJ (14 caracteres). O Excel costuma apagar zeros à
 * esquerda de CPF digitado como número; completa com zeros quando isso torna o
 * documento válido.
 */
export function normalizeImportDocument(
  raw: string | null | undefined
): NormalizedResult<{ document: string; kind: "pf" | "pj" }> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const compact = normalizeCnpj(text)

  if (/^[0-9]+$/.test(compact)) {
    if (compact.length >= 9 && compact.length <= 11) {
      const cpf = compact.padStart(11, "0")

      if (isValidCpf(cpf)) {
        return { ok: true, value: { document: cpf, kind: "pf" } }
      }
    }

    if (compact.length >= 12 && compact.length <= 14) {
      const cnpj = compact.padStart(14, "0")

      if (isValidCnpj(cnpj)) {
        return { ok: true, value: { document: cnpj, kind: "pj" } }
      }
    }

    return { ok: false }
  }

  return isValidCnpj(compact)
    ? { ok: true, value: { document: compact, kind: "pj" } }
    : { ok: false }
}

// ---------------------------------------------------------------------------
// Endereço
// ---------------------------------------------------------------------------

/** CEP com 8 dígitos (completa o zero à esquerda que o Excel apaga). */
export function normalizeImportPostalCode(
  raw: string | null | undefined
): NormalizedResult<string> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const digits = onlyDigits(text)

  if (digits.length === 7 || digits.length === 8) {
    return { ok: true, value: digits.padStart(8, "0") }
  }

  return { ok: false }
}

const STATE_BY_NAME = new Map<string, StateCode>(
  BRAZILIAN_STATES.map((state) => [normalizeLabel(state.name), state.code])
)

/** UF pela sigla ("sp") ou pelo nome ("São Paulo"). */
export function normalizeImportState(raw: string | null | undefined): NormalizedResult<StateCode> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const upper = text.toUpperCase()

  if (isStateCode(upper)) {
    return { ok: true, value: upper }
  }

  const byName = STATE_BY_NAME.get(normalizeLabel(text))

  return byName ? { ok: true, value: byName } : { ok: false }
}

// ---------------------------------------------------------------------------
// Números, datas e sim/não
// ---------------------------------------------------------------------------

/**
 * Número em pt-BR ou em inglês: "R$ 1.234,56", "1234,5", "1234.56",
 * "450.000" (milhar) e "1,234.56". Vírgula sozinha é sempre decimal.
 */
export function parseImportDecimal(raw: string | null | undefined): NormalizedResult<number> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  let value = text
    .replace(/r\$|us\$|m²|m2|ha\b|reais/gi, "")
    .replace(/\s+/g, "")
    .trim()

  if (!/^-?[0-9.,]+$/.test(value) || !/[0-9]/.test(value)) {
    return { ok: false }
  }

  const lastComma = value.lastIndexOf(",")
  const lastDot = value.lastIndexOf(".")

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : "."
    const thousandsSeparator = decimalSeparator === "," ? "." : ","
    value = value.split(thousandsSeparator).join("").replace(decimalSeparator, ".")
  } else if (lastComma >= 0) {
    if ((value.match(/,/g) ?? []).length > 1) {
      return { ok: false }
    }

    value = value.replace(",", ".")
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(value)) {
    value = value.split(".").join("")
  }

  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    return { ok: false }
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false }
}

/** Inteiro não negativo; aceita "3 quartos" e "2 (1 suíte)" pelo primeiro número. */
export function parseImportInteger(raw: string | null | undefined): NormalizedResult<number> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const match = text.match(/^\D*?(\d+)(?:[.,]0+)?(?!\d)/)

  if (!match?.[1]) {
    return { ok: false }
  }

  const parsed = Number(match[1])

  return Number.isSafeInteger(parsed) ? { ok: true, value: parsed } : { ok: false }
}

const TRUE_VALUES = new Set(["sim", "s", "yes", "y", "true", "verdadeiro", "1", "x", "ok"])
const FALSE_VALUES = new Set(["nao", "n", "no", "false", "falso", "0"])

export function parseImportBoolean(raw: string | null | undefined): NormalizedResult<boolean> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const label = normalizeLabel(text)

  if (TRUE_VALUES.has(label) || text === "✓") {
    return { ok: true, value: true }
  }

  if (FALSE_VALUES.has(label)) {
    return { ok: true, value: false }
  }

  return { ok: false }
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** Dia 0 das datas seriais do Excel (sistema 1900, com o bug do 29/02/1900). */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)

/**
 * Data em "DD/MM/AAAA", "DD/MM/AA", "DD-MM-AAAA", "AAAA-MM-DD" (também com hora
 * depois) ou número serial do Excel. Devolve "AAAA-MM-DD".
 */
export function parseImportDate(raw: string | null | undefined): NormalizedResult<string> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)

  if (iso) {
    const value = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return value ? { ok: true, value } : { ok: false }
  }

  const br = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/)

  if (br) {
    let year = Number(br[3])

    if ((br[3] ?? "").length === 2) {
      year += year > 30 ? 1900 : 2000
    }

    const value = isoDate(year, Number(br[2]), Number(br[1]))
    return value ? { ok: true, value } : { ok: false }
  }

  if (/^\d{4,5}([.,]\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text.replace(",", ".")))
    const date = new Date(EXCEL_EPOCH_UTC + serial * 86_400_000)
    const value = isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
    return value ? { ok: true, value } : { ok: false }
  }

  return { ok: false }
}

/** Lista numa célula: "piscina, churrasqueira; academia". */
export function splitImportList(raw: string | null | undefined): string[] {
  const text = cleanText(raw)

  if (!text) {
    return []
  }

  const seen = new Set<string>()
  const items: string[] = []

  for (const part of text.split(/\s*[,;|\n]\s*/)) {
    const item = cleanText(part)

    if (!item) {
      continue
    }

    const key = normalizeLabel(item)

    if (!seen.has(key)) {
      seen.add(key)
      items.push(item)
    }
  }

  return items
}
