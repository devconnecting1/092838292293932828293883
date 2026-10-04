import { z } from "zod"

/**
 * Utilitários e schemas zod para documentos e dados cadastrais brasileiros
 * (CPF, CNPJ, CEP e telefone) usados no CRM imobiliário. Módulo puro, sem
 * I/O — apenas string parsing/validação.
 */

const CPF_LENGTH = 11
const CNPJ_LENGTH = 14
const CNPJ_BASE_LENGTH = 12
const POSTAL_CODE_LENGTH = 8

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "")
}

function onlyAlnumUpper(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase()
}

/** Detecta sequências com um único caractere repetido (ex.: "00000000000"). */
function hasRepeatedChar(value: string): boolean {
  return /^(.)\1*$/.test(value)
}

// ---------------------------------------------------------------------------
// CPF
// ---------------------------------------------------------------------------

export function normalizeCpf(value: string): string {
  return onlyDigits(value)
}

function calcCpfCheckDigit(base: string): string {
  let factor = base.length + 1
  let sum = 0
  for (const char of base) {
    sum += Number(char) * factor
    factor -= 1
  }
  const rest = sum % 11
  return String(rest < 2 ? 0 : 11 - rest)
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value)
  if (cpf.length !== CPF_LENGTH) return false
  if (hasRepeatedChar(cpf)) return false

  const base = cpf.slice(0, 9)
  const dv1 = calcCpfCheckDigit(base)
  const dv2 = calcCpfCheckDigit(base + dv1)

  return cpf === base + dv1 + dv2
}

export function formatCpf(value: string): string {
  const cpf = normalizeCpf(value)
  if (cpf.length !== CPF_LENGTH) {
    throw new RangeError("CPF deve conter 11 dígitos para ser formatado.")
  }
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`
}

// ---------------------------------------------------------------------------
// CNPJ (numérico legado e alfanumérico a partir de julho de 2026)
// ---------------------------------------------------------------------------

// Pesos do módulo 11 do CNPJ (iguais para o formato numérico legado e para o
// alfanumérico).
const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

/**
 * A partir de julho/2026 a Receita Federal passa a emitir CNPJs
 * alfanuméricos: as 12 primeiras posições podem ser letras maiúsculas A-Z ou
 * dígitos, e os 2 dígitos verificadores continuam numéricos. O valor de cada
 * caractere para o cálculo do módulo 11 é o seu código ASCII menos 48
 * (dígitos '0'-'9' -> 0-9; letras 'A'-'Z' -> 17-42), aplicado com os mesmos
 * pesos do CNPJ numérico legado.
 *
 * Fonte (algoritmo + exemplo numérico verificado manualmente, base
 * "12ABC34501DE" -> dígitos "35"):
 * https://www.serasaexperian.com.br/conteudos/cnpj-alfanumerico/
 */
function charValue(char: string): number {
  return char.charCodeAt(0) - 48
}

function calcCnpjCheckDigit(base: string, weights: number[]): string {
  let sum = 0
  for (let i = 0; i < base.length; i += 1) {
    const char = base[i]
    const weight = weights[i]
    if (char === undefined || weight === undefined) continue
    sum += charValue(char) * weight
  }
  const rest = sum % 11
  return String(rest < 2 ? 0 : 11 - rest)
}

export function normalizeCnpj(value: string): string {
  return onlyAlnumUpper(value)
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value)
  if (cnpj.length !== CNPJ_LENGTH) return false
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false
  if (hasRepeatedChar(cnpj)) return false

  const base = cnpj.slice(0, CNPJ_BASE_LENGTH)
  const dv1 = calcCnpjCheckDigit(base, CNPJ_WEIGHTS_1)
  const dv2 = calcCnpjCheckDigit(base + dv1, CNPJ_WEIGHTS_2)

  return cnpj === base + dv1 + dv2
}

export function formatCnpj(value: string): string {
  const cnpj = normalizeCnpj(value)
  if (cnpj.length !== CNPJ_LENGTH) {
    throw new RangeError("CNPJ deve conter 14 caracteres para ser formatado.")
  }
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12, 14)}`
}

// ---------------------------------------------------------------------------
// Detecção CPF/CNPJ
// ---------------------------------------------------------------------------

export function detectDocumentKind(value: string): "pf" | "pj" | null {
  const raw = onlyAlnumUpper(value)
  if (/^[0-9]{11}$/.test(raw)) return "pf"
  if (/^[0-9A-Z]{14}$/.test(raw)) return "pj"
  return null
}

// ---------------------------------------------------------------------------
// CEP
// ---------------------------------------------------------------------------

export function normalizePostalCode(value: string): string {
  return onlyDigits(value)
}

export function isValidPostalCode(value: string): boolean {
  const cep = normalizePostalCode(value)
  return /^[0-9]{8}$/.test(cep)
}

export function formatPostalCode(value: string): string {
  const cep = normalizePostalCode(value)
  if (cep.length !== POSTAL_CODE_LENGTH) {
    throw new RangeError("CEP deve conter 8 dígitos para ser formatado.")
  }
  return `${cep.slice(0, 5)}-${cep.slice(5, 8)}`
}

// ---------------------------------------------------------------------------
// Telefone (fixo e celular)
// ---------------------------------------------------------------------------

/** DDDs brasileiros válidos (ANATEL). */
const VALID_DDD = new Set([
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "21",
  "22",
  "24",
  "27",
  "28",
  "31",
  "32",
  "33",
  "34",
  "35",
  "37",
  "38",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "53",
  "54",
  "55",
  "61",
  "62",
  "64",
  "63",
  "65",
  "66",
  "67",
  "68",
  "69",
  "71",
  "73",
  "74",
  "75",
  "77",
  "79",
  "81",
  "87",
  "82",
  "83",
  "84",
  "85",
  "88",
  "86",
  "89",
  "91",
  "93",
  "94",
  "92",
  "97",
  "95",
  "96",
  "98",
  "99",
])

export function normalizePhoneBr(value: string): string {
  let digits = onlyDigits(value)
  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2)
  }
  return digits
}

export function isValidPhoneBr(value: string): boolean {
  const phone = normalizePhoneBr(value)
  if (phone.length !== 10 && phone.length !== 11) return false

  const ddd = phone.slice(0, 2)
  if (!VALID_DDD.has(ddd)) return false

  const subscriber = phone.slice(2)
  if (phone.length === 11) {
    // Celular: 9 dígitos, iniciando obrigatoriamente com 9.
    return subscriber.startsWith("9")
  }
  // Fixo: 8 dígitos, iniciando entre 2 e 5.
  return /^[2-5]/.test(subscriber)
}

export function formatPhoneBr(value: string): string {
  const phone = normalizePhoneBr(value)
  if (!isValidPhoneBr(phone)) {
    throw new RangeError("Telefone brasileiro inválido para formatação.")
  }
  const ddd = phone.slice(0, 2)
  const subscriber = phone.slice(2)
  if (subscriber.length === 9) {
    return `(${ddd}) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`
  }
  return `(${ddd}) ${subscriber.slice(0, 4)}-${subscriber.slice(4)}`
}

// ---------------------------------------------------------------------------
// Schemas zod reutilizáveis (retornam o valor normalizado)
// ---------------------------------------------------------------------------

export const cpfSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeCpf(value)
  if (!isValidCpf(normalized)) {
    ctx.addIssue({ code: "custom", message: "CPF inválido." })
    return z.NEVER
  }
  return normalized
})

export const cnpjSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeCnpj(value)
  if (!isValidCnpj(normalized)) {
    ctx.addIssue({ code: "custom", message: "CNPJ inválido." })
    return z.NEVER
  }
  return normalized
})

export const cpfOrCnpjSchema = z.string().transform((value, ctx) => {
  const kind = detectDocumentKind(value)

  if (kind === "pf") {
    const normalized = normalizeCpf(value)
    if (isValidCpf(normalized)) return normalized
  } else if (kind === "pj") {
    const normalized = normalizeCnpj(value)
    if (isValidCnpj(normalized)) return normalized
  }

  ctx.addIssue({ code: "custom", message: "Informe um CPF ou CNPJ válido." })
  return z.NEVER
})

export const postalCodeSchema = z.string().transform((value, ctx) => {
  const normalized = normalizePostalCode(value)
  if (!isValidPostalCode(normalized)) {
    ctx.addIssue({
      code: "custom",
      message: "CEP inválido. Use o formato 00000-000.",
    })
    return z.NEVER
  }
  return normalized
})

export const phoneBrSchema = z.string().transform((value, ctx) => {
  const normalized = normalizePhoneBr(value)
  if (!isValidPhoneBr(normalized)) {
    ctx.addIssue({
      code: "custom",
      message: "Telefone inválido. Informe o DDD e o número.",
    })
    return z.NEVER
  }
  return normalized
})
