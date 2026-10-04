import "server-only"

import {
  buildCsvHead,
  buildCsvLines,
  CSV_CONTENT_TYPE,
  type CsvValue,
} from "@workspace/core/reports/csv"

/**
 * Transmissão do CSV.
 *
 * A base de uma imobiliária grande não cabe confortavelmente na memória de uma
 * função serverless, e montar o arquivo inteiro antes de responder estoura o
 * tempo limite. Então:
 *
 * 1. o cabeçalho sai assim que a resposta começa;
 * 2. cada `pull` do `ReadableStream` pede UMA página ao Postgres (chave
 *    composta `(created_at, id)`, nunca OFFSET, que fica mais lento a cada
 *    página) e transmite só aquelas linhas;
 * 3. nada além da página corrente fica em memória, no Node ou no Postgres.
 *
 * O navegador começa a baixar antes de o banco terminar de ler, e a função não
 * segura mais do que `EXPORT_PAGE_SIZE` registros por vez.
 */

/** Linhas por página. Tem que caber no teto da RPC (2.000). */
export const EXPORT_PAGE_SIZE = 500
/** Teto de segurança: 100 páginas. Acima disso o arquivo sai avisando que cortou. */
export const EXPORT_MAX_PAGES = 100

export type ExportCursor = {
  createdAt: string
  id: string
}

export type ExportPage = {
  rows: CsvValue[][]
  /** Onde continuar, ou `null` quando acabou. */
  cursor: ExportCursor | null
}

export type ExportPageLoader = (cursor: ExportCursor | null) => Promise<ExportPage>

const TRUNCATED_NOTICE =
  "Exportação interrompida: o arquivo atingiu o limite desta tela. Refaça com um período menor."
const FAILED_NOTICE =
  "Exportação interrompida por uma falha ao ler o banco. Refaça a exportação em instantes."

/**
 * Última linha honesta. Um CSV que simplesmente para no meio parece completo e
 * vira decisão errada; esta linha diz que faltou dado.
 */
function noticeLine(columnCount: number, message: string) {
  const row: CsvValue[] = new Array(Math.max(columnCount, 1)).fill(null)
  row[0] = message
  return buildCsvLines([row])
}

/** Fluxo de um CSV paginado no banco. */
export function createPagedCsvStream(
  columns: readonly string[],
  loadPage: ExportPageLoader
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let cursor: ExportCursor | null = null
  let pages = 0
  let finished = false

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(buildCsvHead(columns)))
    },
    async pull(controller) {
      if (finished) {
        controller.close()
        return
      }

      try {
        const page = await loadPage(cursor)

        if (page.rows.length > 0) {
          controller.enqueue(encoder.encode(buildCsvLines(page.rows)))
        }

        pages += 1
        cursor = page.cursor

        if (!cursor) {
          finished = true
          controller.close()
          return
        }

        if (pages >= EXPORT_MAX_PAGES) {
          controller.enqueue(encoder.encode(noticeLine(columns.length, TRUNCATED_NOTICE)))
          finished = true
          controller.close()
        }
      } catch (error) {
        // O cabeçalho já foi enviado: não dá para trocar o status por 500. O que
        // dá para fazer é fechar o arquivo dizendo que ele está incompleto.
        console.error(
          "[relatorios] falha ao transmitir a exportação:",
          error instanceof Error ? error.message : "erro desconhecido"
        )
        controller.enqueue(encoder.encode(noticeLine(columns.length, FAILED_NOTICE)))
        finished = true
        controller.close()
      }
    },
  })
}

/** Fluxo de um relatório já agregado (poucas linhas, uma consulta só). */
export function createSingleCsvStream(
  columns: readonly string[],
  loadRows: () => Promise<CsvValue[][]>
): ReadableStream<Uint8Array> {
  let served = false

  return createPagedCsvStream(columns, async () => {
    if (served) {
      return { rows: [], cursor: null }
    }

    served = true
    return { rows: await loadRows(), cursor: null }
  })
}

/**
 * Resposta do download. `attachment` força o "salvar como"; `no-store` porque o
 * arquivo tem dado pessoal e não pode ficar em cache compartilhado.
 */
export function csvResponse(fileName: string, body: ReadableStream<Uint8Array>) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      // csvFileName() já garante que só há [a-z0-9-_.] aqui.
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  })
}
