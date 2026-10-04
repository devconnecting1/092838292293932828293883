import "server-only"

import { lookup as dnsLookup } from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import type { LookupFunction } from "node:net"

import {
  checkPhotoUrl,
  isPublicIpAddress,
  PHOTO_DOWNLOAD_MAX_BYTES,
  PHOTO_DOWNLOAD_MAX_REDIRECTS,
  PHOTO_DOWNLOAD_TIMEOUT_MS,
  sniffImageType,
  type SniffedImage,
} from "@workspace/core/import/photo-links"

/**
 * Download de foto por link da planilha, só no servidor, com proteção contra
 * SSRF:
 *   · só http/https, porta padrão, sem usuário/senha (checkPhotoUrl);
 *   · o DNS é resolvido por nós e TODOS os endereços precisam ser públicos; a
 *     conexão usa o endereço conferido (sem nova resolução, então não há troca
 *     de DNS entre a checagem e a conexão);
 *   · redirecionamento é seguido à mão (até 3) e cada destino passa pelas
 *     mesmas regras;
 *   · timeout total e teto de bytes (a resposta é cortada ao passar);
 *   · o tipo é conferido pelos primeiros bytes, não pelo Content-Type.
 * Nada do link é registrado em log.
 */

export type PhotoDownloadErrorCode =
  | "invalid_link"
  | "blocked_address"
  | "timeout"
  | "too_large"
  | "not_image"
  | "http_error"
  | "download_failed"

export type PhotoDownloadResult =
  { ok: true; bytes: Buffer; type: SniffedImage } | { ok: false; code: PhotoDownloadErrorCode }

class BlockedAddressError extends Error {
  readonly code = "EBLOCKEDADDRESS"
}

/** Resolve o nome e só entrega endereços públicos (recusa se houver qualquer um interno). */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true })
    .then((addresses) => {
      if (
        addresses.length === 0 ||
        addresses.some((address) => !isPublicIpAddress(address.address))
      ) {
        callback(new BlockedAddressError("endereço bloqueado"), "", 4)
        return
      }

      if (options.all) {
        ;(
          callback as unknown as (
            error: null,
            addresses: { address: string; family: number }[]
          ) => void
        )(
          null,
          addresses.map((address) => ({ address: address.address, family: address.family }))
        )
        return
      }

      const [first] = addresses
      callback(null, first?.address ?? "", first?.family ?? 4)
    })
    .catch((error: NodeJS.ErrnoException) => callback(error, "", 4))
}

type Hop =
  | { kind: "redirect"; location: string }
  | { kind: "done"; bytes: Buffer }
  | { kind: "error"; code: PhotoDownloadErrorCode }

function requestOnce(url: URL, signal: AbortSignal): Promise<Hop> {
  return new Promise((resolve) => {
    const client = url.protocol === "https:" ? https : http
    let settled = false

    const finish = (hop: Hop) => {
      if (!settled) {
        settled = true
        resolve(hop)
      }
    }

    const request = client.get(
      url,
      {
        lookup: safeLookup,
        agent: false,
        signal,
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
          "user-agent": "PlataformaImobiliaria-Importacao/1.0",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0

        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume()
          finish({ kind: "redirect", location: response.headers.location })
          return
        }

        if (status < 200 || status >= 300) {
          response.resume()
          finish({ kind: "error", code: "http_error" })
          return
        }

        const declared = Number(response.headers["content-length"])

        if (Number.isFinite(declared) && declared > PHOTO_DOWNLOAD_MAX_BYTES) {
          response.destroy()
          finish({ kind: "error", code: "too_large" })
          return
        }

        const chunks: Buffer[] = []
        let total = 0

        response.on("data", (chunk: Buffer) => {
          total += chunk.length

          if (total > PHOTO_DOWNLOAD_MAX_BYTES) {
            response.destroy()
            finish({ kind: "error", code: "too_large" })
            return
          }

          chunks.push(chunk)
        })

        response.on("end", () => finish({ kind: "done", bytes: Buffer.concat(chunks) }))
        response.on("error", () =>
          finish({ kind: "error", code: signal.aborted ? "timeout" : "download_failed" })
        )
      }
    )

    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof BlockedAddressError || error.code === "EBLOCKEDADDRESS") {
        finish({ kind: "error", code: "blocked_address" })
      } else if (signal.aborted) {
        finish({ kind: "error", code: "timeout" })
      } else {
        finish({ kind: "error", code: "download_failed" })
      }
    })
  })
}

export async function downloadPhoto(link: string): Promise<PhotoDownloadResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PHOTO_DOWNLOAD_TIMEOUT_MS)

  try {
    let current = link

    for (let hop = 0; hop <= PHOTO_DOWNLOAD_MAX_REDIRECTS; hop += 1) {
      const checked = checkPhotoUrl(current)

      if (!checked.ok) {
        return { ok: false, code: checked.code }
      }

      const result = await requestOnce(checked.url, controller.signal)

      if (result.kind === "error") {
        return { ok: false, code: result.code }
      }

      if (result.kind === "redirect") {
        try {
          current = new URL(result.location, checked.url).toString()
        } catch {
          return { ok: false, code: "invalid_link" }
        }
        continue
      }

      const type = sniffImageType(result.bytes.subarray(0, 32))

      return type ? { ok: true, bytes: result.bytes, type } : { ok: false, code: "not_image" }
    }

    return { ok: false, code: "http_error" }
  } finally {
    clearTimeout(timer)
  }
}
