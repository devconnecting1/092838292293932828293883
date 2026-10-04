import type { Metadata } from "next"

import { TRIAL_DAYS } from "@workspace/core/billing"

import { loadCatalogPrices } from "@/components/billing/billing-data"
import { PricingPage } from "@/components/billing/pricing-page"
import { APP_NAME } from "@/components/crm/brand"

// Estática com ISR: sem cookies nem headers; os preços do catálogo valem por 1 hora.
// Quem entrou recebe a versão da conta (app/planos/conta), reescrita pelo proxy.
export const revalidate = 3600

const DESCRIPTION = `Planos do ${APP_NAME} para corretores e imobiliárias: funil de leads, landing pages e feed para os portais. Teste grátis por ${TRIAL_DAYS} dias, sem cartão e sem fidelidade.`

export const metadata: Metadata = {
  // Sem o nome do app aqui: o template do layout raiz já acrescenta "· APP_NAME".
  // O Open Graph não passa pelo template, então lá o nome vai escrito.
  title: "Planos e preços",
  description: DESCRIPTION,
  openGraph: {
    title: `Planos e preços · ${APP_NAME}`,
    description: DESCRIPTION,
    type: "website",
    locale: "pt_BR",
  },
}

export default async function PlanosPage() {
  const prices = await loadCatalogPrices()

  return <PricingPage prices={prices} account={null} />
}
