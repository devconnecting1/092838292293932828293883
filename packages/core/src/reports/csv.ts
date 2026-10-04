/**
 * Montagem do CSV dos relatórios, no formato que o Excel brasileiro abre sem
 * quebrar acento nem juntar tudo numa coluna só:
 *
 * - **BOM UTF-8** no começo do arquivo. Sem ele o Excel do Windows lê o arquivo
 *   como ANSI e "Imóveis" vira "ImÃ³veis".
 * - **`;` como separador**, porque no Windows em pt-BR a vírgula é o separador
 *   decimal e o Excel assume `;` entre as colunas.
 * - **Vírgula decimal e sem separador de milhar** nos números: `1234,5` é lido
 *   como número; `1.234,50` também, mas volta a quebrar em outras localidades.
 * - **CRLF** entre as linhas, que é o que o RFC 4180 pede.
 * - Texto que começa com `=`, `+`, `-`, `@`, TAB ou CR ganha um apóstrofo na
 *   frente: sem isso uma célula vinda do formulário público (nome, motivo de
 *   perda, campanha) vira fórmula ao abrir a planilha. Número nunca recebe o
 *   apóstrofo — senão todo valor negativo deixaria de ser número.
 *
 * Tudo aqui é função pura de string: quem pagina e transmite é a rota do Next
 * (`apps/web/lib/relatorios/export.ts`), e quem soma é o Postgres.
 */

export const CSV_SEPARATOR = ";"
export const CSV_LINE_BREAK = "\r\n"
/** U+FEFF: a marca que diz ao Excel "isto é UTF-8". */
export const CSV_BOM = "﻿"
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8"

export type CsvValue = string | number | boolean | null | undefined

/** Primeiro caractere que faz a célula virar fórmula no Excel e no Sheets. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"] as const

const CSV_NUMBER = new Intl.NumberFormat("pt-BR", {
  useGrouping: false,
  maximumFractionDigits: 10,
})

/** Número em pt-BR para planilha: vírgula decimal, sem ponto de milhar. */
export function formatCsvNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return ""
  }

  // `|| 0` derruba o -0, que sairia como "-0" na planilha.
  return CSV_NUMBER.format(value || 0)
}

function needsQuotes(text: string): boolean {
  return (
    text.includes(CSV_SEPARATOR) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r") ||
    text !== text.trim()
  )
}

/** Uma célula pronta: escapada, entre aspas quando precisa, nunca fórmula. */
export function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "number") {
    return formatCsvNumber(value)
  }

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não"
  }

  const guarded = FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value

  return needsQuotes(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded
}

/** Uma linha, sem a quebra de linha no fim. */
export function buildCsvRow(values: readonly CsvValue[]): string {
  return values.map(escapeCsvValue).join(CSV_SEPARATOR)
}

/** Começo do arquivo: BOM e cabeçalho. É o primeiro pedaço transmitido. */
export function buildCsvHead(columns: readonly string[]): string {
  return `${CSV_BOM}${buildCsvRow(columns)}${CSV_LINE_BREAK}`
}

/** Um pedaço de linhas, cada uma terminada em CRLF. Vazio quando não há linha. */
export function buildCsvLines(rows: Iterable<readonly CsvValue[]>): string {
  let out = ""

  for (const row of rows) {
    out += `${buildCsvRow(row)}${CSV_LINE_BREAK}`
  }

  return out
}

/** Arquivo inteiro em memória: só para relatório agregado, que é curto. */
export function buildCsvDocument(
  columns: readonly string[],
  rows: Iterable<readonly CsvValue[]>
): string {
  return `${buildCsvHead(columns)}${buildCsvLines(rows)}`
}

/**
 * Nome do arquivo baixado: só letras, números, `-` e `_`, com o período no fim
 * ("corretores_2026-09-01_2026-09-16.csv"). Content-Disposition não escapa nada
 * sozinho, então nada de acento, espaço, aspas ou barra chegam aqui.
 */
export function csvFileName(prefix: string, period: { fromDay: string; toDay: string }): string {
  const slug = prefix
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${slug || "relatorio"}_${period.fromDay}_${period.toDay}.csv`
}
