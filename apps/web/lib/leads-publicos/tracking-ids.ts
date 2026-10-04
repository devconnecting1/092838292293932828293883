// IDs de rastreamento configurados na landing page. Só IDs que passam por estas
// regex são interpolados nos scripts do Meta Pixel e do Google (nada de texto
// livre em script). O contêiner do GTM não é carregado: ver LandingTracking.

export const META_PIXEL_ID_PATTERN = /^\d{1,20}$/
export const GOOGLE_TAG_ID_PATTERN = /^(G|GT|AW)-[A-Z0-9]{1,30}$/

// U+2028 e U+2029 montados por código: literais desses caracteres no fonte
// quebram a regex/strings para o TypeScript (são tratados como fim de linha).
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/** Escape \uXXXX de um caractere, sem escrever a sequência literal no fonte. */
function unicodeEscape(char: string) {
  const hex = char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")
  return `${String.fromCharCode(92)}u${hex}`
}

const UNSAFE_SCRIPT_CHARS: Record<string, string> = {
  "<": unicodeEscape("<"),
  ">": unicodeEscape(">"),
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\0": "\\0",
  [LINE_SEPARATOR]: unicodeEscape(LINE_SEPARATOR),
  [PARAGRAPH_SEPARATOR]: unicodeEscape(PARAGRAPH_SEPARATOR),
}

const UNSAFE_LINE_SEPARATORS = new RegExp(`[${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, "g")

function escapeUnsafeChar(char: string) {
  return UNSAFE_SCRIPT_CHARS[char] ?? ""
}

/**
 * Literal de string JavaScript para script inline: JSON.stringify (aspas e
 * barras escapadas) + escape de `<`, `>`, controles e separadores de linha,
 * para o valor não fechar a tag <script> nem quebrar o código.
 */
export function toInlineScriptString(value: string): string {
  return JSON.stringify(value)
    .replace(/[<>\b\f\n\r\t\0]/g, escapeUnsafeChar)
    .replace(UNSAFE_LINE_SEPARATORS, escapeUnsafeChar)
}

function matchId(value: unknown, pattern: RegExp) {
  if (typeof value !== "string") return null

  const id = value.trim()
  return pattern.test(id) ? id : null
}

export function safeMetaPixelId(value: unknown): string | null {
  return matchId(value, META_PIXEL_ID_PATTERN)
}

export function safeGoogleTagId(value: unknown): string | null {
  return matchId(value, GOOGLE_TAG_ID_PATTERN)
}
