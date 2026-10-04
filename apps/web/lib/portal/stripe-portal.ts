import "server-only"

import Stripe from "stripe"

import { STRIPE_API_VERSION } from "@/lib/billing/stripe"

/**
 * Stripe das assinaturas do portal. Usa PORTAL_STRIPE_SECRET_KEY (ou a
 * STRIPE_SECRET_KEY do CRM, se for a mesma conta). Sem chave, fica desligado.
 */
let cache: Stripe | null = null

export function stripePortal(): Stripe | null {
  const key = (process.env.PORTAL_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || "").trim()
  if (!/^(sk|rk)_(test|live)_\S+$/.test(key)) return null
  cache ??= new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: { name: "vamos-arrematar" },
  })
  return cache
}
