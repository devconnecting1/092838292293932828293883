import { createHash, timingSafeEqual } from "node:crypto"

import { runStatusAlerts } from "@/lib/status/alerts"

/**
 * Envia o aviso por e-mail aos Donos (PLATFORM_ADMIN_EMAILS) quando a página de
 * status abre um incidente automático com impacto grande ou crítico e quando
 * ele se resolve sozinho.
 *
 * Só POST: quem chama é o banco, por webhook (pg_net), quando há aviso na fila
 * (`private.ping_status_alerts_webhook`, no máximo a cada 10 min e nunca com a
 * trava de 10 e-mails em 24 h cheia). Não há rotina da Vercel para esta rota.
 * Segredos no Vault: `status_alerts_webhook_url` (esta URL) e
 * `status_alerts_webhook_secret` (mesmo valor de CRON_SECRET).
 *
 * Autorização: `Authorization: Bearer ${CRON_SECRET}` (comparação em tempo
 * constante). Resposta e logs só com contagens.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest()
}

/** Compara os hashes (mesmo tamanho) para não vazar o segredo pelo tempo de resposta. */
function isAuthorized(header: string | null, secret: string) {
  return timingSafeEqual(sha256(header ?? ""), sha256(`Bearer ${secret}`))
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) {
    console.error("CRON_SECRET ausente")
    return reply(500, { error: "not_configured" })
  }

  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return reply(401, { error: "unauthorized" })
  }

  const summary = await runStatusAlerts()
  const log = `[status/avisos] ${summary.status}: ${summary.sent}/${summary.claimed} aviso(s) enviado(s), ${summary.emailsSent} e-mail(s), ${summary.failed} devolvido(s), ${summary.released} não tentado(s)${summary.halted ? " (envio interrompido: configuração ou cota)" : ""}`

  if (summary.status !== "concluido" || summary.failed > 0 || summary.halted) {
    console.error(log)
  } else {
    console.info(log)
  }

  return reply(summary.status === "falhou" ? 500 : 200, {
    ok: summary.status !== "falhou",
    ...summary,
  })
}
