// Rascunho local de formulário: chave, limpeza de dados sensíveis, validade e
// mescla com os valores atuais. Módulo puro (sem window, sem storage): a cola
// com o localStorage e o React fica no app.
//
// O rascunho mora só no navegador de quem digitou, por usuário + imobiliária +
// formulário + registro, e vence em 7 dias. CPF, RG, documentos e senhas nunca
// entram: saem pelo nome do campo e, em texto livre, CPF completo é omitido.

import { isValidCpf } from "../br/documents"

/** Prefixo das chaves no storage (a versão faz parte do envelope, não da chave). */
export const FORM_DRAFT_KEY_PREFIX = "crm:rascunho:"

export const FORM_DRAFT_VERSION = 1

export const FORM_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Tolerância para relógio adiantado: acima disso o rascunho é descartado. */
export const FORM_DRAFT_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

/** Limite do JSON gravado (caracteres): protege a cota do localStorage. */
export const FORM_DRAFT_MAX_CHARS = 200_000

/** Registro ainda não salvo (cadastro novo). */
export const FORM_DRAFT_NEW_RECORD = "novo"

/** Texto que substitui um CPF completo digitado em campo livre. */
export const FORM_DRAFT_CPF_PLACEHOLDER = "[CPF omitido]"

const MAX_DEPTH = 6

const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

/** Trechos que marcam o campo como sensível em qualquer parte do nome. */
const SENSITIVE_KEY_FRAGMENTS = [
  "password",
  "passwd",
  "senha",
  "secret",
  "segredo",
  "token",
  "cpf",
  "cnpj",
  "document",
  "passport",
  "passaporte",
  "cvv",
  "cvc",
  "cardnumber",
  "numerocartao",
] as const

/** Siglas curtas: só contam como palavra inteira do nome (evita "organization" → "rg"). */
const SENSITIVE_KEY_WORDS = new Set(["rg", "doc", "docs", "cnh", "pis", "nis", "otp", "pin", "ssn"])

const WHOLE_CPF_PATTERN = /^(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})$/

const EMBEDDED_CPF_PATTERN = /(?<![\dA-Za-z])(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?![\dA-Za-z])/g

export type DraftJsonValue =
  string | number | boolean | null | DraftJsonValue[] | { [key: string]: DraftJsonValue }

export type DraftJsonObject = { [key: string]: DraftJsonValue }

export type FormDraftScope = {
  userId: string
  organizationId: string
}

export type FormDraftTarget = FormDraftScope & {
  /** Identificador estável do formulário (ex.: "imovel", "cliente"). */
  formId: string
  /** Id do registro em edição; vazio para cadastro novo. */
  recordId?: string | null
}

export type FormDraft = {
  savedAt: Date
  values: DraftJsonObject
}

export type FormDraftOptions = {
  /** Campos a mais para nunca guardar (nome do campo ou caminho "a.b"). */
  exclude?: readonly string[]
}

type FormDraftEnvelope = {
  v: typeof FORM_DRAFT_VERSION
  savedAt: string
  values: DraftJsonObject
}

// ---------------------------------------------------------------------------
// Chave
// ---------------------------------------------------------------------------

/**
 * Chave do rascunho no storage. Devolve null se algum pedaço for inválido:
 * sem chave, sem rascunho (nunca mistura usuários ou imobiliárias).
 */
export function buildFormDraftKey(target: FormDraftTarget): string | null {
  const recordId = target.recordId || FORM_DRAFT_NEW_RECORD
  const segments = [target.userId, target.organizationId, target.formId, recordId]

  if (
    !segments.every((segment) => typeof segment === "string" && KEY_SEGMENT_PATTERN.test(segment))
  ) {
    return null
  }

  return `${FORM_DRAFT_KEY_PREFIX}${segments.join(":")}`
}

export function isFormDraftKey(key: string): boolean {
  return key.startsWith(FORM_DRAFT_KEY_PREFIX)
}

// ---------------------------------------------------------------------------
// Dados sensíveis
// ---------------------------------------------------------------------------

function splitKeyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Campo que nunca vai para o rascunho (CPF, RG, documentos, senhas, tokens). */
export function isSensitiveDraftField(key: string): boolean {
  const words = splitKeyWords(key)

  if (words.some((word) => SENSITIVE_KEY_WORDS.has(word))) {
    return true
  }

  const joined = words.join("")
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => joined.includes(fragment))
}

function isWholeCpf(value: string): boolean {
  const trimmed = value.trim()
  return WHOLE_CPF_PATTERN.test(trimmed) && isValidCpf(trimmed)
}

/** Troca CPFs completos (com dígitos verificadores válidos) dentro de um texto. */
export function maskFullCpfs(text: string): string {
  return text.replace(EMBEDDED_CPF_PATTERN, (match) =>
    isValidCpf(match) ? FORM_DRAFT_CPF_PLACEHOLDER : match
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sanitizeValue(
  value: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
  exclude: ReadonlySet<string>
): DraftJsonValue | undefined {
  if (value === null) return null

  switch (typeof value) {
    case "string":
      // Campo inteiro com um CPF completo: sai; CPF no meio de um texto: omitido.
      return isWholeCpf(value) ? undefined : maskFullCpfs(value)
    case "boolean":
      return value
    case "number":
      return Number.isFinite(value) ? value : undefined
    case "object":
      break
    default:
      return undefined
  }

  if (depth >= MAX_DEPTH || seen.has(value)) {
    return undefined
  }

  if (Array.isArray(value)) {
    seen.add(value)
    const items: DraftJsonValue[] = []

    for (const item of value) {
      const sanitized = sanitizeValue(item, path, depth + 1, seen, exclude)
      if (sanitized !== undefined) items.push(sanitized)
    }

    seen.delete(value)
    return items
  }

  // Date, File, Blob, Map e afins não são dados de formulário serializáveis.
  if (!isPlainObject(value)) {
    return undefined
  }

  seen.add(value)
  const result: DraftJsonObject = {}

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key

    if (
      FORBIDDEN_KEYS.has(key) ||
      exclude.has(key) ||
      exclude.has(childPath) ||
      isSensitiveDraftField(key)
    ) {
      continue
    }

    const sanitized = sanitizeValue(child, childPath, depth + 1, seen, exclude)
    if (sanitized !== undefined) result[key] = sanitized
  }

  seen.delete(value)
  return result
}

/** Cópia JSON dos valores, sem campos sensíveis nem valores não serializáveis. */
export function sanitizeDraftValues(
  values: unknown,
  options: FormDraftOptions = {}
): DraftJsonObject {
  if (!isPlainObject(values)) {
    return {}
  }

  const sanitized = sanitizeValue(values, "", 0, new WeakSet(), new Set(options.exclude ?? []))
  return isPlainObject(sanitized) ? (sanitized as DraftJsonObject) : {}
}

// ---------------------------------------------------------------------------
// Serialização e validade
// ---------------------------------------------------------------------------

/**
 * JSON a gravar. Null quando não há nada a guardar (tudo sensível ou vazio) ou
 * quando passa do limite de tamanho.
 */
export function serializeFormDraft(
  values: unknown,
  now: Date,
  options: FormDraftOptions = {}
): string | null {
  const sanitized = sanitizeDraftValues(values, options)

  if (Object.keys(sanitized).length === 0 || Number.isNaN(now.getTime())) {
    return null
  }

  const envelope: FormDraftEnvelope = {
    v: FORM_DRAFT_VERSION,
    savedAt: now.toISOString(),
    values: sanitized,
  }
  const json = JSON.stringify(envelope)

  return json.length > FORM_DRAFT_MAX_CHARS ? null : json
}

export function isFormDraftExpired(
  savedAt: Date,
  now: Date,
  maxAgeMs: number = FORM_DRAFT_MAX_AGE_MS
): boolean {
  const age = now.getTime() - savedAt.getTime()
  return Number.isNaN(age) || age > maxAgeMs || age < -FORM_DRAFT_FUTURE_TOLERANCE_MS
}

/**
 * Lê o JSON gravado. Null para ausente, corrompido, de outra versão ou vencido.
 * Os valores passam de novo pela limpeza (rascunho antigo não devolve dado sensível).
 */
export function parseFormDraft(
  raw: string | null | undefined,
  now: Date,
  options: FormDraftOptions & { maxAgeMs?: number } = {}
): FormDraft | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > FORM_DRAFT_MAX_CHARS) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isPlainObject(parsed) || parsed.v !== FORM_DRAFT_VERSION) {
    return null
  }

  if (typeof parsed.savedAt !== "string" || !isPlainObject(parsed.values)) {
    return null
  }

  const savedAt = new Date(parsed.savedAt)

  if (Number.isNaN(savedAt.getTime()) || isFormDraftExpired(savedAt, now, options.maxAgeMs)) {
    return null
  }

  const values = sanitizeDraftValues(parsed.values, options)

  return Object.keys(values).length > 0 ? { savedAt, values } : null
}

/** Chaves de rascunho a apagar: vencidas, corrompidas ou de versão antiga. */
export function listStaleFormDraftKeys(
  entries: Iterable<readonly [key: string, raw: string | null]>,
  now: Date
): string[] {
  const stale: string[] = []

  for (const [key, raw] of entries) {
    if (isFormDraftKey(key) && parseFormDraft(raw, now) === null) {
      stale.push(key)
    }
  }

  return stale
}

// ---------------------------------------------------------------------------
// Comparação e mescla
// ---------------------------------------------------------------------------

function stableStringify(value: DraftJsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }

  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] as DraftJsonValue)}`).join(",")}}`
  }

  return JSON.stringify(value)
}

/**
 * O que seria guardado difere dos valores iniciais? Mudança só em campo
 * sensível não conta: não há nada a recuperar.
 */
export function hasDraftableChanges(
  values: unknown,
  baseValues: unknown,
  options: FormDraftOptions = {}
): boolean {
  return (
    stableStringify(sanitizeDraftValues(values, options)) !==
    stableStringify(sanitizeDraftValues(baseValues, options))
  )
}

type MergeResult = { ok: true; value: unknown } | { ok: false }

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

function mergeValue(
  base: unknown,
  draft: unknown,
  path: string,
  exclude: ReadonlySet<string>
): MergeResult {
  if (base === null) {
    // Campo anulável (ex.: opção escolhida num combobox): aceita o que foi guardado.
    return draft === undefined ? { ok: false } : { ok: true, value: draft }
  }

  if (isPrimitive(base)) {
    return typeof draft === typeof base ? { ok: true, value: draft } : { ok: false }
  }

  if (Array.isArray(base)) {
    if (!Array.isArray(draft) || !draft.every(isPrimitive)) {
      return { ok: false }
    }

    const kinds = new Set([...base, ...draft].map((item) => typeof item))
    return kinds.size <= 1 ? { ok: true, value: [...draft] } : { ok: false }
  }

  if (isPlainObject(base)) {
    if (!isPlainObject(draft)) {
      return { ok: false }
    }

    return { ok: true, value: mergeObject(base, draft, path, exclude) }
  }

  return { ok: false }
}

function mergeObject(
  base: Record<string, unknown>,
  draft: Record<string, unknown>,
  path: string,
  exclude: ReadonlySet<string>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }

  for (const key of Object.keys(base)) {
    const childPath = path ? `${path}.${key}` : key

    if (
      FORBIDDEN_KEYS.has(key) ||
      exclude.has(key) ||
      exclude.has(childPath) ||
      isSensitiveDraftField(key) ||
      !Object.prototype.hasOwnProperty.call(draft, key)
    ) {
      continue
    }

    const merged = mergeValue(base[key], draft[key], childPath, exclude)
    if (merged.ok) result[key] = merged.value
  }

  return result
}

/**
 * Valores para recuperar: parte dos atuais e aplica só os campos do rascunho
 * que ainda existem no formulário e têm o mesmo tipo. Campo sensível fica como
 * está (o rascunho nunca o traz).
 */
export function mergeFormDraftValues<T extends Record<string, unknown>>(
  base: T,
  draftValues: DraftJsonObject,
  options: FormDraftOptions = {}
): T {
  return mergeObject(base, draftValues, "", new Set(options.exclude ?? [])) as T
}

// ---------------------------------------------------------------------------
// Texto do aviso
// ---------------------------------------------------------------------------

/** "16/09 às 14:05" no fuso do CRM. */
export function formatFormDraftSavedAt(date: Date, timeZone = "America/Sao_Paulo"): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date)

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "00"

  return `${part("day")}/${part("month")} às ${part("hour")}:${part("minute")}`
}
