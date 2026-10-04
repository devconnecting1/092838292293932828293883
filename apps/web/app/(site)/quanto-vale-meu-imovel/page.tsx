import type { Metadata } from "next"

import { CalculadoraPreco } from "@/components/portal/calculadora-preco"
import { PageHero } from "@/components/portal/content"

export const metadata: Metadata = {
  title: "Quanto vale o seu imóvel?",
  description:
    "Descubra o valor de venda estimado do seu imóvel com base nas avaliações oficiais da região. Grátis e sem cadastro.",
}

export default function Page() {
  return (
    <>
      <PageHero
        kicker="Calculadora grátis"
        title="Quanto vale o seu imóvel?"
        text="Descubra o valor de venda estimado do seu imóvel com base nas avaliações oficiais da região. Grátis e sem cadastro."
      />
      <section className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6">
        <CalculadoraPreco modo="venda" />
      </section>
    </>
  )
}
