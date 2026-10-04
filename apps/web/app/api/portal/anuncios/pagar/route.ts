import { siteUrl } from "@/lib/portal/site-url"
import { stripePortal } from "@/lib/portal/stripe-portal"
import { usuarioDoPedido } from "@/lib/portal/usuario-api"

/** Link de pagamento (Stripe Checkout) de um pedido de publicidade do próprio corretor. */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const u = await usuarioDoPedido(request)
  if (!u) return json(401, { erro: "Entre na sua conta." })
  const stripe = stripePortal()
  if (!stripe)
    return json(503, {
      erro: "Pagamento on-line ainda não ativado. Fale com a gente no 0800 543 1000.",
    })
  const corpo = (await request.json().catch(() => ({}))) as { pedidoId?: unknown }
  const id = String(corpo.pedidoId ?? "")
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(400, { erro: "Pedido inválido." })

  const { data } = await u.sb
    .from("anuncio_pedidos")
    .select("id, codigo, valor, status, imoveis, dias, user_id, email")
    .eq("id", id)
    .maybeSingle()
  const p = data as {
    id: string
    codigo: string
    valor: number | null
    status: string
    imoveis: string[]
    dias: number
    user_id: string
    email: string | null
  } | null
  if (!p || p.user_id !== u.id) return json(404, { erro: "Pedido não encontrado." })
  if (p.status !== "aguardando_pagamento")
    return json(409, { erro: "Este pedido não está aguardando pagamento." })
  if (!p.valor || p.valor <= 0)
    return json(409, { erro: "Pedido sem valor definido. A equipe vai entrar em contato." })

  try {
    const s = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "pt-BR",
      client_reference_id: u.id,
      customer_email: p.email ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "brl",
            unit_amount: Math.round(Number(p.valor) * 100),
            product_data: {
              name: `Publicidade ${p.codigo}: ${p.imoveis.length} imóve${p.imoveis.length === 1 ? "l" : "is"} por ${p.dias} dias`,
            },
          },
        },
      ],
      metadata: { pedido_id: p.id, user_id: u.id },
      payment_intent_data: { metadata: { pedido_id: p.id } },
      success_url: `${siteUrl()}/corretores/painel?publicidade=paga#publicidade`,
      cancel_url: `${siteUrl()}/corretores/painel#publicidade`,
    })
    return json(200, { url: s.url })
  } catch {
    return json(502, { erro: "Não foi possível abrir o pagamento agora." })
  }
}
