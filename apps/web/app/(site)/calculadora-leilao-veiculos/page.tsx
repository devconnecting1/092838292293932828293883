import type { Metadata } from "next"
import Link from "next/link"

import { CalculadoraVeiculos } from "@/components/portal/calculadora-veiculos"
import { PageHero } from "@/components/portal/content"

export const metadata: Metadata = {
  title: "Calculadora de leilão de veículos",
  description:
    "Quanto custa de verdade o carro, a moto ou o caminhão de leilão: lance, comissão, pátio, débitos, documentação e reparos, comparado com a Tabela FIPE. Grátis.",
}

export default function Page() {
  return (
    <>
      <PageHero
        kicker="Calculadora grátis"
        title="Quanto custa de verdade o veículo de leilão?"
        text="Escolha o veículo na Tabela FIPE, informe o lance e os custos do edital. A calculadora mostra o custo total, quanto você economiza, o lance máximo para a sua meta e, se for revender, o lucro já com o imposto."
      >
        <Link
          href="/leilao-de-veiculos"
          className="text-sm font-bold text-[var(--brand-deep)] underline"
        >
          Entenda como funciona o leilão de veículos
        </Link>
      </PageHero>
      <section className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <CalculadoraVeiculos />
      </section>
    </>
  )
}
