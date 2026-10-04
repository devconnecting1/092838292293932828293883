import { promisify } from "node:util"
import { gunzip } from "node:zlib"

import { CAIXA_MAX_FILE_BYTES, decodeCaixaCsvBytes } from "@workspace/core/caixa/catalog-import"
import { PLATFORM_READ_ONLY_MESSAGE } from "@workspace/core/platform/staff"

import { digestCaixaListBytes, runCaixaCatalogImport } from "@/lib/caixa/ingest"
import { canAct, getPlatformAdmin } from "@/lib/plataforma/admin"
import { logPlatformAction } from "@/lib/plataforma/audit"
import {
  CAIXA_FAILURE_MESSAGES,
  CAIXA_UPLOAD_MAX_BODY_BYTES,
  type CaixaUploadResponse,
} from "@/lib/plataforma/caixa-labels"
import { isSameOriginRequest } from "@/lib/plataforma/request"

/**
 * Recebe a lista oficial da Caixa enviada em /plataforma/caixa.
 *
 * - Só equipe da plataforma (Dono ou pessoa convidada, e-mail confirmado); o
 *   resto recebe 404 antes de o corpo ser lido. "Somente leitura" recebe 403,
 *   também antes de ler o corpo (a carga não passa pelo registro do console,
 *   então esta é a barreira).
 * - Só do próprio site (Origin = host), com corpo `application/gzip` (o
 *   navegador compacta o CSV: a Vercel recusa corpo acima de 4,5 MB) ou
 *   `text/csv`. Descompactado, o arquivo pode ter até 20 MB.
 * - Carga pela mesma função da rotina antiga (`runCaixaCatalogImport`): mesmo
 *   leitor, mesmas validações e as mesmas RPCs com CAIXA_SERVER_KEY.
 *
 * Carga que mudou o catálogo vai para o registro do console (quem enviou e as
 * contagens); falha no registro não desfaz a carga, só vai ao log.
 *
 * Resposta e log só com contagens.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** ~10.500 imóveis em 22 lotes levam de 10 a 30 s. */
export const maxDuration = 120

const gunzipAsync = promisify(gunzip)

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }

function reply(status: number, body: CaixaUploadResponse) {
  return Response.json(body, { status, headers: NO_STORE })
}

function failure(
  status: number,
  reason: Extract<CaixaUploadResponse, { ok: false }>["reason"],
  message: string
) {
  return reply(status, { ok: false, reason, message })
}

type BodyRead = { ok: true; bytes: Uint8Array } | { ok: false; tooLarge: boolean }

/** Lê o corpo parando no teto, sem carregar resposta gigante na memória. */
async function readBody(request: Request, limit: number): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? "0")

  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, tooLarge: true }
  }

  if (!request.body) {
    return { ok: false, tooLarge: false }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      size += value.byteLength

      if (size > limit) {
        await reader.cancel()
        return { ok: false, tooLarge: true }
      }

      chunks.push(value)
    }
  } catch {
    return { ok: false, tooLarge: false }
  }

  const bytes = new Uint8Array(size)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { ok: true, bytes }
}

function isGzip(bytes: Uint8Array) {
  return bytes[0] === 0x1f && bytes[1] === 0x8b
}

export async function POST(request: Request) {
  const admin = await getPlatformAdmin()

  if (!admin) {
    return new Response(null, { status: 404, headers: NO_STORE })
  }

  if (!isSameOriginRequest(request)) {
    return failure(403, "origem_invalida", "Envie o arquivo pela página da plataforma.")
  }

  if (!canAct(admin)) {
    return failure(403, "somente_leitura", PLATFORM_READ_ONLY_MESSAGE)
  }

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  const compressed = contentType === "application/gzip"

  if (!compressed && contentType !== "text/csv") {
    return failure(415, "tipo_invalido", "Envie o arquivo .csv baixado do site da Caixa.")
  }

  const body = await readBody(
    request,
    compressed
      ? CAIXA_UPLOAD_MAX_BODY_BYTES
      : Math.min(CAIXA_UPLOAD_MAX_BODY_BYTES, CAIXA_MAX_FILE_BYTES)
  )

  if (!body.ok) {
    return body.tooLarge
      ? failure(413, "arquivo_grande_demais", CAIXA_FAILURE_MESSAGES.arquivo_grande_demais)
      : failure(400, "leitura_falhou", CAIXA_FAILURE_MESSAGES.leitura_falhou)
  }

  let bytes = body.bytes

  if (compressed) {
    if (!isGzip(bytes)) {
      return failure(400, "leitura_falhou", CAIXA_FAILURE_MESSAGES.leitura_falhou)
    }

    try {
      bytes = new Uint8Array(await gunzipAsync(bytes, { maxOutputLength: CAIXA_MAX_FILE_BYTES }))
    } catch (cause) {
      const tooLarge = cause instanceof RangeError
      return tooLarge
        ? failure(413, "arquivo_grande_demais", CAIXA_FAILURE_MESSAGES.arquivo_grande_demais)
        : failure(400, "leitura_falhou", CAIXA_FAILURE_MESSAGES.leitura_falhou)
    }
  }

  if (bytes.byteLength === 0) {
    return failure(400, "sem_arquivo", "O arquivo enviado está vazio.")
  }

  const outcome = await runCaixaCatalogImport(decodeCaixaCsvBytes(bytes), {
    digest: digestCaixaListBytes(bytes),
  })

  if (!outcome.ok) {
    console.error(
      `[caixa/envio] carga recusada (${outcome.reason}${outcome.detail && outcome.reason !== "cabecalho_mudou" ? `: ${outcome.detail}` : ""})`
    )

    return reply(422, {
      ok: false,
      reason: outcome.reason,
      message: CAIXA_FAILURE_MESSAGES[outcome.reason],
      rejectedByReason: outcome.file?.rejectedByReason,
    })
  }

  if (outcome.result !== "changed") {
    return reply(200, { ok: true, result: "unchanged" })
  }

  console.log(
    `[caixa/envio] lista de ${outcome.generatedOn ?? "data desconhecida"}: ` +
      `${outcome.inserted} novos, ${outcome.updated} atualizados, ` +
      `${outcome.rejected} recusados, ${outcome.delisted} fora da lista, ${outcome.total} ativos`
  )

  const logged = await logPlatformAction({
    action: "caixa.enviar_lista",
    target: { type: "catalogo_caixa" },
    after: {
      lista_gerada_em: outcome.generatedOn,
      ativos: outcome.total,
      novos: outcome.inserted,
      atualizados: outcome.updated,
      recusados: outcome.rejected,
      fora_da_lista: outcome.delisted,
    },
  })

  if (!logged.ok) {
    console.error(`[caixa/envio] carga feita, mas o registro do console falhou (${logged.reason})`)
  }

  return reply(200, {
    ok: true,
    result: "changed",
    generatedOn: outcome.generatedOn,
    total: outcome.total,
    inserted: outcome.inserted,
    updated: outcome.updated,
    rejected: outcome.rejected,
    delisted: outcome.delisted,
    rejectedByReason: outcome.file.rejectedByReason,
  })
}
