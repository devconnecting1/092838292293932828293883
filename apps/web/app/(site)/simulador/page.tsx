import type { Metadata } from "next"

import { CtaBand, PageHero, Section } from "@/components/portal/content"
import { FinancingSimulator } from "@/components/portal/financing-simulator"
import { PropostaSimulador } from "@/components/portal/proposta-simulador"
import { PORTAL } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Como preencher a proposta de compra de imóvel da Caixa, passo a passo",
  description:
    "Veja como é uma proposta de compra de imóvel retomado, do imóvel à declaração final, com dados de exemplo. Depois, simule o seu financiamento.",
}

export default function SimuladorPage() {
  return (
    <>
      <div className="h-1.5 bg-[linear-gradient(90deg,#005CA9_70%,#F39200_70%)]" />
      <PageHero
        kicker="Passo a passo"
        title="Como preencher a proposta de compra da Caixa."
        text="Montamos uma proposta completa com uma pessoa e um imóvel de exemplo. Clique em cada etapa, mude o valor e a forma de pagamento e veja o resultado no final."
      />
      <Section title="Simulador de proposta">
        <PropostaSimulador
          empresa={{
            nome: PORTAL.legalName,
            cnpj: PORTAL.cnpj,
            creci: PORTAL.creci,
            creciJ: PORTAL.creciJ || null,
            endereco: PORTAL.address,
            corretor: "Fabrício Damião",
          }}
        />
      </Section>
      <Section title="Agora simule com os seus números" muted>
        <FinancingSimulator />
      </Section>
      <CtaBand
        title="Faça a sua proposta com a gente"
        text="Você escolhe o imóvel e nós cuidamos do resto, da análise até a chave na mão."
        href="/como-funciona/caixa#assessoria"
        label="Quero assessoria"
      />
    </>
  )
}
