// Webhook do WhatsApp (Meta Cloud API).
//
// Rota PÚBLICA e SEM SESSÃO: `/api/webhooks` já está em WEBHOOKS_PATH_PREFIX, e
// o proxy (lib/supabase/proxy.ts) devolve a requisição sem renovar sessão, sem
// resolver imobiliária e descartando os headers internos. Não há cookie aqui.
//
// Ordem inegociável do POST:
//   1. ler o corpo BRUTO;
//   2. conferir a assinatura HMAC-SHA256 com o app secret;
//   3. só então fazer qualquer trabalho.
// O corpo é tratado como dado hostil: quem o interpreta é
// `readWhatsappWebhook`, que valida campo a campo e descarta o que não bate.
//
// Respostas:
//   - 403 na verificação (GET) com token errado;
//   - 401 assinatura inválida;
//   - 500 falha transitória (a Meta reentrega);
//   - 200 em todo o resto, inclusive evento fora de escopo e corpo sem forma —
//     reentrega eterna de um payload quebrado não ajuda ninguém.
//
// Logs sem dado pessoal: nunca número, nome ou corpo da mensagem.

import { createHash } from "node:crypto"

import {
  readWhatsappWebhook,
  whatsappWebhookEventKey,
  type WhatsappWebhookEvent,
} from "@workspace/core/whatsapp"

import {
  claimWebhookEvent,
  ConnectionRpcError,
  ingestWhatsappMessage,
  setWhatsappMarketingPreference,
  syncWhatsappChannelHealth,
  updateWhatsappMessageStatus,
} from "@/lib/conexoes/rpc"
import { readMetaAppSecret, readMetaWebhookVerifyToken } from "@/lib/conexoes/secrets"
import { verifyMetaSignature, verifyTokenMatches } from "@/lib/whatsapp/signature"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PROVIDER = "whatsapp"
const MAX_BODY_CHARS = 1_000_000

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

/**
 * Verificação do endpoint. A Meta chama com hub.mode=subscribe e espera o
 * hub.challenge cru de volta, com 200.
 */
export function GET(request: Request) {
  const expected = readMetaWebhookVerifyToken()

  if (!expected) {
    return reply(404, { error: "not_configured" })
  }

  const params = new URL(request.url).searchParams

  if (
    params.get("hub.mode") !== "subscribe" ||
    !verifyTokenMatches(params.get("hub.verify_token"), expected)
  ) {
    return reply(403, { error: "invalid_verify_token" })
  }

  const challenge = params.get("hub.challenge") ?? ""

  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  })
}

async function handleEvent(event: WhatsappWebhookEvent): Promise<void> {
  switch (event.kind) {
    case "message":
      await ingestWhatsappMessage({
        phoneNumberId: event.phoneNumberId,
        wamid: event.wamid,
        contactWaId: event.contactWaId,
        contactName: event.contactName,
        body: event.body,
        sentAt: event.sentAt,
      })
      return

    case "status":
      await updateWhatsappMessageStatus({
        phoneNumberId: event.phoneNumberId,
        wamid: event.wamid,
        status: event.status,
        errorCode: event.errorCode,
        errorTitle: event.errorTitle,
        pricingCategory: event.pricingCategory,
        pricingType: event.pricingType,
        at: event.at,
      })
      return

    case "user_preference":
      await setWhatsappMarketingPreference({
        phoneNumberId: event.phoneNumberId,
        contactWaId: event.contactWaId,
        value: event.value,
        at: event.at,
      })
      return

    case "quality":
      // Hoje este webhook fala de LIMITE DE ENVIO, não de quality_rating: a
      // documentação descreve `phone_number_quality_update` como aviso de
      // mudança de throughput. A nota de qualidade continua vindo da leitura do
      // número (fetchPhoneNumber), disparada pela tela de Conexões.
      await syncWhatsappChannelHealth({
        phoneNumberId: event.phoneNumberId,
        displayPhoneNumber: event.displayPhoneNumber,
        qualityRating: null,
        messagingTier: event.currentLimit,
        throughput: null,
      })
      return
  }
}

export async function POST(request: Request) {
  const appSecret = readMetaAppSecret()

  if (!appSecret) {
    // Sem segredo não há como distinguir a Meta de qualquer um: recusamos tudo.
    return reply(500, { error: "not_configured" })
  }

  // Corpo bruto: qualquer parse antes da verificação invalida a assinatura.
  const raw = await request.text()

  if (raw.length > MAX_BODY_CHARS) {
    console.error("[whatsapp/webhook] corpo grande demais")
    return reply(413, { error: "payload_too_large" })
  }

  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    console.error("[whatsapp/webhook] assinatura inválida")
    return reply(401, { error: "invalid_signature" })
  }

  // Daqui para baixo o corpo é genuíno — mas continua sendo dado de terceiro.
  let payload: unknown

  try {
    payload = JSON.parse(raw)
  } catch {
    console.error("[whatsapp/webhook] corpo não é JSON")
    return reply(200, { received: true, ignored: "invalid_json" })
  }

  const { events, discarded } = readWhatsappWebhook(payload)

  if (events.length === 0) {
    return reply(200, { received: true, handled: 0, discarded })
  }

  const payloadSha256 = createHash("sha256").update(raw, "utf8").digest("hex")
  let handled = 0
  let repeated = 0

  for (const event of events) {
    const eventKey = whatsappWebhookEventKey(event)

    try {
      const fresh = await claimWebhookEvent(PROVIDER, eventKey, payloadSha256)

      if (!fresh) {
        repeated += 1
        continue
      }

      await handleEvent(event)
      handled += 1
    } catch (error) {
      const code = error instanceof ConnectionRpcError ? (error.code ?? "erro") : "erro"

      // Sem configuração ou banco fora do ar é transitório: 500 para a Meta
      // reentregar. Erro de payload já foi filtrado antes daqui.
      console.error(`[whatsapp/webhook] ${event.kind} falhou (${code})`)
      return reply(500, { error: "temporary_failure" })
    }
  }

  return reply(200, { received: true, handled, repeated, discarded })
}
