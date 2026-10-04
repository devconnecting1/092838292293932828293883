/**
 * Leitura de CSV para a importação de planilhas. Módulo puro (sem I/O): recebe
 * os bytes do arquivo e devolve as linhas como texto.
 *
 * - **Encoding**: tenta UTF-8 estrito (com ou sem BOM). Se algum byte não for
 *   UTF-8 válido, o arquivo veio do Excel do Windows em pt-BR, que salva
 *   "CSV (separado por vírgulas)" em Windows-1252; então decodifica assim.
 * - **Separador**: `;` (Excel em pt-BR) ou `,` (Google Planilhas, sistemas em
 *   inglês). Vence o que aparece mais vezes fora de aspas nas primeiras linhas.
 * - **Formato**: RFC 4180 — campo entre aspas pode ter separador, aspas dobradas
 *   (`""`) e quebra de linha; aceita CRLF, LF e CR.
 */

export type CsvEncoding = "utf-8" | "windows-1252"
export type CsvDelimiter = ";" | ","

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2]
}

/** Decodifica os bytes do CSV detectando UTF-8 (com ou sem BOM) ou Windows-1252. */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  const body = hasUtf8Bom(bytes) ? bytes.subarray(3) : bytes

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body)
    return { text, encoding: "utf-8" }
  } catch {
    return { text: new TextDecoder("windows-1252").decode(body), encoding: "windows-1252" }
  }
}

/** Conta `;` e `,` fora de aspas nas primeiras linhas e escolhe o mais frequente. */
export function detectCsvDelimiter(text: string, sampleLines = 5): CsvDelimiter {
  let semicolons = 0
  let commas = 0
  let lines = 0
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (!inQuotes) {
      if (char === ";") {
        semicolons += 1
      } else if (char === ",") {
        commas += 1
      } else if (char === "\n") {
        lines += 1

        if (lines >= sampleLines) {
          break
        }
      }
    }
  }

  return commas > semicolons ? "," : ";"
}

/**
 * Quebra o texto em registros e campos. Linhas totalmente vazias são mantidas
 * como `[""]` para preservar a numeração; quem chama decide ignorá-las.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ""
  let inQuotes = false
  let index = 0

  const pushField = () => {
    record.push(field)
    field = ""
  }

  const pushRecord = () => {
    pushField()
    records.push(record)
    record = []
  }

  while (index < text.length) {
    const char = text[index] as string

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }

        inQuotes = false
        index += 1
        continue
      }

      field += char
      index += 1
      continue
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true
      index += 1
      continue
    }

    if (char === delimiter) {
      pushField()
      index += 1
      continue
    }

    if (char === "\r" || char === "\n") {
      pushRecord()
      index += char === "\r" && text[index + 1] === "\n" ? 2 : 1
      continue
    }

    field += char
    index += 1
  }

  // Último registro sem quebra de linha no fim do arquivo.
  if (field.length > 0 || record.length > 0) {
    pushRecord()
  }

  return records
}

/** Atalho: bytes do arquivo → registros, com o encoding e o separador detectados. */
export function readCsvBytes(bytes: Uint8Array): {
  records: string[][]
  encoding: CsvEncoding
  delimiter: CsvDelimiter
} {
  const { text, encoding } = decodeCsvBytes(bytes)
  const delimiter = detectCsvDelimiter(text)

  return { records: parseCsv(text, delimiter), encoding, delimiter }
}
