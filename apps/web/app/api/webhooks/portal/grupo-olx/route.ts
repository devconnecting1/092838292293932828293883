import { normalizeCanalProLead } from "@workspace/core/leads/ingest"

import { gravarLeadPortal } from "@/lib/portal/leads-portais"
import { segredoConfere, senhaBasic, tokenPortal } from "@/lib/portal/integracao-auth"

/**
 * Leads do Grupo OLX (ZAP Imóveis, Viva Real e OLX) para o Vamos Arrematar.
 * Contrato: developers.grupozap.com/webhooks/integration_leads.html
 *
 * Aceita dois jeitos de autenticar:
 * - integrador credenciado: Basic usuario:SECRET_KEY, com GRUPO_OLX_SECRET_KEY;
 * - URL colada no Canal Pro: ?token=<PORTAL_LEADS_TOKEN>.
 *
 * O Grupo OLX só olha o código HTTP: 2xx recebido; qualquer outro faz ele
 * tentar de novo (até 3 vezes). Por isso só devolvemos 5xx quando a gravação
 * falha de fato.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 15

const MAX = 32_768
const r = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const url = new URL(request.url)
  const autorizado =
    segredoConfere(
      senhaBasic(request.headers.get("authorization")),
      process.env.GRUPO_OLX_SECRET_KEY
    ) || segredoConfere(url.searchParams.get("token"), tokenPortal())
  if (!autorizado) return r(401)

  const raw = await request.text()
  if (raw.length > MAX) return r(413)
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return r(400)
  }

  const n = normalizeCanalProLead(body, Date.now())
  if (!n.ok) {
    console.warn(`[grupo-olx/portal] lead recusado: ${n.reason}`)
    // Reenviar não muda o conteúdo: confirmamos para não entrar em repetição.
    return r(200)
  }
  const b = body as Record<string, unknown>
  const extra = (b.extraData ?? {}) as Record<string, unknown>
  const mensagem = [
    `[${n.lead.origin}] lead ${n.lead.eventId}`,
    typeof b.temperature === "string" ? `temperatura ${b.temperature}` : null,
    typeof extra.leadType === "string" ? `canal ${extra.leadType}` : null,
    n.lead.message,
  ]
    .filter(Boolean)
    .join(" · ")

  const ok = await gravarLeadPortal({
    imovelId: n.lead.listingCode,
    nome: n.lead.name,
    telefone: n.lead.phone,
    email: n.lead.email,
    mensagem,
    origem: "grupo-olx",
  })
  return r(ok ? 200 : 503)
}

export function GET() {
  return r(405)
}
