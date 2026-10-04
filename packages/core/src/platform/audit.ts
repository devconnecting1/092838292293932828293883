/**
 * Console da Plataforma — preparação de uma linha do registro do console.
 *
 * Toda ação do console que altera algo grava quem fez, o quê, em quem, por quê
 * e o antes/depois. Aqui fica a regra pura: validação do formato (o banco
 * repete as mesmas restrições) e limpeza do antes/depois para não levar dado
 * pessoal de cliente final (LGPD: dado mínimo).
 *
 * Limpeza do antes/depois:
 * - campo cujo nome indica dado pessoal ou segredo (e-mail, telefone, CPF,
 *   endereço, nome de cliente/contato, token, senha...) vira "[removido]";
 * - dentro de textos, e-mail vira "[e-mail]" e sequência de 10 ou mais dígitos
 *   (telefone, CPF, CNPJ) vira "[número]";
 * - números, booleanos e null ficam como estão; profundidade, listas e textos
 *   longos são cortados.
 * O banco recusa (22023) o que ainda tiver e-mail, CPF ou telefone formatado.
 */

export const PLATFORM_AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$/

export const PLATFORM_AUDIT_TARGET_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

/** Mesmo teto do banco (octet_length do JSON), com folga para a normalização. */
export const PLATFORM_AUDIT_MAX_DATA_BYTES = 16_000

const MAX_DEPTH = 6
const MAX_ARRAY_ITEMS = 50
const MAX_STRING_LENGTH = 500
const MAX_KEYS = 100

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PlatformAuditJson =
  string | number | boolean | null | PlatformAuditJson[] | { [key: string]: PlatformAuditJson }

export type PlatformAuditJsonObject = { [key: string]: PlatformAuditJson }

export type PlatformAuditInput = {
  /** snake_case com até 4 partes separadas por ponto (ex.: organizacao.bloquear). */
  action: string
  target?: { type: string; id?: string | null } | null
  organizationId?: string | null
  /** Motivo escrito por quem agiu (3 a 1.000 caracteres). */
  reason?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

export type PlatformAuditPayload = {
  action: string
  targetType: string | null
  targetId: string | null
  organizationId: string | null
  reason: string | null
  before: PlatformAuditJsonObject | null
  after: PlatformAuditJsonObject | null
}

export type PlatformAuditRejection =
  | "acao_invalida"
  | "alvo_invalido"
  | "imobiliaria_invalida"
  | "motivo_invalido"
  | "dados_grandes_demais"

export const PLATFORM_AUDIT_REJECTION_MESSAGES: Record<PlatformAuditRejection, string> = {
  acao_invalida: "Ação do registro em formato inválido.",
  alvo_invalido: "Alvo do registro em formato inválido.",
  imobiliaria_invalida: "Imobiliária do registro inválida.",
  motivo_invalido: "O motivo precisa ter de 3 a 1.000 caracteres.",
  dados_grandes_demais: "O antes/depois do registro passa de 16 KB.",
}

/** Palavras de nome de campo que indicam dado pessoal ou segredo. */
const SENSITIVE_WORDS = new Set([
  "email",
  "mail",
  "phone",
  "telefone",
  "fone",
  "celular",
  "whatsapp",
  "cpf",
  "rg",
  "documento",
  "document",
  "nascimento",
  "birth",
  "birthday",
  "endereco",
  "address",
  "logradouro",
  "cep",
  "ip",
  "senha",
  "password",
  "secret",
  "segredo",
  "token",
])

/** Palavras que, junto de nome/name, indicam nome de pessoa atendida. */
const PERSON_WORDS = new Set([
  "cliente",
  "client",
  "customer",
  "contato",
  "contact",
  "lead",
  "proponente",
  "proprietario",
  "owner",
  "inquilino",
  "comprador",
  "buyer",
])

function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "")
}

/** Palavras do nome do campo: snake_case, kebab-case e camelCase. */
function keyWords(key: string): string[] {
  return removeAccents(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function isSensitiveAuditKey(key: string): boolean {
  const words = keyWords(key)

  if (words.some((word) => SENSITIVE_WORDS.has(word))) {
    return true
  }

  const hasName = words.includes("nome") || words.includes("name")
  return hasName && words.some((word) => PERSON_WORDS.has(word))
}

const EMAIL_IN_TEXT = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+/g

/** Candidato a número de documento/telefone: dígitos com separadores comuns. */
const NUMBER_IN_TEXT = /\+?\(?\d[\d\s()./-]{8,}\d/g

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

function maskSegment(value: string): string {
  return value.replace(EMAIL_IN_TEXT, "[e-mail]").replace(NUMBER_IN_TEXT, (match) => {
    const digits = match.replace(/\D/g, "").length

    // Datas ISO (2026-09-17...) passam: não são documento nem telefone.
    return digits < 10 || /^\d{4}-\d{2}-\d{2}/.test(match) ? match : "[número]"
  })
}

/** Tira e-mail e sequência longa de dígitos de um texto; uuids ficam intactos. */
export function maskPersonalText(value: string): string {
  let result = ""
  let last = 0

  for (const match of value.matchAll(UUID_IN_TEXT)) {
    result += maskSegment(value.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }

  return result + maskSegment(value.slice(last))
}

function sanitizeValue(value: unknown, depth: number): PlatformAuditJson | undefined {
  if (value === null) {
    return null
  }

  switch (typeof value) {
    case "boolean":
      return value
    case "number":
      return Number.isFinite(value) ? value : null
    case "bigint":
      return value.toString()
    case "string": {
      const masked = maskPersonalText(value)
      return masked.length > MAX_STRING_LENGTH ? `${masked.slice(0, MAX_STRING_LENGTH)}…` : masked
    }
    case "object":
      break
    default:
      return undefined
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }

  if (depth >= MAX_DEPTH) {
    return "[omitido]"
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => sanitizeValue(entry, depth + 1))
      .filter((entry): entry is PlatformAuditJson => entry !== undefined)
  }

  return sanitizeObject(value as Record<string, unknown>, depth + 1)
}

function sanitizeObject(value: Record<string, unknown>, depth: number): PlatformAuditJsonObject {
  const result: PlatformAuditJsonObject = {}

  for (const [key, entry] of Object.entries(value).slice(0, MAX_KEYS)) {
    if (isSensitiveAuditKey(key)) {
      result[key] = "[removido]"
      continue
    }

    const sanitized = sanitizeValue(entry, depth)

    if (sanitized !== undefined) {
      result[key] = sanitized
    }
  }

  return result
}

/** Antes/depois limpo; null quando não há dado. */
export function sanitizePlatformAuditData(
  value: Record<string, unknown> | null | undefined
): PlatformAuditJsonObject | null {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return sanitizeObject(value, 0)
}

function byteLength(value: PlatformAuditJsonObject | null): number {
  return value ? new TextEncoder().encode(JSON.stringify(value)).length : 0
}

/** Valida e limpa a entrada; o banco confere de novo. */
export function preparePlatformAuditEvent(
  input: PlatformAuditInput
): { ok: true; payload: PlatformAuditPayload } | { ok: false; reason: PlatformAuditRejection } {
  const action = input.action.trim()

  if (action.length > 80 || !PLATFORM_AUDIT_ACTION_PATTERN.test(action)) {
    return { ok: false, reason: "acao_invalida" }
  }

  const targetType = input.target?.type.trim() || null
  const targetId = input.target?.id?.trim() || null

  if (
    (targetType !== null && !PLATFORM_AUDIT_TARGET_TYPE_PATTERN.test(targetType)) ||
    (targetId !== null && (targetType === null || targetId.length > 200))
  ) {
    return { ok: false, reason: "alvo_invalido" }
  }

  const organizationId = input.organizationId?.trim() || null

  if (organizationId !== null && !UUID_PATTERN.test(organizationId)) {
    return { ok: false, reason: "imobiliaria_invalida" }
  }

  const reason = input.reason?.trim() || null

  if (reason !== null && (reason.length < 3 || reason.length > 1000)) {
    return { ok: false, reason: "motivo_invalido" }
  }

  const before = sanitizePlatformAuditData(input.before)
  const after = sanitizePlatformAuditData(input.after)

  if (
    byteLength(before) > PLATFORM_AUDIT_MAX_DATA_BYTES ||
    byteLength(after) > PLATFORM_AUDIT_MAX_DATA_BYTES
  ) {
    return { ok: false, reason: "dados_grandes_demais" }
  }

  return {
    ok: true,
    payload: {
      action,
      targetType,
      targetId: targetId ? maskPersonalText(targetId) : null,
      organizationId: organizationId?.toLowerCase() ?? null,
      reason: reason ? maskPersonalText(reason) : null,
      before,
      after,
    },
  }
}
