import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

/**
 * Autorização das rotas de cron dos lembretes: `Authorization: Bearer
 * ${CRON_SECRET}` (Vercel Cron manda assim; o webhook do banco também),
 * comparada em tempo constante. Respostas nunca vão para cache.
 */

export function cronReply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest()
}

/** null = autorizado; senão, a resposta de erro pronta. */
export function checkCronAuthorization(request: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) {
    console.error("CRON_SECRET ausente")
    return cronReply(500, { error: "not_configured" })
  }

  const header = request.headers.get("authorization")

  // Hashes do mesmo tamanho: não vaza o segredo pelo tempo de resposta.
  if (!timingSafeEqual(sha256(header ?? ""), sha256(`Bearer ${secret}`))) {
    return cronReply(401, { error: "unauthorized" })
  }

  return null
}
