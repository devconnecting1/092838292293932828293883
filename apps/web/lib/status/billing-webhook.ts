import "server-only"

import { createClient } from "@supabase/supabase-js"

import {
  BILLING_WEBHOOK_RULES,
  isFreshStripeSignatureHeader,
  isStripeEventType,
  type BillingWebhookOutcome,
} from "@workspace/core/status/billing-webhook"
import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Resultado de cada entrega do webhook da Stripe para a medição automática de
 * "Assinaturas e pagamentos" na página de status
 * (`record_billing_webhook_delivery`, chave publishable + BILLING_SERVER_KEY,
 * nunca service_role).
 *
 * Vai só o resultado e o tipo do evento verificado: nunca payload, assinatura,
 * ids ou valores. A rota chama depois de responder (`after`), então gravar
 * nunca atrasa nem muda a resposta à Stripe; qualquer falha aqui só vai para o
 * log. Só grava no build de produção: `next dev` usa o mesmo banco e um
 * `stripe listen` com segredo de outra sessão não pode virar instabilidade
 * pública.
 */

/** Entrega com a cara de uma entrega real da Stripe feita agora (ver core). */
export function looksLikeStripeDelivery(request: Request): boolean {
  return isFreshStripeSignatureHeader(request.headers.get("stripe-signature"), Date.now())
}

let warnedMissingKey = false
const lastProblemRecordedAt = new Map<BillingWebhookOutcome, number>()

function readBillingServerKey(): string | null {
  return process.env.BILLING_SERVER_KEY?.trim() || null
}

/**
 * Grava o resultado. Nunca lança. Falha de configuração repetida na mesma
 * instância grava no máximo uma vez a cada 10 s (o banco também segura rajada).
 */
export async function recordBillingWebhookDelivery(
  outcome: BillingWebhookOutcome,
  eventType?: string | null
): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    return
  }

  try {
    if (outcome === "config_ausente" || outcome === "assinatura_invalida") {
      const now = Date.now()
      const last = lastProblemRecordedAt.get(outcome) ?? 0

      if (now - last < BILLING_WEBHOOK_RULES.repeatedProblemSeconds * 1000) {
        return
      }

      lastProblemRecordedAt.set(outcome, now)
    } else {
      // Entrega boa ou processada: a próxima falha de configuração grava de novo.
      lastProblemRecordedAt.clear()
    }

    const env = getSupabaseEnv()
    const serverKey = readBillingServerKey()

    if (!env || !serverKey) {
      if (!warnedMissingKey) {
        warnedMissingKey = true
        console.warn(
          "[billing/webhook] BILLING_SERVER_KEY ausente: resultado das entregas fora da página de status"
        )
      }

      return
    }

    const supabase = createClient<Database>(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    const { error } = await supabase.rpc("record_billing_webhook_delivery", {
      p_server_key: serverKey,
      p_outcome: outcome,
      p_event_type:
        (outcome === "ok" || outcome === "erro_processamento") && isStripeEventType(eventType)
          ? eventType
          : undefined,
    })

    if (error) {
      console.error(
        `[billing/webhook] resultado da entrega não registrado (${error.code || "erro_rpc"})`
      )
    }
  } catch (cause) {
    console.error(
      `[billing/webhook] resultado da entrega não registrado (${cause instanceof Error ? cause.name : "erro"})`
    )
  }
}
