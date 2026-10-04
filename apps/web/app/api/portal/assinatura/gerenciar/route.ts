import { siteUrl } from "@/lib/portal/site-url"
import { stripePortal } from "@/lib/portal/stripe-portal"
import { usuarioDoPedido } from "@/lib/portal/usuario-api"

/** Abre o portal da Stripe para o assinante trocar cartão, plano ou cancelar. */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const u = await usuarioDoPedido(request)
  const stripe = stripePortal()
  if (!u || !stripe) return Response.json({ erro: "Indisponível." }, { status: 401 })
  const { data } = await u.sb
    .from("perfis")
    .select("stripe_cliente")
    .eq("user_id", u.id)
    .maybeSingle()
  const cliente = (data as { stripe_cliente?: string } | null)?.stripe_cliente
  if (!cliente) return Response.json({ erro: "Você ainda não tem assinatura." }, { status: 404 })
  try {
    const s = await stripe.billingPortal.sessions.create({
      customer: cliente,
      return_url: `${siteUrl()}/corretores/painel`,
    })
    return Response.json({ url: s.url })
  } catch {
    return Response.json({ erro: "Não foi possível abrir agora." }, { status: 502 })
  }
}
