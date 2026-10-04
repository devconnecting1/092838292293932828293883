import { createClient } from "@supabase/supabase-js"

import { createBrevoProvider } from "@/lib/email/brevo"
import { readEmailConfig } from "@/lib/email/config"
import { segredoConfere } from "@/lib/portal/integracao-auth"
import { PORTAL } from "@/lib/portal/config"
import { siteUrl } from "@/lib/portal/site-url"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Envia por e-mail os avisos do portal (renovação de publicidade e outros) que o banco
 * gerou. Roda pelo cron da Vercel (Authorization: Bearer CRON_SECRET).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  )

export async function GET(request: Request) {
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null
  if (
    !segredoConfere(auth, process.env.CRON_SECRET) &&
    !segredoConfere(auth, process.env.PORTAL_BILLING_TOKEN)
  )
    return new Response(null, { status: 401 })
  const env = getSupabaseEnv()
  const token = process.env.PORTAL_BILLING_TOKEN?.trim()
  const cfg = readEmailConfig()
  if (!env || !token || !cfg.apiKey || !cfg.sender)
    return Response.json({ enviados: 0, motivo: "nao_configurado" })
  const sb = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const { data, error } = await sb.rpc("notificacoes_pendentes", { p_token: token })
  if (error) return Response.json({ enviados: 0, motivo: "banco" }, { status: 503 })
  const provedor = createBrevoProvider({
    apiKey: cfg.apiKey,
    sender: cfg.sender,
    replyTo: cfg.replyTo,
  })
  let enviados = 0
  for (const n of (data ?? []) as {
    id: number
    email: string
    nome: string | null
    titulo: string
    texto: string
    link: string | null
  }[]) {
    const link = n.link ? `${siteUrl()}${n.link}` : siteUrl()
    const r = await provedor.send({
      to: { email: n.email, name: n.nome },
      subject: n.titulo,
      text: `${n.texto}\n\nResponda no seu painel: ${link}\n${PORTAL.name} · ${PORTAL.whatsappLabel}`,
      html: `<p>${esc(n.texto)}</p><p><a href="${link}">Responder no meu painel</a></p><p style="color:#64748b;font-size:13px">${esc(PORTAL.name)} · ${esc(PORTAL.whatsappLabel)}</p>`,
      tags: ["portal-aviso"],
    })
    if (r.ok) {
      await sb.rpc("notificacao_enviada", { p_token: token, p_id: n.id })
      enviados++
    }
  }
  return Response.json({ enviados })
}
