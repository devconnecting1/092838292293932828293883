import {
  formatCnpj,
  formatCpf,
  formatPhoneBr,
  formatPostalCode,
  isValidPhoneBr,
  normalizeCnpj,
  normalizePhoneBr,
  onlyDigits,
} from "@workspace/core/br/documents"

import type { Enums } from "@workspace/database/types"

type ClientKind = Enums<"client_kind">

// -----------------------------------------------------------------------------
// Máscaras progressivas para inputs (a validação fica em @workspace/core)
// -----------------------------------------------------------------------------

export function maskCpfInput(value: string) {
  const digits = onlyDigits(value).slice(0, 11)
  let masked = digits.slice(0, 3)

  if (digits.length > 3) masked += `.${digits.slice(3, 6)}`
  if (digits.length > 6) masked += `.${digits.slice(6, 9)}`
  if (digits.length > 9) masked += `-${digits.slice(9, 11)}`

  return masked
}

/** CNPJ numérico ou alfanumérico (letras nas 12 primeiras posições). */
export function maskCnpjInput(value: string) {
  const cnpj = normalizeCnpj(value).slice(0, 14)
  let masked = cnpj.slice(0, 2)

  if (cnpj.length > 2) masked += `.${cnpj.slice(2, 5)}`
  if (cnpj.length > 5) masked += `.${cnpj.slice(5, 8)}`
  if (cnpj.length > 8) masked += `/${cnpj.slice(8, 12)}`
  if (cnpj.length > 12) masked += `-${cnpj.slice(12, 14)}`

  return masked
}

export function maskPhoneInput(value: string) {
  const digits = onlyDigits(value).slice(0, 11)

  if (digits.length === 0) return ""
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

export function maskPostalCodeInput(value: string) {
  const digits = onlyDigits(value).slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

const integerFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
})

/** Valor em reais inteiros com separador de milhar ("350.000"). */
export function maskMoneyInput(value: string) {
  const digits = onlyDigits(value)
    .replace(/^0+(?=\d)/, "")
    .slice(0, 12)
  return digits ? integerFormat.format(Number(digits)) : ""
}

/** "350.000" → 350000; "" → null. */
export function parseMoneyInput(value: string) {
  const digits = onlyDigits(value)
  return digits ? Number(digits) : null
}

// -----------------------------------------------------------------------------
// Exibição
// -----------------------------------------------------------------------------

/** Documento completo formatado (usar só na ficha, que registra o acesso). */
export function formatClientDocument(kind: ClientKind, document: string | null | undefined) {
  if (!document) return "—"

  try {
    return kind === "pf" ? formatCpf(document) : formatCnpj(document)
  } catch {
    return document
  }
}

/**
 * Documento mascarado para listas (LGPD): ***.456.789-** e **.345.678/0001-**.
 */
export function maskClientDocument(kind: ClientKind, document: string | null | undefined) {
  if (!document) return "—"

  if (kind === "pf" && document.length === 11) {
    return `***.${document.slice(3, 6)}.${document.slice(6, 9)}-**`
  }

  if (kind === "pj" && document.length === 14) {
    return `**.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-**`
  }

  return "***"
}

export function formatPhone(value: string | null | undefined) {
  if (!value) return "—"
  return isValidPhoneBr(value) ? formatPhoneBr(value) : value
}

export function formatPostalCodeSafe(value: string | null | undefined) {
  if (!value) return "—"

  try {
    return formatPostalCode(value)
  } catch {
    return value
  }
}

/** Só dígitos (normalizePhoneBr remove todo o resto): nada de parâmetros injetados. */
export function telHref(value: string) {
  return `tel:+55${normalizePhoneBr(value)}`
}

/** Só dígitos no caminho do wa.me. */
export function whatsappHref(value: string) {
  return `https://wa.me/55${normalizePhoneBr(value)}`
}

/**
 * mailto com o endereço codificado: um e-mail como "x@y.com?bcc=z@w.com" não
 * injeta cabeçalhos (bcc, subject, body) no cliente de e-mail.
 */
export function mailtoHref(email: string) {
  return `mailto:${encodeURIComponent(email.trim())}`
}
