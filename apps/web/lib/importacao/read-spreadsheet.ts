import { readCsvBytes, type CsvDelimiter, type CsvEncoding } from "@workspace/core/import/csv"
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@workspace/core/import/report"
import type { ImportSourceRow } from "@workspace/core/import/validate"

/**
 * Leitura da planilha no navegador: o arquivo não sobe para o servidor, só as
 * linhas normalizadas seguem, em lotes, para a gravação.
 */

export type SpreadsheetData = {
  fileName: string
  format: "csv" | "xlsx"
  encoding: CsvEncoding | null
  delimiter: CsvDelimiter | null
  headers: string[]
  rows: ImportSourceRow[]
}

export class SpreadsheetReadError extends Error {}

const NUMBER_FORMAT = new Intl.NumberFormat("pt-BR", {
  useGrouping: false,
  maximumFractionDigits: 10,
})

/** Célula do .xlsx para texto, no formato que a normalização entende. */
function cellToText(cell: unknown): string {
  if (cell === null || cell === undefined) {
    return ""
  }

  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? "" : cell.toISOString().slice(0, 10)
  }

  if (typeof cell === "number") {
    // Vírgula decimal: "72,5" não se confunde com milhar ("1.234").
    return Number.isFinite(cell) ? NUMBER_FORMAT.format(cell) : ""
  }

  if (typeof cell === "boolean") {
    return cell ? "Sim" : "Não"
  }

  return String(cell)
}

function toTable(records: readonly (readonly string[])[]): {
  headers: string[]
  rows: ImportSourceRow[]
} {
  const isBlank = (cells: readonly string[]) => cells.every((cell) => cell.trim() === "")
  const headerIndex = records.findIndex((cells) => !isBlank(cells))

  if (headerIndex < 0) {
    throw new SpreadsheetReadError("A planilha está vazia.")
  }

  const headerCells = records[headerIndex] ?? []
  const width = records
    .slice(headerIndex + 1)
    .reduce((max, cells) => Math.max(max, cells.length), headerCells.length)
  const headers = Array.from({ length: width }, (_, column) => {
    const header = (headerCells[column] ?? "").replace(/\s+/g, " ").trim()
    return header || `Coluna ${column + 1}`
  })

  const rows: ImportSourceRow[] = []

  records.slice(headerIndex + 1).forEach((cells, offset) => {
    if (isBlank(cells)) {
      return
    }

    rows.push({
      // Número da linha como o Excel mostra (a primeira é a 1).
      line: headerIndex + offset + 2,
      cells: Array.from({ length: width }, (_, column) => cells[column] ?? ""),
    })
  })

  if (rows.length === 0) {
    throw new SpreadsheetReadError("A planilha só tem o cabeçalho. Confira se é o arquivo certo.")
  }

  if (rows.length > IMPORT_MAX_ROWS) {
    throw new SpreadsheetReadError(
      `A planilha tem ${rows.length.toLocaleString("pt-BR")} linhas e o limite é ${IMPORT_MAX_ROWS.toLocaleString("pt-BR")} por arquivo. Divida em arquivos menores e importe um de cada vez.`
    )
  }

  return { headers, rows }
}

export async function readSpreadsheet(file: File): Promise<SpreadsheetData> {
  const name = file.name.toLowerCase()

  if (file.size > IMPORT_MAX_BYTES) {
    throw new SpreadsheetReadError(
      "O arquivo passa de 5 MB. Divida a planilha em arquivos menores ou salve como .csv."
    )
  }

  if (name.endsWith(".xls")) {
    throw new SpreadsheetReadError(
      "Arquivo .xls (Excel antigo) não é aceito. No Excel, use Salvar como > Pasta de Trabalho do Excel (.xlsx) ou CSV."
    )
  }

  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { records, encoding, delimiter } = readCsvBytes(bytes)

    return { fileName: file.name, format: "csv", encoding, delimiter, ...toTable(records) }
  }

  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser")
    let data: unknown[][]

    try {
      data = (await readSheet(file)) as unknown[][]
    } catch {
      throw new SpreadsheetReadError(
        "Não foi possível abrir este .xlsx. Abra no Excel ou no Google Planilhas e salve de novo, ou exporte como CSV."
      )
    }

    const records = data.map((row) => row.map(cellToText))

    return {
      fileName: file.name,
      format: "xlsx",
      encoding: null,
      delimiter: null,
      ...toTable(records),
    }
  }

  throw new SpreadsheetReadError("Envie um arquivo .csv ou .xlsx.")
}
