import "server-only"

import Stripe from "stripe"

/**
 * Cliente único da Stripe (Checkout hospedado + Customer Portal). Sem
 * STRIPE_SECRET_KEY o módulo fica "não configurado": as actions devolvem erro
 * amigável e as consultas devolvem vazio ou o catálogo do core, sem lançar.
 * A chave nunca é registrada em log nem enviada ao navegador.
 */

/**
 * Versão da API fixada: a mesma do SDK instalado (stripe@22.6.2). Ao atualizar
 * o pacote, revise o changelog da Stripe e troque aqui (o TypeScript acusa a
 * diferença, porque o SDK só aceita a versão dele).
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia"

const APP_INFO = { name: "plataforma-imobiliaria-crm", version: "0.0.1" }

/** Restricted key (rk_) é a recomendada; a secret key (sk_) também é aceita. */
const SECRET_KEY_PATTERN = /^(sk|rk)_(test|live)_\S+$/

export type StripeErrorInstance = InstanceType<typeof Stripe.errors.StripeError>

let client: { key: string; stripe: Stripe } | null = null
let warnedInvalidKey = false

function readSecretKey(): string | null {
  const value = process.env.STRIPE_SECRET_KEY?.trim()

  if (!value) {
    return null
  }

  if (!SECRET_KEY_PATTERN.test(value)) {
    if (!warnedInvalidKey) {
      console.warn(
        "[billing] STRIPE_SECRET_KEY em formato inesperado: pagamentos desativados (use rk_test_, veja .env.example)"
      )
      warnedInvalidKey = true
    }

    return null
  }

  return value
}

export function isStripeConfigured(): boolean {
  return readSecretKey() !== null
}

/** "test" ou "live" pelo prefixo da chave; null sem chave. */
export function getStripeMode(): "test" | "live" | null {
  const key = readSecretKey()

  if (!key) {
    return null
  }

  return key.includes("_live_") ? "live" : "test"
}

/** Cliente da Stripe reaproveitado entre requisições; null sem chave. */
export function getStripe(): Stripe | null {
  const key = readSecretKey()

  if (!key) {
    return null
  }

  if (client?.key !== key) {
    client = {
      key,
      stripe: new Stripe(key, {
        apiVersion: STRIPE_API_VERSION,
        appInfo: APP_INFO,
        maxNetworkRetries: 2,
        timeout: 20_000,
      }),
    }
  }

  return client.stripe
}

/** Segredo de assinatura do endpoint de webhook (whsec_...); null se ausente. */
export function readWebhookSecret(): string | null {
  const value = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  return value?.startsWith("whsec_") ? value : null
}

export function isStripeError(error: unknown): error is StripeErrorInstance {
  return error instanceof Stripe.errors.StripeError
}

/** Falhas que valem nova tentativa: rede, erro da Stripe (5xx) ou limite de taxa. */
export function isTransientStripeError(error: unknown): boolean {
  if (!isStripeError(error)) {
    return false
  }

  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError
  ) {
    return true
  }

  const status = error.statusCode ?? 0
  return status >= 500 || status === 429 || error.code === "lock_timeout"
}

/** Objeto inexistente na Stripe (id apagado ou de outra conta/modo). */
export function isStripeResourceMissing(error: unknown): boolean {
  return isStripeError(error) && (error.code === "resource_missing" || error.statusCode === 404)
}
