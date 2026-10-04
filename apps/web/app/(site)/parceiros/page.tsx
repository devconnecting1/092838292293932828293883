import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { ParceiroForm } from "@/components/portal/parceiro-form"

export const metadata: Metadata = {
  title: "Seja parceiro do Vamos Arrematar",
  description:
    "Correspondentes, despachantes, engenheiros, avaliadores, leiloeiros e imobiliárias: cadastre-se para trabalhar com quem compra imóvel de leilão.",
}

export default function ParceirosPage() {
  return (
    <>
      <PageHero
        kicker="Parceiros e correspondentes"
        title="Trabalhe com quem compra imóvel de leilão em todo o Brasil."
        text="Precisamos de gente boa em cada cidade: documentação, vistoria, avaliação, reforma e correspondência. Cadastre-se e a nossa equipe entra em contato."
      />
      <Section title="Cadastro de parceiro">
        <ParceiroForm />
        <p className="text-sm text-slate-500">
          O cadastro não cria vínculo nem exclusividade. Cada parceria é combinada caso a caso, com
          contrato próprio.
        </p>
      </Section>
    </>
  )
}
