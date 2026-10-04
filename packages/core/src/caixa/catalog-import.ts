/**
 * Processamento e gravação de UMA lista da Caixa, venha o arquivo de onde vier.
 *
 * A carga tem duas etapas separadas de propósito:
 *
 * 1. **obter o texto do CSV** — hoje, o arquivo que a equipe da plataforma
 *    baixa no navegador e envia em `/plataforma/caixa` ou pelo comando local
 *    `npm run caixa:importar` (`envio_manual`). O download automático
 *    (`download_automatico`) recebe 403 da proteção anti-robô do site da Caixa
 *    e não é contornado;
 * 2. **processar e gravar** — `processCaixaListText`. Mesmo leitor
 *    (`parseCaixaCsv`), mesmas validações (`inspectCaixaListText`) e as mesmas
 *    RPCs, qualquer que seja a origem: só o evento registrado muda. No modo
 *    `simular`, as validações rodam inteiras e nada é gravado.
 *
 * Nada aqui faz I/O: as RPCs chegam por `CaixaCatalogWriter` (no servidor Next,
 * com a chave `CAIXA_SERVER_KEY`, nunca service_role), o que deixa o fluxo
 * inteiro testável sem banco.
 *
 * **Idempotente.** Reenviar o mesmo arquivo não regrava nada (o SHA-256 bate
 * com o da última carga). E mesmo sem essa conferência o resultado seria o
 * mesmo: o upsert é por número do imóvel (não duplica) e quem está no arquivo
 * recebe a carga nova, então ninguém é marcado como "saiu da lista" à toa.
 *
 * **Falha não apaga nada.** Arquivo torto, lista de um estado só, poucos
 * registros ou erro no banco: registra o motivo e o catálogo anterior continua
 * valendo. Sem o fechamento da carga, nenhum imóvel é marcado como fora da lista.
 */

import { decodeCsvBytes } from "../import/csv"
import {
  parseCaixaCsv,
  type CaixaCsvRejection,
  type CaixaListingRow,
  type CaixaRejectionReason,
} from "./csv"
import { caixaListingToRpcRow, type CaixaRpcRow } from "./rpc-row"

/** De onde veio o arquivo (coluna `origem` de `caixa_sync_events`). */
export const CAIXA_SYNC_ORIGINS = ["download_automatico", "envio_manual"] as const

export type CaixaSyncOrigin = (typeof CAIXA_SYNC_ORIGINS)[number]

/** Linhas por chamada à RPC (o jsonb inteiro não cabe num POST do PostgREST). */
export const CAIXA_IMPORT_BATCH_SIZE = 500

/** Piso de registros para a carga valer (o arquivo nacional tem ~8.000 a 11.000). */
export const CAIXA_MIN_LISTINGS = 1_000

/**
 * A lista geral traz imóveis de todo o país. Arquivo com uma UF só é a lista
 * de um estado baixada por engano: gravá-la marcaria todos os outros estados
 * como "saiu da lista".
 */
export const CAIXA_MIN_STATES = 2

/** O arquivo tem de 3 a 4 MB; 20 MB é teto defensivo. */
export const CAIXA_MAX_FILE_BYTES = 20 * 1024 * 1024

/** Assinatura do arquivo da última carga, para não regravar o mesmo conteúdo. */
export type CaixaSourceFingerprint = {
  lastModified: string | null
  etag: string | null
  /** SHA-256 (hex) dos bytes do arquivo. */
  digest: string | null
}

export const EMPTY_CAIXA_SOURCE: CaixaSourceFingerprint = {
  lastModified: null,
  etag: null,
  digest: null,
}

export type CaixaCheckResult = "not_modified" | "unchanged" | "falha"

/** Motivos estáveis, sem texto livre: vão para o evento, o log e a tela. */
export type CaixaSyncFailureReason =
  // Configuração do servidor
  | "sem_chave_do_servidor"
  | "supabase_nao_configurado"
  | "estado_indisponivel"
  // Download automático (bloqueado pela proteção anti-robô do site)
  | "download_falhou"
  | "http_nao_ok"
  | "redirecionado"
  | "resposta_html"
  | "leitura_falhou"
  // Arquivo
  | "arquivo_grande_demais"
  | "cabecalho_mudou"
  | "arquivo_vazio"
  | "lista_de_um_estado"
  | "poucos_registros"
  // Gravação
  | "gravacao_falhou"
  | "fechamento_falhou"
  | "carga_simultanea"

/** O que foi lido do arquivo, sem nada de banco. */
export type CaixaListSummary = {
  /** Data de geração declarada pela Caixa (ISO), quando o arquivo traz. */
  generatedOn: string | null
  /** Registros válidos. */
  accepted: number
  /** Linhas recusadas na leitura. */
  rejected: number
  rejectedByReason: Partial<Record<CaixaRejectionReason, number>>
  /** Quantas UFs diferentes aparecem nos registros válidos. */
  states: number
}

export type CaixaListInspection =
  | {
      ok: true
      summary: CaixaListSummary
      rows: CaixaListingRow[]
      rejections: CaixaCsvRejection[]
    }
  | {
      ok: false
      reason: "cabecalho_mudou" | "arquivo_vazio" | "lista_de_um_estado" | "poucos_registros"
      detail?: string
      /** Ausente quando nem o cabeçalho foi reconhecido. */
      summary?: CaixaListSummary
    }

export type CaixaWriteResult =
  { ok: true; data: Record<string, unknown> } | { ok: false; code: string | null }

/** As RPCs do catálogo, do jeito que o servidor Next as chama. */
export type CaixaCatalogWriter = {
  /** `ingest_caixa_listings`: um lote de até 500 linhas. */
  ingestBatch(input: {
    syncId: string
    generatedOn: string | null
    rows: CaixaRpcRow[]
  }): Promise<CaixaWriteResult>
  /** `finish_caixa_sync`: marca quem saiu da lista e grava o status. */
  finish(input: {
    syncId: string
    generatedOn: string | null
    rejected: number
    source: CaixaSourceFingerprint
    origin: CaixaSyncOrigin
  }): Promise<CaixaWriteResult>
  /** `record_caixa_check`: verificação que não mudou nada (ou falhou). */
  recordCheck(input: {
    result: CaixaCheckResult
    source: CaixaSourceFingerprint | null
    failureReason: CaixaSyncFailureReason | null
    origin: CaixaSyncOrigin
  }): Promise<number>
}

export type CaixaSyncOutcome =
  | {
      ok: true
      /** O catálogo mudou. */
      result: "changed"
      generatedOn: string | null
      received: number
      accepted: number
      inserted: number
      updated: number
      /** Recusados na leitura do arquivo + recusados no banco. */
      rejected: number
      delisted: number
      total: number
      batches: number
      /** Verificações sem mudança desde a mudança anterior. */
      checksSinceChange: number
      file: CaixaListSummary
    }
  | {
      ok: true
      /** Modo simular: tudo validado, nada gravado. */
      result: "simulated"
      /** Lotes que a carga de verdade mandaria ao banco. */
      batches: number
      file: CaixaListSummary
    }
  | {
      ok: true
      /** Nada a fazer: 304 do download ou arquivo idêntico ao da última carga. */
      result: "not_modified" | "unchanged"
      checksSinceChange: number
    }
  | {
      ok: false
      reason: CaixaSyncFailureReason
      /** Código técnico curto (status HTTP, SQLSTATE, contagem, UF). Nunca dado de imóvel. */
      detail?: string
      /** O que foi lido do arquivo, quando a falha veio depois da leitura. */
      file?: CaixaListSummary
    }

export function caixaSyncFailed(
  reason: CaixaSyncFailureReason,
  detail?: string,
  file?: CaixaListSummary
): CaixaSyncOutcome {
  return {
    ok: false,
    reason,
    ...(detail ? { detail } : {}),
    ...(file ? { file } : {}),
  }
}

export function caixaSyncQuiet(
  result: "not_modified" | "unchanged",
  checksSinceChange: number
): CaixaSyncOutcome {
  return { ok: true, result, checksSinceChange }
}

/**
 * Bytes do arquivo → texto. A Caixa publica em Windows-1252; um arquivo que
 * alguém abriu e salvou de novo como "CSV UTF-8" também é lido certo (UTF-8
 * estrito, com ou sem BOM, e Windows-1252 quando algum byte não é UTF-8).
 */
export function decodeCaixaCsvBytes(bytes: Uint8Array): string {
  return decodeCsvBytes(bytes).text
}

/**
 * Lê o texto e aplica TODAS as validações de conteúdo da carga: cabeçalho,
 * registros válidos, lista nacional (mais de uma UF) e piso de registros.
 * Usada pela gravação e pela simulação — as duas decidem igual.
 */
export function inspectCaixaListText(text: string): CaixaListInspection {
  const parsed = parseCaixaCsv(text)

  if (!parsed.ok) {
    // Cabeçalho diferente = a Caixa mudou o formato (ou o arquivo não é a
    // lista). O detalhe traz o cabeçalho encontrado para a correção ser rápida.
    return parsed.reason === "cabecalho"
      ? { ok: false, reason: "cabecalho_mudou", detail: parsed.foundHeader ?? undefined }
      : { ok: false, reason: "arquivo_vazio" }
  }

  const rejectedByReason: Partial<Record<CaixaRejectionReason, number>> = {}

  for (const rejection of parsed.rejected) {
    rejectedByReason[rejection.reason] = (rejectedByReason[rejection.reason] ?? 0) + 1
  }

  const states = new Set(parsed.rows.map((row) => row.uf))
  const summary: CaixaListSummary = {
    generatedOn: parsed.generatedOn,
    accepted: parsed.rows.length,
    rejected: parsed.rejected.length,
    rejectedByReason,
    states: states.size,
  }

  if (states.size < CAIXA_MIN_STATES) {
    return { ok: false, reason: "lista_de_um_estado", detail: [...states].join(","), summary }
  }

  if (parsed.rows.length < CAIXA_MIN_LISTINGS) {
    return {
      ok: false,
      reason: "poucos_registros",
      detail: String(parsed.rows.length),
      summary,
    }
  }

  return { ok: true, summary, rows: parsed.rows, rejections: parsed.rejected }
}

function countOf(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** SQLSTATE de finish_caixa_sync quando outra carga gravou imóveis durante esta. */
const CONCURRENT_LOAD_CODE = "40001"

export type ProcessCaixaListInput = {
  /** Texto do CSV já decodificado (ver `decodeCaixaCsvBytes`). */
  text: string
  /** Assinatura do arquivo recebido. */
  source: CaixaSourceFingerprint
  /** Assinatura da última carga gravada (`get_caixa_sync_state`). */
  previous: CaixaSourceFingerprint
  origin: CaixaSyncOrigin
  /** `simular`: valida tudo e não chama nenhuma RPC. */
  mode: "gravar" | "simular"
  /** Identificador da carga (UUID). Injetado para o teste ser determinístico. */
  newSyncId: () => string
}

/** Processa o texto do CSV e grava o catálogo pelas RPCs (ou só valida, no modo simular). */
export async function processCaixaListText(
  input: ProcessCaixaListInput,
  writer: CaixaCatalogWriter
): Promise<CaixaSyncOutcome> {
  const { origin, source } = input
  const simulate = input.mode === "simular"

  async function fail(reason: CaixaSyncFailureReason, detail?: string, file?: CaixaListSummary) {
    if (!simulate) {
      await writer.recordCheck({ result: "falha", source: null, failureReason: reason, origin })
    }

    return caixaSyncFailed(reason, detail, file)
  }

  // Mesmo arquivo da última carga: nada a gravar.
  if (!simulate && input.previous.digest && source.digest === input.previous.digest) {
    const checks = await writer.recordCheck({
      result: "unchanged",
      source,
      failureReason: null,
      origin,
    })

    return caixaSyncQuiet("unchanged", checks)
  }

  const inspection = inspectCaixaListText(input.text)

  if (!inspection.ok) {
    return fail(inspection.reason, inspection.detail, inspection.summary)
  }

  const { rows, summary } = inspection
  const plannedBatches = Math.ceil(rows.length / CAIXA_IMPORT_BATCH_SIZE)

  if (simulate) {
    return { ok: true, result: "simulated", batches: plannedBatches, file: summary }
  }

  const syncId = input.newSyncId()
  const totals = { received: 0, accepted: 0, inserted: 0, updated: 0, rejected: 0 }
  let batches = 0

  for (let start = 0; start < rows.length; start += CAIXA_IMPORT_BATCH_SIZE) {
    const batch = rows.slice(start, start + CAIXA_IMPORT_BATCH_SIZE).map(caixaListingToRpcRow)
    const written = await writer.ingestBatch({
      syncId,
      generatedOn: summary.generatedOn,
      rows: batch,
    })

    if (!written.ok) {
      // Sem fechar a carga, nada é marcado como "saiu da lista": o catálogo
      // anterior continua íntegro e o próximo envio refaz tudo.
      return fail("gravacao_falhou", written.code ?? undefined, summary)
    }

    batches += 1
    totals.received += countOf(written.data.received)
    totals.accepted += countOf(written.data.accepted)
    totals.inserted += countOf(written.data.inserted)
    totals.updated += countOf(written.data.updated)
    totals.rejected += countOf(written.data.rejected)
  }

  // Linhas recusadas na leitura do arquivo + linhas recusadas no banco.
  const rejected = summary.rejected + totals.rejected

  const finished = await writer.finish({
    syncId,
    generatedOn: summary.generatedOn,
    rejected,
    source,
    origin,
  })

  if (!finished.ok) {
    return finished.code === CONCURRENT_LOAD_CODE
      ? fail("carga_simultanea", finished.code, summary)
      : fail("fechamento_falhou", finished.code ?? undefined, summary)
  }

  return {
    ok: true,
    result: "changed",
    generatedOn: summary.generatedOn,
    received: totals.received,
    accepted: totals.accepted,
    inserted: totals.inserted,
    updated: totals.updated,
    rejected,
    delisted: countOf(finished.data.delisted),
    total: countOf(finished.data.total),
    batches,
    checksSinceChange: countOf(finished.data.checks_since_change),
    file: summary,
  }
}
