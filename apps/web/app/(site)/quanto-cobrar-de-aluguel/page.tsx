import type { Metadata } from "next"

import { CalculadoraPreco } from "@/components/portal/calculadora-preco"
import { PageHero } from "@/components/portal/content"

export const metadata: Metadata = {
  title: "Quanto cobrar de aluguel?",
  description:
    "Descubra quanto cobrar de aluguel pelo seu imóvel com base nas avaliações oficiais da região. Grátis e sem cadastro.",
}

export default function Page() {
  return (
    <>
      <PageHero
        kicker="Calculadora grátis"
        title="Quanto cobrar de aluguel?"
        text="Descubra quanto cobrar de aluguel pelo seu imóvel com base nas avaliações oficiais da região. Grátis e sem cadastro."
      />
      <section className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6">
        <CalculadoraPreco modo="aluguel" />
      </section>
    </>
  )
}
