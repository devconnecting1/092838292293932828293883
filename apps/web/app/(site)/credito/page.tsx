import type { Metadata } from "next"

import { PageHero, Section, Steps } from "@/components/portal/content"
import { FinancingSimulator } from "@/components/portal/financing-simulator"

export const metadata: Metadata = {
  title: "Avalie seu crédito antes do leilão",
  description:
    "Simule quanto pode financiar e peça a análise de crédito antes de escolher o imóvel de leilão.",
}

export default function CreditoPage() {
  return (
    <>
      <PageHero
        kicker="Primeiro o crédito, depois o lance"
        title="Avalie seu crédito primeiro. Depois compre com segurança."
        text="Saber quanto o banco pode financiar antes do leilão evita o pior cenário: arrematar e não conseguir pagar."
      />
      <div className="mx-auto -mt-6 max-w-[1240px] px-4 sm:px-6">
        <FinancingSimulator />
      </div>
      <Section title="Comprar com segurança em 4 passos">
        <Steps
          items={[
            {
              t: "Simule",
              d: "Veja uma estimativa de quanto pode comprar com a sua renda e a sua entrada.",
            },
            {
              t: "Peça a análise",
              d: "O banco analisa o seu crédito e informa o valor aprovado antes de você escolher o imóvel.",
            },
            {
              t: "Escolha dentro do limite",
              d: "Filtre só imóveis que aceitam financiamento e cabem no valor aprovado, já com os custos.",
            },
            {
              t: "Dê o lance tranquilo",
              d: "Com o crédito aprovado e a conta feita, você sabe até onde pode ir.",
            },
          ]}
        />
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-5 leading-relaxed text-slate-700">
          <strong>Documentos que costumam ser pedidos:</strong> documento com foto e CPF,
          comprovante de estado civil, comprovante de residência, comprovantes de renda dos últimos
          meses, última declaração de Imposto de Renda e extrato do FGTS, se for usar. A lista exata
          depende do banco.
        </p>
      </Section>
    </>
  )
}
