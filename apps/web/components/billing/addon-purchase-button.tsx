"use client"

import Link from "next/link"

import { OWNED_LISTINGS_ADDON_KEY } from "@workspace/core/billing"
import { Button } from "@workspace/ui/components/button"

import { signUpHref } from "@/components/billing/plan-content"
import { blockedActionReason, currentPaidPlan } from "@/components/billing/pricing-account"
import { useOptionalPricing } from "@/components/billing/pricing-provider"

/**
 * Ação do adicional contratável em /planos (hoje, só os pacotes de +10 imóveis):
 * - quem assina e pode alterar: abre a confirmação do plano atual com os pacotes;
 * - sem assinatura: escolhe os pacotes junto com o plano, no botão Assinar;
 * - visitante: o adicional é contratado depois do teste, junto com o plano.
 */
export function AddonPurchaseButton({ addonKey }: { addonKey: string }) {
  const pricing = useOptionalPricing()

  if (addonKey !== OWNED_LISTINGS_ADDON_KEY) {
    return null
  }

  const account = pricing?.account ?? null

  if (!account) {
    return (
      <p className="text-sm text-muted-foreground">
        Contrate junto com o plano, ao assinar.{" "}
        <Link href={signUpHref("corretor")} className="underline underline-offset-4">
          Começar teste grátis
        </Link>
      </p>
    )
  }

  const billing = account.billing
  const current = currentPaidPlan(billing)

  if (!billing || billing.platformBlocked) {
    return null
  }

  if (!current) {
    return (
      <p className="text-sm text-muted-foreground">
        Escolha os pacotes junto com o plano, no botão Assinar.
      </p>
    )
  }

  const reason = blockedActionReason(account)

  if (reason) {
    return <p className="text-sm text-muted-foreground">{reason}</p>
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => pricing?.choosePlan(current)}>
      {billing.ownedListingPacks > 0 ? "Alterar pacotes" : "Contratar pacotes"}
    </Button>
  )
}
