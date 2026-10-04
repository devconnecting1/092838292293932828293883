import { after, type NextRequest } from "next/server"

import { parseMetaLeadgenEvents } from "@workspace/core/leads/ingest"

import { processMetaDelivery } from "@/lib/integracoes/deliveries"
import { isSignatureValid, isVerifyTokenValid, readAppSecret } from "@/lib/integracoes/meta"
import { isLeadIngestConfigured, registerLeadDelivery } from "@/lib/integracoes/rpc"

/**
 * Webhook de Lead Ads da Meta (formulários de anúncio do Facebook e do
 * Instagram). Endereço único, cadastrado uma vez no NOSSO app; cada imobiliária
 * conecta a Página DELA e o evento é roteado pelo `page_id`.
 *
 * GET  = handshake de verificação do endpoint: confere `hub.verify_token` e
 *        devolve `hub.challenge` em texto puro.
 * POST = evento. A Meta assina o corpo com o App Secret em
 *        `X-Hub-Signature-256` (`sha256=<hex>`); a conferência é feita sobre o
 *        CORPO CRU, antes de qualquer parse — a Meta assina o JSON dela com
 *        escapes unicode, então `JSON.parse` + `JSON.stringify` mudaria os
 *        bytes e a assinatura não bateria.
 *
 * O evento traz só o ID do lead. A Meta espera resposta em poucos segundos e
 * reenvia por até 36 h, então: gravamos a entrega como pendente, respondemos
 * 200 e buscamos os dados no Graph API depois da resposta (`after`). Se isso
 * falhar, /api/cron/lead-ingest tenta de novo (pg_cron a cada 5 min com os
 * segredos lead_ingest_webhook_* no Vault; senão, 1 vez por dia). A idempotência é o
 * `leadgen_id` em lead_integration_deliveries.
 *
 * Nada de segredo ou dado pessoal em log.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

/** Teto do corpo aceito: um lote de eventos da Meta tem poucos KB. */
const MAX_BODY_BYTES = 128_000

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

/** Handshake: a Meta exige o `hub.challenge` puro no corpo, com 200. */
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const mode = params.get("hub.mode")
  const challenge = params.get("hub.challenge")

  if (mode !== "subscribe" || !challenge || !isVerifyTokenValid(params.get("hub.verify_token"))) {
    return reply(403, { error: "forbidden" })
  }

  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  })
}

export async function POST(request: Request) {
  if (!readAppSecret()) {
    console.error("[integracoes/meta] META_APP_SECRET ausente")
    return reply(503, { error: "not_configured" })
  }

  // Corpo cru: qualquer parse antes da verificação invalida a assinatura.
  const raw = await request.text()

  if (raw.length > MAX_BODY_BYTES) {
    return reply(413, { error: "payload_too_large" })
  }

  if (!isSignatureValid(raw, request.headers.get("x-hub-signature-256"))) {
    return reply(401, { error: "invalid_signature" })
  }

  if (!isLeadIngestConfigured()) {
    console.error("[integracoes/meta] LEAD_INGEST_SERVER_KEY ou Supabase ausente")
    // 5xx: a Meta reenvia por até 36 h, então nada se perde.
    return reply(503, { error: "not_configured" })
  }

  let body: unknown

  try {
    body = JSON.parse(raw)
  } catch {
    // Assinatura válida com corpo inválido não se repete: 200 encerra o assunto.
    return reply(200, { received: true })
  }

  const events = parseMetaLeadgenEvents(body, Date.now())

  if (events.length === 0) {
    return reply(200, { received: true })
  }

  const pending: { organizationId: string; event: (typeof events)[number] }[] = []
  let unknownAccounts = 0

  for (const event of events) {
    try {
      const registered = await registerLeadDelivery({
        provider: "meta_lead_ads",
        accountId: event.pageId,
        eventId: event.leadgenId,
        occurredAt: event.createdAt,
        origin: "facebook",
      })

      if (registered.status === "unknown_account" || !registered.organizationId) {
        // Página que ninguém conectou aqui: não há imobiliária a quem mostrar.
        unknownAccounts += 1
        continue
      }

      // Entrega já concluída antes (a Meta reenvia): nada a refazer.
      if (registered.known && registered.status !== "pending" && registered.status !== "failed") {
        continue
      }

      pending.push({ organizationId: registered.organizationId, event })
    } catch (cause) {
      console.error(
        `[integracoes/meta] entrega não registrada (${cause instanceof Error ? cause.name : "erro"})`
      )
      // 5xx para a Meta reenviar o lote inteiro (tudo é idempotente).
      return reply(503, { error: "retry" })
    }
  }

  if (unknownAccounts > 0) {
    console.warn(`[integracoes/meta] ${unknownAccounts} evento(s) de página não conectada`)
  }

  // Busca dos dados depois da resposta: a Meta desiste em poucos segundos.
  if (pending.length > 0) {
    after(async () => {
      for (const item of pending) {
        try {
          await processMetaDelivery(item)
        } catch (cause) {
          console.error(
            `[integracoes/meta] entrega não processada (${cause instanceof Error ? cause.name : "erro"})`
          )
        }
      }
    })
  }

  return reply(200, { received: true })
}
