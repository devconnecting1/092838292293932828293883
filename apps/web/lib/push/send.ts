import "server-only"

import webpush from "web-push"

import type { VapidConfig } from "@/lib/push/config"
import type { PushDeliveryOptions, PushPayload } from "@/lib/push/messages"
import { isAllowedPushEndpoint } from "@/lib/push/subscription"

/**
 * Envio de Web Push com VAPID pela biblioteca `web-push` (web-push-libs,
 * MPL-2.0), a mesma do guia de PWA do Next.js. A mensagem vai cifrada
 * (aes128gcm) com as chaves do aparelho: o serviço de push não lê o conteúdo.
 *
 * Nada aqui lança nem registra o endpoint (é uma capacidade secreta): o
 * resultado leva só o código HTTP.
 */

export type PushTarget = {
  endpoint: string
  p256dh: string
  auth: string
}

export type PushSendResult = {
  /**
   * - delivered: o serviço de push aceitou (201);
   * - gone: inscrição expirada ou cancelada (404/410) ou endpoint fora dos
   *   serviços aceitos: remover do banco;
   * - failed: falha temporária ou de configuração (tentar de novo não repete o
   *   aviso de lead, mas o teste pode ser refeito).
   */
  status: "delivered" | "gone" | "failed"
  statusCode: number | null
}

/** Teto de espera por serviço de push: a fila de e-mail não espera o push. */
const REQUEST_TIMEOUT_MS = 8_000

export async function sendWebPush(
  target: PushTarget,
  payload: PushPayload,
  options: PushDeliveryOptions,
  vapid: VapidConfig
): Promise<PushSendResult> {
  if (!isAllowedPushEndpoint(target.endpoint)) {
    return { status: "gone", statusCode: null }
  }

  try {
    const response = await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: vapid,
        TTL: Math.max(0, Math.floor(options.ttlSeconds)),
        urgency: options.urgency,
        timeout: REQUEST_TIMEOUT_MS,
        contentEncoding: "aes128gcm",
      }
    )

    return { status: "delivered", statusCode: response.statusCode }
  } catch (error) {
    const statusCode =
      error instanceof webpush.WebPushError && Number.isInteger(error.statusCode)
        ? error.statusCode
        : null

    return { status: statusCode === 404 || statusCode === 410 ? "gone" : "failed", statusCode }
  }
}

/** Executa `task` para cada item com no máximo `limit` em paralelo. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index] as T)
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker))

  return results
}
