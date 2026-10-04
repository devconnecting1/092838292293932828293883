"use client"

import * as React from "react"

import type { BillingInterval, PlanKey } from "@workspace/core/billing"

import type { CatalogPrices } from "@/components/billing/plan-content"
import { PlanChangeDialog } from "@/components/billing/plan-change-dialog"
import { currentPaidPlan, type PricingAccount } from "@/components/billing/pricing-account"

type PricingContextValue = {
  prices: CatalogPrices
  /** null na versão de visitante. */
  account: PricingAccount | null
  interval: BillingInterval
  setBillingInterval: (interval: BillingInterval) => void
  /** Abre a confirmação de assinatura ou troca para o plano. */
  choosePlan: (plan: PlanKey) => void
}

type DialogState = { plan: PlanKey; open: boolean; attempt: number }

const PricingContext = React.createContext<PricingContextValue | null>(null)

/** Período escolhido e ações de plano compartilhados entre cartões, recomendador e tabela. */
export function usePricing() {
  const context = React.useContext(PricingContext)

  if (!context) {
    throw new Error("usePricing precisa estar dentro de PricingProvider.")
  }

  return context
}

/** Igual a usePricing, mas devolve null fora do provider. */
export function useOptionalPricing() {
  return React.useContext(PricingContext)
}

export function PricingProvider({
  prices,
  account,
  children,
}: {
  prices: CatalogPrices
  account: PricingAccount | null
  children: React.ReactNode
}) {
  const billing = account?.billing ?? null
  // Quem já assina começa no período que paga: o botão do plano atual faz sentido de cara.
  const [interval, setBillingInterval] = React.useState<BillingInterval>(
    currentPaidPlan(billing) && billing?.interval ? billing.interval : "month"
  )
  const [dialog, setDialog] = React.useState<DialogState | null>(null)

  const choosePlan = React.useCallback((plan: PlanKey) => {
    setDialog((previous) => ({ plan, open: true, attempt: (previous?.attempt ?? 0) + 1 }))
  }, [])

  const value = React.useMemo<PricingContextValue>(
    () => ({ prices, account, interval, setBillingInterval, choosePlan }),
    [prices, account, interval, choosePlan]
  )

  return (
    <PricingContext.Provider value={value}>
      {children}
      {account && billing && dialog ? (
        <PlanChangeDialog
          // Cada abertura começa do zero (usuários extras e erro da tentativa anterior).
          key={dialog.attempt}
          open={dialog.open}
          plan={dialog.plan}
          initialInterval={interval}
          prices={prices}
          account={account}
          billing={billing}
          onOpenChange={(open) => setDialog((current) => (current ? { ...current, open } : null))}
        />
      ) : null}
    </PricingContext.Provider>
  )
}
