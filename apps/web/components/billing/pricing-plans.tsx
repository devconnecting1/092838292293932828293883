"use client"

import { PLAN_KEYS } from "@workspace/core/billing"

import { BillingIntervalToggle } from "@/components/billing/billing-interval-toggle"
import { PlanActionButton } from "@/components/billing/plan-action-button"
import { PlanCard } from "@/components/billing/plan-card"
import {
  ANNUAL_RULE_SENTENCE,
  annualSavingsRange,
  formatAnnualSavingsRange,
  planAnnualSavings,
  resolvePlanPricing,
} from "@/components/billing/plan-content"
import { currentPaidPlan } from "@/components/billing/pricing-account"
import { usePricing } from "@/components/billing/pricing-provider"

/** Alternância Mensal/Anual, com a economia do anual e o que cada período significa. */
export function PricingIntervalSwitch() {
  const { prices, interval, setBillingInterval } = usePricing()
  // Faixa de economia entre o menor e o maior plano, com os preços que a página
  // está mostrando (Stripe quando houver, senão o catálogo do core).
  const range = annualSavingsRange(
    PLAN_KEYS.map((plan) => ({ plan, savings: planAnnualSavings(prices, plan) }))
  )
  const savings = range ? formatAnnualSavingsRange(range) : null
  const varies = range ? range.min.savings.savings !== range.max.savings.savings : false

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <BillingIntervalToggle value={interval} onValueChange={setBillingInterval} size="lg" />
      <p className="text-sm text-balance text-muted-foreground" aria-live="polite">
        {interval === "year"
          ? `No anual ${ANNUAL_RULE_SENTENCE}, à vista.`
          : "Mensal, sem fidelidade. Cancele quando quiser."}
        {savings ? ` Economia de ${savings} por ano${varies ? ", conforme o plano" : ""}.` : null}
      </p>
    </div>
  )
}

/** Os 4 cartões lado a lado (empilhados no celular), com o botão certo para cada conta. */
export function PricingPlans() {
  const { prices, account, interval } = usePricing()
  const current = currentPaidPlan(account?.billing ?? null)

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PLAN_KEYS.map((plan) => (
        <PlanCard
          key={plan}
          plan={plan}
          interval={interval}
          pricing={resolvePlanPricing(prices, plan, interval)}
          savings={planAnnualSavings(prices, plan)}
          current={plan === current}
          action={<PlanActionButton plan={plan} className="w-full" />}
        />
      ))}
    </div>
  )
}
