import type { Metadata } from "next"

import { loadCatalogPrices } from "@/components/billing/billing-data"
import type { CheckoutReturnStatus } from "@/components/billing/checkout-return-notice"
import { loadPricingAccount } from "@/components/billing/pricing-account-data"
import { PricingPage } from "@/components/billing/pricing-page"

export const metadata: Metadata = {
  title: "Planos e preços",
  // Rota interna (o endereço público é /planos): fora dos buscadores.
  robots: { index: false, follow: false },
}

type PlanosContaPageProps = {
  searchParams: Promise<{ imobiliaria?: string | string[]; checkout?: string | string[] }>
}

function readCheckoutStatus(value: string | string[] | undefined): CheckoutReturnStatus | null {
  return value === "sucesso" || value === "cancelado" ? value : null
}

/**
 * /planos para quem entrou (o proxy reescreve /planos para cá quando há sessão).
 * Dinâmica: lê a sessão, as memberships ativas e a assinatura da imobiliária.
 * Sem sessão válida, mostra a mesma página do visitante.
 */
export default async function PlanosContaPage({ searchParams }: PlanosContaPageProps) {
  const { imobiliaria, checkout } = await searchParams
  const [prices, account] = await Promise.all([
    loadCatalogPrices(),
    loadPricingAccount({
      organizationSlug: typeof imobiliaria === "string" ? imobiliaria : null,
      checkout: readCheckoutStatus(checkout),
    }),
  ])

  return <PricingPage prices={prices} account={account} />
}
