// Separadores de linha/parágrafo Unicode montados por código (não como literal
// no fonte, onde são terminadores de linha em JavaScript).
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/**
 * Serializa dados estruturados para `<script type="application/ld+json">`.
 * Escapa `<`, `>`, `&` e os separadores U+2028/U+2029 para que nenhum texto
 * vindo do banco feche a tag ou quebre o script.
 */
export function serializeJsonLd(value: unknown): string | null {
  if (value === null || value === undefined) return null

  const json = JSON.stringify(value)

  if (!json) return null

  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(LINE_SEPARATOR, "\\u2028")
    .replaceAll(PARAGRAPH_SEPARATOR, "\\u2029")
}
