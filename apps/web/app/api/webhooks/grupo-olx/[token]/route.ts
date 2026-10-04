import {
  isCanalProListingLead,
  normalizeCanalProLead,
  toIngestLeadPayload,
} from "@workspace/core/leads/ingest"
import type { Json } from "@workspace/database/types"

import { isWebhookToken } from "@/lib/integracoes/constants"
import {
  ingestWebhookLead,
  isLeadIngestConfigured,
  LeadIngestRpcError,
} from "@/lib/integracoes/rpc"

/**
 * Recebimento de leads do Grupo OLX (ZAP Imóveis, Viva Real e OLX).
 *
 * O Canal Pro entrega por PUSH: a imobiliária cola este endereço em
 * "Integrações de anúncios > Leads > Receber leads no CRM" e o Grupo OLX passa
 * a fazer um POST por lead. Contrato:
 * developers.grupozap.com/webhooks/integration_leads.html
 *
 * SEGURANÇA: esse fluxo do Canal Pro NÃO assina a requisição e não tem token
 * deles. Quem protege é o segredo da própria URL — 24 bytes aleatórios gerados
 * no banco, um por imobiliária, no mesmo molde do `feed_token` do VRSync (e
 * trocável na hora pela tela de integrações). Por isso:
 * - token inválido, revogado ou de imobiliária desconectada devolve sempre a
 *   MESMA resposta, sem dizer se a imobiliária existe;
 * - o corpo é dado hostil: nada é lido sem conferir tipo e tamanho, e o payload
 *   cru nunca é gravado nem registrado em log;
 * - o banco corta em 240 entregas por minuto por imobiliária.
 *
 * Respostas (o Grupo OLX olha só o código HTTP, nunca o corpo):
 * - 2xx: recebido (inclusive duplicado e recusado por dados insuficientes —
 *   reenviar não resolveria);
 * - 422: lead de ANÚNCIO sem `clientListingId`. A doc deles manda devolver 4xx
 *   nesse caso para o lead ser revisado e reenviado — mas o lead é gravado
 *   ANTES, para o contato não se perder se eles nunca reenviarem. Leads
 *   `MCMV_OLX` (simulação Minha Casa Minha Vida) nunca levam 4xx por isso;
 * - 401: endereço desconhecido;
 * - 429/503: nossa falha ou limite — eles repetem até 3 vezes e guardam o lead
 *   por 14 dias.
 *
 * Idempotência: a chave é o `originLeadId`, gravado em
 * lead_integration_deliveries. Reentrega não cria um segundo lead.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** O Grupo OLX espera resposta em até 30 s; ficamos muito abaixo disso. */
export const maxDuration = 15

/** Teto do corpo aceito: um lead do Canal Pro tem alguns KB. */
const MAX_BODY_BYTES = 32_768

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Formato errado nem chega ao banco.
  if (!isWebhookToken(token)) {
    return reply(401, { error: "unknown_endpoint" })
  }

  if (!isLeadIngestConfigured()) {
    console.error("[integracoes/canal-pro] LEAD_INGEST_SERVER_KEY ou Supabase ausente")
    return reply(503, { error: "not_configured" })
  }

  const raw = await request.text()

  if (raw.length > MAX_BODY_BYTES) {
    return reply(413, { error: "payload_too_large" })
  }

  let body: unknown

  try {
    body = JSON.parse(raw)
  } catch {
    return reply(400, { error: "invalid_json" })
  }

  const normalized = normalizeCanalProLead(body, Date.now())
  const payload = normalized.ok ? toIngestLeadPayload(normalized.lead) : normalized.partial

  if (!payload) {
    // Sem `originLeadId` não há como evitar repetição: recusamos sem gravar.
    console.warn("[integracoes/canal-pro] entrega sem originLeadId descartada")
    return reply(422, { error: "missing_origin_lead_id" })
  }

  // Lead de ANÚNCIO sem o código do anúncio. A doc do Grupo OLX manda devolver
  // 4xx para o lead ser revisado e reenviado — mas nós gravamos ANTES: contato
  // perdido é o que esta entrega inteira existe para evitar, e o reenvio deles
  // é idempotente pelo `originLeadId`. Na simulação do Minha Casa Minha Vida o
  // campo não existe, e 4xx ali viraria reenvio eterno.
  const missingListing =
    normalized.ok && normalized.lead.listingCode === null && isCanalProListingLead(body)

  try {
    const outcome = await ingestWebhookLead(token, payload as unknown as Json)

    if (outcome.status === "unknown_account") {
      return reply(401, { error: "unknown_endpoint" })
    }

    if (missingListing) {
      return reply(422, { error: "missing_client_listing_id", status: outcome.status })
    }

    // Aceito, duplicado ou recusado: para o Grupo OLX a entrega chegou.
    return reply(200, { received: true, status: outcome.status })
  } catch (cause) {
    if (cause instanceof LeadIngestRpcError && cause.code === "54000") {
      return reply(429, { error: "rate_limited" })
    }

    console.error(
      `[integracoes/canal-pro] falha ao gravar a entrega (${
        cause instanceof LeadIngestRpcError ? (cause.code ?? "sem código") : "erro"
      })`
    )

    // 5xx faz o Grupo OLX repetir (3 vezes, e guarda o lead por 14 dias).
    return reply(503, { error: "retry" })
  }
}

/**
 * Alguns painéis (e a própria imobiliária, ao colar a URL) abrem o endereço no
 * navegador para conferir. Responder 405 confirma que a rota existe sem revelar
 * nada sobre o token.
 */
export function GET() {
  return reply(405, { error: "method_not_allowed" })
}
