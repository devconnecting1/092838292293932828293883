import { createClient } from "@supabase/supabase-js"
import type Stripe from "stripe"

import { stripePortal } from "@/lib/portal/stripe-portal"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Webhook da Stripe das assinaturas do portal. Mantém perfis.plano e
 * perfis.plano_ate em dia, sem ninguém mexer: pagou, libera; cancelou ou não
 * pagou, o plano vence sozinho na data.
 * Eventos: checkout.session.completed, customer.subscription.created/updated/deleted.
 * Env: PORTAL_STRIPE_WEBHOOK_SECRET e PORTAL_BILLING_TOKEN (igual ao
 * config_privado.billing_token do banco).
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const r = (status: number) => new Response(null, { status })

async function definir(sub: Stripe.Subscription) {
  const env = getSupabaseEnv()
  const token = process.env.PORTAL_BILLING_TOKEN?.trim()
  if (!env || !token) return false
  const user = sub.metadata?.user_id
  const plano = sub.metadata?.plano
  if (!user || !plano) return true
  const ativo = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due"
  const fim = sub.items.data[0]?.current_period_end ?? null
  const ate =
    ativo && fim ? new Date((fim + 3 * 86400) * 1000).toISOString() : new Date().toISOString()
  const sb = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const { error } = await sb.rpc("definir_plano", {
    p_token: token,
    p_user: user,
    p_plano: plano,
    p_ate: ate,
    p_cliente: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    p_assinatura: sub.id,
  })
  if (error) console.error(`[portal/stripe] definir_plano falhou (${error.code ?? "?"})`)
  return !error
}

async function marcarPago(pedido: string, ref: string) {
  const env = getSupabaseEnv()
  const token = process.env.PORTAL_BILLING_TOKEN?.trim()
  if (!env || !token) return false
  const sb = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const { error } = await sb.rpc("marcar_pedido_pago", {
    p_token: token,
    p_pedido: pedido,
    p_ref: ref,
  })
  if (error) console.error(`[portal/stripe] marcar_pedido_pago falhou (${error.code ?? "?"})`)
  return !error
}

export async function POST(request: Request) {
  const stripe = stripePortal()
  const segredo = process.env.PORTAL_STRIPE_WEBHOOK_SECRET?.trim()
  const assinatura = request.headers.get("stripe-signature")
  if (!stripe || !segredo || !assinatura) return r(400)
  let evento: Stripe.Event
  try {
    evento = stripe.webhooks.constructEvent(await request.text(), assinatura, segredo)
  } catch {
    return r(400)
  }
  let ok = true
  if (evento.type === "checkout.session.completed" && evento.data.object.mode === "payment") {
    const s = evento.data.object
    const pedido = s.metadata?.pedido_id
    if (pedido && s.payment_status === "paid") ok = await marcarPago(pedido, s.id)
  } else if (evento.type === "checkout.session.completed") {
    const s = evento.data.object
    if (s.mode === "subscription" && s.subscription) {
      const id = typeof s.subscription === "string" ? s.subscription : s.subscription.id
      ok = await definir(await stripe.subscriptions.retrieve(id))
    }
  } else if (evento.type.startsWith("customer.subscription.")) {
    ok = await definir(evento.data.object as Stripe.Subscription)
  }
  return r(ok ? 200 : 500)
}
