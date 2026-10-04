// Comparação entre o preço ativo na Stripe e o preço declarado no catálogo do
// core (plans.ts), usada só para alerta operacional quando os dois divergem
// (ex.: alguém mudou o Price na Stripe sem atualizar PLANS). A Stripe continua
// tendo prioridade no valor exibido: isto nunca decide o que o cliente vê.

import { parseLookupKey, type BillingInterval, type PlanKey } from "./plans"

export type CatalogPriceDivergence = {
  lookupKey: string
  kind: "plan" | "seat"
  planKey: PlanKey
  interval: BillingInterval
  /** Preço declarado em packages/core/src/billing/plans.ts, em centavos. */
  corePriceCents: number
  /** Preço ativo lido da Stripe (prices.list), em centavos. */
  stripePriceCents: number
}

/**
 * Compara o preço do core com o preço da Stripe para o mesmo lookup_key.
 * Devolve a divergência quando os centavos não batem, ou `null` quando batem
 * ou quando `lookupKey` não segue o padrão `plan_*`/`seat_*` reconhecido.
 * Função pura: não loga, não lança, não acessa a Stripe.
 */
export function diffCatalogPrice(
  lookupKey: string,
  corePriceCents: number,
  stripePriceCents: number
): CatalogPriceDivergence | null {
  const parsed = parseLookupKey(lookupKey)

  if (!parsed || corePriceCents === stripePriceCents) {
    return null
  }

  return {
    lookupKey,
    kind: parsed.kind,
    planKey: parsed.plan,
    interval: parsed.interval,
    corePriceCents,
    stripePriceCents,
  }
}

/**
 * Texto do aviso para `console.warn`: só id do plano/intervalo e os dois
 * valores em centavos — nunca chave, e-mail ou dado de cliente.
 */
export function formatCatalogPriceDivergenceWarning(divergence: CatalogPriceDivergence): string {
  return (
    `[billing] preço da Stripe diverge do core em ${divergence.lookupKey} ` +
    `(${divergence.kind} ${divergence.planKey}/${divergence.interval}): ` +
    `core=${divergence.corePriceCents} stripe=${divergence.stripePriceCents}`
  )
}
