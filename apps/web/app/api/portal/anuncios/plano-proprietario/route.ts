import { siteUrl } from "@/lib/portal/site-url"
import { stripePortal } from "@/lib/portal/stripe-portal"
import { usuarioDoPedido } from "@/lib/portal/usuario-api"

/**
 * Plano de anúncio do proprietário: registra o pedido no banco (preço da tabela do CEO) e abre
 * o pagamento. Sem Stripe ativa, o pedido fica registrado e a equipe combina o PIX.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const u = await usuarioDoPedido(request)
  if (!u) return json(401, { erro: "Entre na sua conta." })
  const corpo = (await request.json().catch(() => ({}))) as { avulsoId?: unknown }
  const avulso = String(corpo.avulsoId ?? "")
  if (!/^[0-9a-f-]{36}$/.test(avulso)) return json(400, { erro: "Anúncio inválido." })

  const { data, error } = await u.sb.rpc("criar_plano_avulso", { p_avulso: avulso })
  if (error || !data)
    return json(409, { erro: "Não foi possível registrar o plano para este anúncio." })
  const p = data as { id: string; codigo: string; valor: number; dias: number }

  const stripe = stripePortal()
  if (!stripe)
    return json(200, {
      registrado: true,
      codigo: p.codigo,
      aviso: `Pedido ${p.codigo} registrado. A equipe vai te enviar o PIX pelo WhatsApp; com o pagamento confirmado, o anúncio entra no site.`,
    })

  const { data: user } = await u.sb.auth.getUser()
  try {
    const s = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "pt-BR",
      client_reference_id: u.id,
      customer_email: user.user?.email ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "brl",
            unit_amount: Math.round(Number(p.valor) * 100),
            product_data: { name: `Anúncio do imóvel no site por ${p.dias} dias (${p.codigo})` },
          },
        },
      ],
      metadata: { plano_avulso_id: p.id, user_id: u.id },
      payment_intent_data: { metadata: { plano_avulso_id: p.id } },
      success_url: `${siteUrl()}/anuncie-gratis?plano=pago#meus-anuncios`,
      cancel_url: `${siteUrl()}/anuncie-gratis#meus-anuncios`,
    })
    return json(200, { url: s.url })
  } catch {
    return json(502, { erro: "Não foi possível abrir o pagamento agora." })
  }
}
