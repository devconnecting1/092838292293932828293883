import { createClient } from "@supabase/supabase-js"

import { PORTAL } from "@/lib/portal/config"
import { toPortalListing } from "@/lib/portal/imoveis"
import {
  avisoDe,
  carregarCatalogo,
  Imovelweb,
  ImovelwebErro,
  imovelwebConfig,
} from "@/lib/portal/imovelweb"
import { segredoConfere, tokenPortal } from "@/lib/portal/integracao-auth"
import { siteUrl } from "@/lib/portal/site-url"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Publica no Imovelweb os anúncios pagos e aprovados para o portal "imovelweb"
 * (a mesma lista do feed, função feed_portal) e registra o callback de leads.
 *
 * Chamada: POST /api/webhooks/portal/imovelweb/sincronizar
 * Header: Authorization: Bearer <PORTAL_LEADS_TOKEN>
 * O pg_cron do banco pode chamar de hora em hora, como já faz com a importação.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null
  if (!segredoConfere(auth, tokenPortal())) return json(401, { erro: "nao_autorizado" })

  const cfg = imovelwebConfig()
  if (!cfg) return json(503, { erro: "imovelweb_nao_configurado" })
  const env = getSupabaseEnv()
  if (!env) return json(503, { erro: "banco_nao_configurado" })

  const sb = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const { data, error } = await sb.rpc("feed_portal", { p_portal: "imovelweb" })
  if (error || !Array.isArray(data)) return json(503, { erro: "feed_portal_indisponivel" })
  const imoveis = (data as Record<string, unknown>[]).map(toPortalListing)

  let api: Imovelweb
  try {
    api = await Imovelweb.conectar(cfg)
  } catch (e) {
    return json(502, {
      erro: "login_imovelweb",
      status: e instanceof ImovelwebErro ? e.status : null,
    })
  }

  const callbackSecret = process.env.IMOVELWEB_CALLBACK_SECRET?.trim()
  let callback = "sem IMOVELWEB_CALLBACK_SECRET"
  if (callbackSecret && callbackSecret.length >= 24) {
    try {
      await api.configurarCallback(
        `${siteUrl()}/api/webhooks/portal/imovelweb`,
        "X-Vamos-Arrematar",
        callbackSecret
      )
      callback = "ok"
    } catch (e) {
      callback = e instanceof ImovelwebErro ? `erro ${e.status}` : "erro"
    }
  }

  const contato = {
    email: process.env.PORTAL_FEED_EMAIL?.trim() || PORTAL.email || "",
    nome: PORTAL.name,
    telefone: PORTAL.whatsappLabel,
  }
  const cat = await carregarCatalogo(api)
  const publicados: string[] = []
  const fora: { imovel: string; motivo: string }[] = []
  for (const i of imoveis) {
    try {
      const a = await avisoDe(api, cat, i, contato)
      if (!a.ok) {
        fora.push({ imovel: i.numero, motivo: a.motivo })
        continue
      }
      await api.atualizar(i.numero, a.aviso)
      publicados.push(i.numero)
    } catch (e) {
      fora.push({
        imovel: i.numero,
        motivo: e instanceof ImovelwebErro ? `erro ${e.status}` : "erro",
      })
    }
  }
  return json(200, { total: imoveis.length, publicados, fora, callback })
}
