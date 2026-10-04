import { createBrevoProvider } from "@/lib/email/brevo"
import { readEmailConfig } from "@/lib/email/config"
import { PORTAL } from "@/lib/portal/config"
import { siteUrl } from "@/lib/portal/site-url"
import { usuarioDoPedido } from "@/lib/portal/usuario-api"

/**
 * Envia por e-mail ao cliente a resposta da equipe num chamado e marca a
 * mensagem como enviada (fica no histórico e na auditoria).
 * POST { mensagemId }
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  )

export async function POST(request: Request) {
  const u = await usuarioDoPedido(request)
  if (!u || (u.perfil !== "admin" && u.perfil !== "atendente"))
    return json(403, { erro: "Sem permissão." })
  const corpo = (await request.json().catch(() => ({}))) as { mensagemId?: unknown }
  const id = Number(corpo.mensagemId)
  if (!Number.isInteger(id)) return json(400, { erro: "Mensagem inválida." })

  const { data: m } = await u.sb
    .from("chamado_mensagens")
    .select(
      "id, texto, interna, chamado_id, chamados(protocolo, assunto, cliente_id, cliente_contato, cliente_nome)"
    )
    .eq("id", id)
    .maybeSingle()
  const msg = m as {
    texto: string
    interna: boolean
    chamados: {
      protocolo: string
      assunto: string
      cliente_id: string | null
      cliente_contato: string | null
      cliente_nome: string
    } | null
  } | null
  if (!msg?.chamados || msg.interna) return json(404, { erro: "Mensagem não encontrada." })

  let email = /\S+@\S+\.\S+/.test(msg.chamados.cliente_contato ?? "")
    ? msg.chamados.cliente_contato
    : null
  if (!email && msg.chamados.cliente_id) {
    const { data: p } = await u.sb.rpc("equipe_clientes", { p_tipo: null, p_busca: null })
    email =
      ((p ?? []) as { user_id: string; email: string | null }[]).find(
        (x) => x.user_id === msg.chamados?.cliente_id
      )?.email ?? null
  }
  if (!email) return json(400, { erro: "O cliente não tem e-mail cadastrado." })

  const cfg = readEmailConfig()
  if (!cfg.apiKey || !cfg.sender)
    return json(503, { erro: "Envio de e-mail ainda não configurado." })
  const provedor = createBrevoProvider({
    apiKey: cfg.apiKey,
    sender: cfg.sender,
    replyTo: cfg.replyTo,
  })
  const c = msg.chamados
  const r = await provedor.send({
    to: { email, name: c.cliente_nome },
    subject: `[${c.protocolo}] ${c.assunto}`,
    text: `${msg.texto}\n\nChamado ${c.protocolo}. Responda pelo site: ${siteUrl()}/suporte\n${PORTAL.name} · ${PORTAL.whatsappLabel}`,
    html: `<p>${esc(msg.texto).replace(/\n/g, "<br>")}</p><p style="color:#64748b;font-size:13px">Chamado <b>${esc(c.protocolo)}</b>. Para responder, acesse <a href="${siteUrl()}/suporte">${siteUrl()}/suporte</a>.<br>${esc(PORTAL.name)} · ${esc(PORTAL.whatsappLabel)}</p>`,
    tags: ["chamado"],
  })
  if (!r.ok) return json(502, { erro: "O e-mail não saiu agora. Tente de novo." })
  await u.sb.from("chamado_mensagens").update({ email_enviado: true }).eq("id", id)
  return json(200, { ok: true })
}
