import { createHash, timingSafeEqual } from "node:crypto"

import { drainPendingDeliveries } from "@/lib/integracoes/deliveries"
import { isLeadIngestConfigured } from "@/lib/integracoes/rpc"

/**
 * Rede de segurança da entrada de leads externos.
 *
 * O caminho normal é síncrono: o Canal Pro manda o lead inteiro no POST, e o
 * webhook da Meta busca os dados no Graph API logo depois de responder 200.
 * Esta rota existe para o que falhou: entrega da Meta cujo Graph API não
 * respondeu, ou que ficou pendente porque o processo caiu entre a resposta e a
 * busca. Cada entrega tem 6 tentativas com espera crescente; depois disso fica
 * registrada como recusada, com o motivo visível em /configuracoes/integracoes.
 *
 * Quem chama: o pg_cron do banco a cada 5 min, só quando há entrega vencida
 * (private.ping_lead_ingest_webhook, com os segredos lead_ingest_webhook_url e
 * lead_ingest_webhook_secret no Vault), e a rotina diária da Vercel
 * (vercel.json) como última rede — o plano Hobby não agenda em minutos. Sem os
 * segredos, uma entrega que falhou pode levar até 24 h para entrar.
 *
 * Autorização: `Authorization: Bearer ${CRON_SECRET}` (comparação em tempo
 * constante), igual às outras rotas agendadas. Resposta e logs só com
 * contagens — nenhum dado de lead.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Entregas por execução: cada uma é uma ida ao Graph API. */
const BATCH_SIZE = 25

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

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) {
    console.error("CRON_SECRET ausente")
    return reply(500, { error: "not_configured" })
  }

  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return reply(401, { error: "unauthorized" })
  }

  if (!isLeadIngestConfigured()) {
    // Não é erro de servidor: a entrada simplesmente não está configurada.
    return reply(200, { ok: false, skipped: "sem_chave_do_servidor" })
  }

  const summary = await drainPendingDeliveries(BATCH_SIZE)

  if (summary.failed > 0) {
    console.error(
      `[integracoes/cron] ${summary.claimed} entrega(s): ${summary.accepted} no funil, ` +
        `${summary.duplicate} duplicada(s), ${summary.rejected} recusada(s), ${summary.failed} ainda na fila`
    )
  } else if (summary.claimed > 0) {
    console.info(
      `[integracoes/cron] ${summary.claimed} entrega(s): ${summary.accepted} no funil, ` +
        `${summary.duplicate} duplicada(s), ${summary.rejected} recusada(s)`
    )
  }

  return reply(200, { ok: true, ...summary })
}

export async function GET(request: Request) {
  return handle(request)
}

/** POST para chamar manualmente em desenvolvimento, com o mesmo segredo. */
export async function POST(request: Request) {
  return handle(request)
}
