import { PLANOS } from "@/lib/portal/planos"
import { siteUrl } from "@/lib/portal/site-url"
import { stripePortal } from "@/lib/portal/stripe-portal"
import { usuarioDoPedido } from "@/lib/portal/usuario-api"

/** Abre o Checkout da Stripe para a assinatura escolhida. */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  const u = await usuarioDoPedido(request)
  if (!u) return json(401, { erro: "Entre na sua conta para assinar." })
  const stripe = stripePortal()
  if (!stripe)
    return json(503, { erro: "Pagamentos ainda não ativados. Fale com a gente no 0800 543 1000." })

  let corpo: { plano?: unknown; ciclo?: unknown }
  try {
    corpo = (await request.json()) as typeof corpo
  } catch {
    return json(400, { erro: "Pedido inválido." })
  }
  const plano = PLANOS.find((p) => p.id === corpo.plano)
  const anual = corpo.ciclo === "anual"
  if (!plano) return json(400, { erro: "Plano inválido." })

  const { data: user } = await u.sb.auth.getUser()
  const base = siteUrl()
  try {
    const sessao = await stripe.checkout.sessions.create({
      mode: "subscription",
      locale: "pt-BR",
      client_reference_id: u.id,
      customer_email: user.user?.email ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "brl",
            unit_amount: Math.round((anual ? plano.anual : plano.mensal) * 100),
            recurring: { interval: anual ? "year" : "month" },
            product_data: { name: `Vamos Arrematar ${plano.nome} (${anual ? "anual" : "mensal"})` },
          },
        },
      ],
      metadata: { user_id: u.id, plano: plano.id },
      subscription_data: { metadata: { user_id: u.id, plano: plano.id } },
      allow_promotion_codes: true,
      success_url: `${base}/corretores/painel?assinatura=ok`,
      cancel_url: `${base}/assinar?assinatura=cancelada`,
    })
    return json(200, { url: sessao.url })
  } catch {
    return json(502, { erro: "Não foi possível abrir o pagamento agora." })
  }
}
