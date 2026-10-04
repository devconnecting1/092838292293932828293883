// Saneamento e formatação para e-mails transacionais (HTML e texto puro).
// Módulo puro: não lê ambiente; a origem dos links vem sempre de quem chama.

const LINE_SEPARATOR = 0x2028
const PARAGRAPH_SEPARATOR = 0x2029

function isControlCharacter(code: number) {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

/** Marcas invisíveis de direção e de largura zero, usadas para disfarçar texto. */
function isInvisibleFormatting(code: number) {
  return (
    code === 0x200b ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  )
}

export type CleanTextOptions = {
  /** Mantém quebras de linha (parágrafos). Padrão: tudo numa linha só. */
  multiline?: boolean
  /** Corta em N caracteres (conta emojis como 1) e termina com reticências. */
  maxLength?: number
}

/**
 * Texto seguro para assunto, corpo em texto puro e (depois de escapado) HTML:
 * remove caracteres de controle e marcas invisíveis de direção, troca os
 * separadores U+2028/U+2029 por quebra de linha (ou espaço) e junta espaços.
 */
export function cleanText(value: unknown, options: CleanTextOptions = {}): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return ""
  }

  const multiline = options.multiline === true
  let result = ""

  for (const char of String(value).replace(/\r\n?/g, "\n")) {
    const code = char.codePointAt(0) ?? 0

    if (char === "\n" || code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR) {
      result += multiline ? "\n" : " "
    } else if (char === "\t") {
      result += " "
    } else if (!isControlCharacter(code) && !isInvisibleFormatting(code)) {
      result += char
    }
  }

  const normalized = multiline
    ? result
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : result.replace(/\s+/g, " ").trim()

  const max = options.maxLength

  if (max === undefined || max <= 0) {
    return normalized
  }

  const chars = Array.from(normalized)
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : normalized
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
}

/** Escapa texto para conteúdo e atributos HTML (inclui U+2028/U+2029 como entidade). */
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"'`\u2028\u2029]/g,
    (char) => HTML_ESCAPES[char] ?? `&#x${(char.codePointAt(0) ?? 0).toString(16)};`
  )
}

// Links ------------------------------------------------------------------------

function isLoopbackHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  )
}

/** https sempre; http só em localhost (desenvolvimento). Nunca com usuário/senha na URL. */
function isAllowedLinkUrl(url: URL) {
  if (url.username || url.password) {
    return false
  }

  return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname))
}

function hasUnsafeUrlCharacters(value: string) {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0

    if (
      isControlCharacter(code) ||
      isInvisibleFormatting(code) ||
      code === LINE_SEPARATOR ||
      code === PARAGRAPH_SEPARATOR ||
      char === "\\" ||
      /\s/.test(char)
    ) {
      return true
    }
  }

  return false
}

/** Origem aceita para os links do e-mail (https ou http em localhost); null se inválida. */
export function normalizeEmailOrigin(origin: unknown): string | null {
  if (typeof origin !== "string") {
    return null
  }

  try {
    const url = new URL(origin.trim())
    return isAllowedLinkUrl(url) ? url.origin : null
  } catch {
    return null
  }
}

const MAX_LINK_LENGTH = 2048

/**
 * Link seguro para o e-mail: caminho relativo à raiz ("/leads/...", resolvido
 * contra `origin` e preso a ela) ou URL absoluta https. Recusa `javascript:`,
 * `data:`, `//host`, barras invertidas, espaços e caracteres de controle.
 */
export function resolveEmailLink(href: unknown, origin: unknown): string | null {
  const base = normalizeEmailOrigin(origin)

  if (!base || typeof href !== "string") {
    return null
  }

  const raw = href.trim()

  if (!raw || raw.length > MAX_LINK_LENGTH || hasUnsafeUrlCharacters(raw)) {
    return null
  }

  if (raw.startsWith("/")) {
    if (raw.startsWith("//")) {
      return null
    }

    const url = new URL(raw, base)
    return url.origin === base ? url.href : null
  }

  try {
    const url = new URL(raw)
    return isAllowedLinkUrl(url) ? url.href : null
  } catch {
    return null
  }
}

// Cores ------------------------------------------------------------------------

export const DEFAULT_BRAND_COLOR = "#0C6B63"

/** "#RGB" ou "#RRGGBB" em maiúsculas (6 dígitos); qualquer outra coisa vira null. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())

  if (!match?.[1]) {
    return null
  }

  const hex =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((char) => char + char)
          .join("")
      : match[1]

  return `#${hex.toUpperCase()}`
}

function channelToLinear(channel: number) {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** Cor de texto (branco ou quase preto) com mais contraste sobre a cor informada. */
export function readableTextColor(hexColor: string): "#FFFFFF" | "#111111" {
  const hex = normalizeHexColor(hexColor) ?? DEFAULT_BRAND_COLOR
  const [r, g, b] = [1, 3, 5].map((index) =>
    channelToLinear(Number.parseInt(hex.slice(index, index + 2), 16))
  )
  const luminance = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  const contrastWithDark = (luminance + 0.05) / 0.0556

  return contrastWithWhite >= contrastWithDark ? "#FFFFFF" : "#111111"
}

// Dados pessoais ---------------------------------------------------------------

/** Telefone com DDD e só os 4 últimos dígitos: "(11) *****-4321". null se não parecer telefone. */
export function maskPhoneNumber(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null
  }

  const digits = String(value).replace(/\D/g, "")
  const national =
    (digits.length === 12 || digits.length === 13) && digits.startsWith("55")
      ? digits.slice(2)
      : digits

  if (national.length === 10 || national.length === 11) {
    return `(${national.slice(0, 2)}) ${"*".repeat(national.length - 6)}-${national.slice(-4)}`
  }

  if (national.length >= 8 && national.length <= 13) {
    return `${"*".repeat(national.length - 4)}${national.slice(-4)}`
  }

  return null
}

const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/

/** E-mail aparado e em minúsculas, ou null se inválido (sem espaços, "..", aspas ou quebras). */
export function normalizeEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const email = value.trim().toLowerCase()
  const local = email.slice(0, email.lastIndexOf("@"))

  if (
    email.length > 254 ||
    local.length > 64 ||
    email.includes("..") ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    !EMAIL_PATTERN.test(email)
  ) {
    return null
  }

  return email
}

/** Para logs: "ma***@gmail.com" (mesmo formato de get_invitation_preview). */
export function maskEmailAddress(value: unknown): string {
  const email = normalizeEmailAddress(value)

  if (!email) {
    return "***"
  }

  const at = email.lastIndexOf("@")
  return `${email.slice(0, Math.min(2, at))}***@${email.slice(at + 1)}`
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

// Datas ------------------------------------------------------------------------

export const EMAIL_TIME_ZONE = "America/Sao_Paulo"

function toDate(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null

  return date && !Number.isNaN(date.getTime()) ? date : null
}

/** "15 de setembro de 2026 às 14:30" no horário de Brasília; null se a data for inválida. */
export function formatEmailDateTime(value: unknown): string | null {
  const date = toDate(value)

  return date
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: EMAIL_TIME_ZONE,
      }).format(date)
    : null
}

/** "15 de setembro de 2026" no horário de Brasília; null se a data for inválida. */
export function formatEmailDate(value: unknown): string | null {
  const date = toDate(value)

  return date
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: EMAIL_TIME_ZONE }).format(
        date
      )
    : null
}
