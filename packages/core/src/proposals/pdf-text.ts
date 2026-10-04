// Preparo do texto dos PDFs (proposta e ficha do imóvel). Módulo puro: sem
// fontes, sem I/O — quem desenha injeta o que a fonte cobre e a medição do texto.
//
// Os PDFs embutem a Geist (Unicode): acentos, "R$", "º", "ª" e o travessão saem
// como foram digitados. A limpeza continua necessária por dois motivos:
// caractere de controle ou de formatação invisível não tem glifo, e o que a
// fonte não desenha (emoji, alguns símbolos) viraria um quadrado vazio. Se a
// Geist não carregar, o PDF sai com a Helvetica padrão, que só codifica WinAnsi
// e lança erro fora dela: a mesma limpeza, com o conjunto de caracteres dessa
// fonte, garante que a geração nunca quebra.

/** Diz se a fonte desenha o code point (pdf-lib: `font.getCharacterSet()`). */
export type SupportsCodePoint = (codePoint: number) => boolean

/** Monta a verificação a partir dos conjuntos de caracteres das fontes usadas juntas. */
export function supportedByAll(
  ...characterSets: ReadonlyArray<readonly number[]>
): SupportsCodePoint {
  const sets = characterSets.map((characterSet) => new Set(characterSet))
  return (codePoint) => sets.every((set) => set.has(codePoint))
}

/**
 * Trocas legíveis para símbolos que aparecem em condições e observações. Só
 * valem quando a fonte não desenha o original: a Geist não tem ⇒, ✓, ✔ e ▪; a
 * Helvetica (reserva) também não tem setas, comparações nem o sinal de menos.
 */
const FALLBACKS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "≈": "~",
  "⁄": "/",
  "\u2212": "-", // sinal de menos
  "✓": "-",
  "✔": "-",
  "●": "-",
  "▪": "-",
}

/** Quebras de linha de qualquer origem (Windows, Mac antigo, separadores Unicode). */
const LINE_BREAKS = /\r\n?|[\u0085\u2028\u2029]/g

/** Controle (C0/C1) e formatação invisível: hífen condicional, largura zero, marcas bidi, BOM. */
const INVISIBLE = /^[\p{Cc}\p{Cf}]$/u

/** Espaços tipográficos (fino, estreito, de algarismo...). */
const SPACE = /^\p{Zs}$/u

const MARKS = /\p{M}/gu

function supportsAll(text: string, supports: SupportsCodePoint) {
  for (const character of text) {
    if (!supports(character.codePointAt(0) ?? -1)) {
      return false
    }
  }

  return true
}

/** Equivalente para o caractere que a fonte não desenha, ou "" quando não há. */
function replacementFor(character: string, supports: SupportsCodePoint) {
  if (SPACE.test(character)) {
    return supports(0x20) ? " " : ""
  }

  const fallback = FALLBACKS[character]

  if (fallback && supportsAll(fallback, supports)) {
    return fallback
  }

  // Letra com acento que a fonte não tem: fica a letra base.
  const base = character.normalize("NFD").replace(MARKS, "")

  if (base && base !== character && supportsAll(base, supports)) {
    return base
  }

  return ""
}

/**
 * Texto pronto para desenhar com a fonte do PDF: normaliza acentos compostos
 * (NFC), padroniza as quebras de linha, troca tabulação por espaço, remove
 * caractere invisível e troca o que a fonte não desenha por um equivalente.
 * Caractere sem equivalente é descartado — nunca derruba a geração do PDF.
 */
export function toPdfText(value: string | null | undefined, supports: SupportsCodePoint): string {
  if (!value) {
    return ""
  }

  const normalized = value.normalize("NFC").replace(LINE_BREAKS, "\n")
  let result = ""

  for (const character of normalized) {
    if (character === "\n") {
      result += character
      continue
    }

    if (character === "\t") {
      result += " "
      continue
    }

    if (INVISIBLE.test(character)) {
      continue
    }

    result += supports(character.codePointAt(0) ?? -1)
      ? character
      : replacementFor(character, supports)
  }

  return result
}

/** Largura do texto no tamanho escolhido (pdf-lib: font.widthOfTextAtSize). */
export type MeasureText = (text: string) => number

function breakLongWord(word: string, maxWidth: number, measure: MeasureText): string[] {
  const parts: string[] = []
  let current = ""

  for (const character of word) {
    const candidate = current + character

    if (current && measure(candidate) > maxWidth) {
      parts.push(current)
      current = character
      continue
    }

    current = candidate
  }

  if (current) {
    parts.push(current)
  }

  return parts
}

/**
 * Quebra o texto em linhas que cabem em `maxWidth`, respeitando as quebras que
 * a pessoa digitou. Palavra maior que a linha (URL, código) é partida.
 */
export function wrapText(text: string, maxWidth: number, measure: MeasureText): string[] {
  if (maxWidth <= 0) {
    return []
  }

  const lines: string[] = []

  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean)

    if (words.length === 0) {
      lines.push("")
      continue
    }

    let current = ""

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word

      if (measure(candidate) <= maxWidth) {
        current = candidate
        continue
      }

      if (current) {
        lines.push(current)
      }

      if (measure(word) <= maxWidth) {
        current = word
        continue
      }

      const parts = breakLongWord(word, maxWidth, measure)
      lines.push(...parts.slice(0, -1))
      current = parts.at(-1) ?? ""
    }

    if (current) {
      lines.push(current)
    }
  }

  return lines
}
