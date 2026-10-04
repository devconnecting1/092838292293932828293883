import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { SuporteCliente } from "@/components/portal/gestao"

export const metadata: Metadata = { title: "Suporte", robots: { index: false } }

export default function SuportePage() {
  return (
    <>
      <PageHero
        kicker="Suporte"
        title="Fale com a nossa equipe."
        text="Abra um chamado e acompanhe a resposta por aqui. Cada chamado tem um número de protocolo."
      />
      <Section title="Meus chamados">
        <SuporteCliente />
      </Section>
    </>
  )
}
