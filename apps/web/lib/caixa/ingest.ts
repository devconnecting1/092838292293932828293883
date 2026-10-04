import "server-only"

import { createHash } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  CAIXA_MAX_FILE_BYTES,
  caixaSyncFailed,
  caixaSyncQuiet,
  decodeCaixaCsvBytes,
  EMPTY_CAIXA_SOURCE,
  processCaixaListText,
  type CaixaCatalogWriter,
  type CaixaSourceFingerprint,
  type CaixaSyncFailureReason,
  type CaixaSyncOrigin,
  type CaixaSyncOutcome,
} from "@workspace/core/caixa/catalog-import"
import { CAIXA_LIST_URL, CAIXA_ORIGIN } from "@workspace/core/caixa/source"
import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Carga do catálogo da Caixa no servidor, em duas etapas separadas:
 *
 * 1. **obter o texto do CSV**
 *    - `runCaixaCatalogImport`: o arquivo oficial que uma pessoa da equipe da
 *      plataforma baixou no navegador e enviou em `/plataforma/caixa` (ou pelo
 *      comando local `npm run caixa:importar`). É o caminho em uso;
 *    - `runCaixaCatalogSync`: download direto do site da Caixa, com requisição
 *      condicional. **Não está agendado**: o site responde 403 (proteção
 *      anti-robô, que redireciona para um desafio) e contornar isso nunca é
 *      opção. Fica aqui só para o dia em que a Caixa liberar o acesso;
 * 2. **processar e gravar** — `processCaixaListText` (packages/core): mesmo
 *    leitor, mesmas validações e as mesmas RPCs com `CAIXA_SERVER_KEY` (nunca
 *    service_role) para as duas origens.
 */

export type { CaixaSyncOutcome }

/** Uma tentativa, 60 s. Sem laço de repetição. */
const FETCH_TIMEOUT_MS = 60_000

const USER_AGENT =
  "PlataformaImobiliariaCRM/1.0 (catalogo de imoveis da Caixa; verificacao condicional)"

type CatalogConnection = { supabase: SupabaseClient<Database>; serverKey: string }

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Cliente sem sessão (chave publishable) + chave do servidor exigida pelas RPCs. */
function connect():
  { ok: true; connection: CatalogConnection } | { ok: false; outcome: CaixaSyncOutcome } {
  const serverKey = process.env.CAIXA_SERVER_KEY?.trim()

  if (!serverKey) {
    return { ok: false, outcome: caixaSyncFailed("sem_chave_do_servidor") }
  }

  const env = getSupabaseEnv()

  if (!env) {
    return { ok: false, outcome: caixaSyncFailed("supabase_nao_configurado") }
  }

  const supabase = createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  return { ok: true, connection: { supabase, serverKey } }
}

/** As RPCs do catálogo, com a chave do servidor e a origem do arquivo. */
function catalogWriter({ supabase, serverKey }: CatalogConnection): CaixaCatalogWriter {
  return {
    async ingestBatch({ syncId, generatedOn, rows }) {
      const { data, error } = await supabase.rpc("ingest_caixa_listings", {
        p_server_key: serverKey,
        p_sync_id: syncId,
        p_generated_on: generatedOn ?? undefined,
        p_rows: rows,
      })

      return error ? { ok: false, code: error.code ?? null } : { ok: true, data: readRecord(data) }
    },
    async finish({ syncId, generatedOn, rejected, source, origin }) {
      const { data, error } = await supabase.rpc("finish_caixa_sync", {
        p_server_key: serverKey,
        p_sync_id: syncId,
        p_generated_on: generatedOn ?? undefined,
        p_rejected: rejected,
        p_source_last_modified: source.lastModified ?? undefined,
        p_source_etag: source.etag ?? undefined,
        p_source_digest: source.digest ?? undefined,
        p_origem: origin,
      })

      return error ? { ok: false, code: error.code ?? null } : { ok: true, data: readRecord(data) }
    },
    async recordCheck({ result, source, failureReason, origin }) {
      const { data } = await supabase.rpc("record_caixa_check", {
        p_server_key: serverKey,
        p_result: result,
        p_source_last_modified: source?.lastModified ?? undefined,
        p_source_etag: source?.etag ?? undefined,
        p_source_digest: source?.digest ?? undefined,
        p_failure_reason: failureReason ?? undefined,
        p_origem: origin,
      })

      return Number(readRecord(data).checks_since_change ?? 0)
    },
  }
}

/** Assinatura da última carga gravada (Last-Modified, ETag e SHA-256). */
async function readPreviousSource(
  connection: CatalogConnection
): Promise<{ ok: true; previous: CaixaSourceFingerprint } | { ok: false; code: string | null }> {
  const { data, error } = await connection.supabase.rpc("get_caixa_sync_state", {
    p_server_key: connection.serverKey,
  })

  if (error) {
    return { ok: false, code: error.code ?? null }
  }

  const state = readRecord(data)

  return {
    ok: true,
    previous: {
      lastModified: readString(state.source_last_modified),
      etag: readString(state.source_etag),
      digest: readString(state.source_digest),
    },
  }
}

/** SHA-256 (hex) dos bytes do arquivo: reenviar o mesmo arquivo não regrava nada. */
export function digestCaixaListBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export type CaixaCatalogState = {
  /** Data declarada pela Caixa no arquivo da última carga (ISO). */
  generatedOn: string | null
  /** Quando a última carga terminou. */
  syncedAt: string | null
  totalActive: number
}

/**
 * Estado da última carga lido sem sessão (chave do servidor), para a rotina
 * diária do lembrete. As telas leem `caixa_catalog_status` com a sessão.
 */
export async function readCaixaCatalogState(): Promise<
  { ok: true; state: CaixaCatalogState } | { ok: false; reason: CaixaSyncFailureReason }
> {
  const connected = connect()

  if (!connected.ok) {
    return {
      ok: false,
      reason: connected.outcome.ok ? "estado_indisponivel" : connected.outcome.reason,
    }
  }

  const { data, error } = await connected.connection.supabase.rpc("get_caixa_sync_state", {
    p_server_key: connected.connection.serverKey,
  })

  if (error) {
    return { ok: false, reason: "estado_indisponivel" }
  }

  const state = readRecord(data)

  return {
    ok: true,
    state: {
      generatedOn: readString(state.lista_gerada_em),
      syncedAt: readString(state.sincronizado_em),
      totalActive: Number(state.total_ativo ?? 0) || 0,
    },
  }
}

async function processText(
  connection: CatalogConnection,
  text: string,
  source: CaixaSourceFingerprint,
  previous: CaixaSourceFingerprint,
  origin: CaixaSyncOrigin
) {
  return processCaixaListText(
    { text, source, previous, origin, mode: "gravar", newSyncId: () => crypto.randomUUID() },
    catalogWriter(connection)
  )
}

// -----------------------------------------------------------------------------
// Obter o texto: envio manual (o caminho em uso)
// -----------------------------------------------------------------------------

export type CaixaImportMeta = {
  /** SHA-256 (hex) dos bytes do arquivo enviado (`digestCaixaListBytes`). */
  digest: string
  /**
   * `true`: só valida e resume o arquivo — não conecta ao banco, não precisa
   * da chave do servidor e não grava nada.
   */
  simulate?: boolean
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/

/** Na simulação nenhuma RPC pode ser chamada; se for, é erro de programação. */
const simulationWriter: CaixaCatalogWriter = {
  ingestBatch: () => Promise.reject(new Error("simulação não grava lotes")),
  finish: () => Promise.reject(new Error("simulação não fecha carga")),
  recordCheck: () => Promise.reject(new Error("simulação não registra verificação")),
}

/**
 * Carga do arquivo oficial enviado pela equipe da plataforma. `text` é o CSV
 * já decodificado (`decodeCaixaCsvBytes`). Quem chama confere antes quem
 * enviou (`requirePlatformAdmin`) e o tamanho do arquivo.
 */
export async function runCaixaCatalogImport(
  text: string,
  meta: CaixaImportMeta
): Promise<CaixaSyncOutcome> {
  const digest = meta.digest.toLowerCase()
  const source: CaixaSourceFingerprint = {
    ...EMPTY_CAIXA_SOURCE,
    digest: DIGEST_PATTERN.test(digest) ? digest : null,
  }

  if (meta.simulate) {
    return processCaixaListText(
      {
        text,
        source,
        previous: EMPTY_CAIXA_SOURCE,
        origin: "envio_manual",
        mode: "simular",
        newSyncId: () => crypto.randomUUID(),
      },
      simulationWriter
    )
  }

  const connected = connect()

  if (!connected.ok) {
    return connected.outcome
  }

  const state = await readPreviousSource(connected.connection)

  if (!state.ok) {
    return caixaSyncFailed("estado_indisponivel", state.code ?? undefined)
  }

  return processText(connected.connection, text, source, state.previous, "envio_manual")
}

// -----------------------------------------------------------------------------
// Obter o texto: download direto (NÃO agendado; bloqueado pelo site da Caixa)
// -----------------------------------------------------------------------------

type DownloadResult =
  | { status: "not_modified" }
  | { status: "ok"; text: string; source: CaixaSourceFingerprint }
  | { status: "failed"; reason: CaixaSyncFailureReason; detail?: string }

/**
 * Pergunta à Caixa se o arquivo mudou (If-Modified-Since / If-None-Match).
 * Qualquer sinal de que não veio o CSV esperado — fora do ar, redirecionamento
 * para outro host (o desafio anti-robô sai por aí), página HTML ou tamanho
 * absurdo — vira falha, e falha mantém o catálogo anterior. Uma tentativa só:
 * insistir é o que dispara o bloqueio, e resolver o desafio nunca é opção.
 */
async function downloadListFile(previous: CaixaSourceFingerprint): Promise<DownloadResult> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "text/csv,application/octet-stream;q=0.9,*/*;q=0.1",
  }

  if (previous.lastModified) {
    headers["If-Modified-Since"] = previous.lastModified
  }

  if (previous.etag) {
    headers["If-None-Match"] = previous.etag
  }

  let response: Response

  try {
    response = await fetch(CAIXA_LIST_URL, {
      headers,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return { status: "failed", reason: "download_falhou" }
  }

  if (response.status === 304) {
    return { status: "not_modified" }
  }

  if (!response.ok) {
    return { status: "failed", reason: "http_nao_ok", detail: String(response.status) }
  }

  if (response.url && !response.url.startsWith(`${CAIXA_ORIGIN}/`)) {
    return { status: "failed", reason: "redirecionado" }
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""

  if (contentType.includes("html")) {
    return { status: "failed", reason: "resposta_html" }
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0")

  if (Number.isFinite(declaredLength) && declaredLength > CAIXA_MAX_FILE_BYTES) {
    return { status: "failed", reason: "arquivo_grande_demais", detail: String(declaredLength) }
  }

  let buffer: ArrayBuffer

  try {
    buffer = await response.arrayBuffer()
  } catch {
    return { status: "failed", reason: "leitura_falhou" }
  }

  if (buffer.byteLength > CAIXA_MAX_FILE_BYTES) {
    return { status: "failed", reason: "arquivo_grande_demais", detail: String(buffer.byteLength) }
  }

  const bytes = new Uint8Array(buffer)

  return {
    status: "ok",
    text: decodeCaixaCsvBytes(bytes),
    source: {
      lastModified: response.headers.get("last-modified"),
      etag: response.headers.get("etag"),
      digest: digestCaixaListBytes(bytes),
    },
  }
}

/**
 * Download direto + carga. **Não chame em rotina agendada** enquanto o site da
 * Caixa bloquear robôs: a rota /api/cron/caixa-catalog não usa mais esta função.
 */
export async function runCaixaCatalogSync(): Promise<CaixaSyncOutcome> {
  const connected = connect()

  if (!connected.ok) {
    return connected.outcome
  }

  const { connection } = connected
  const state = await readPreviousSource(connection)

  if (!state.ok) {
    return caixaSyncFailed("estado_indisponivel", state.code ?? undefined)
  }

  const writer = catalogWriter(connection)
  const downloaded = await downloadListFile(state.previous)

  if (downloaded.status === "failed") {
    await writer.recordCheck({
      result: "falha",
      source: null,
      failureReason: downloaded.reason,
      origin: "download_automatico",
    })
    return caixaSyncFailed(downloaded.reason, downloaded.detail)
  }

  if (downloaded.status === "not_modified") {
    const checks = await writer.recordCheck({
      result: "not_modified",
      source: null,
      failureReason: null,
      origin: "download_automatico",
    })
    return caixaSyncQuiet("not_modified", checks)
  }

  return processText(
    connection,
    downloaded.text,
    downloaded.source,
    state.previous,
    "download_automatico"
  )
}
