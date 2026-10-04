import type { Metadata } from "next"

import { AnuncioProprietario } from "@/components/portal/avulsos"
import { PageHero, Section } from "@/components/portal/content"
import { lerConfigPortal, pct } from "@/lib/portal/config-portal"

export const metadata: Metadata = {
  title: "Anuncie seu imóvel grátis para corretores parceiros",
  description:
    "Cadastre seu imóvel de graça. Ele vai para a vitrine dos corretores parceiros, que levam compradores. Comissão só se eles venderem.",
}

export const revalidate = 300

export default async function AnuncieGratisPage() {
  const a = (await lerConfigPortal()).comissao_avulso
  return (
    <>
      <PageHero
        kicker="Anúncio grátis para proprietário"
        title="Seu imóvel na mão de corretores de todo o estado, sem pagar nada para anunciar."
        text={`Cadastre fotos e dados. Depois da aprovação, os corretores parceiros recebem o imóvel e levam compradores. Vendeu sozinho para quem te procurou? Não paga comissão. Vendeu com corretor? ${pct(a.total)} sobre a venda.`}
      />
      <Section title="Cadastre o seu imóvel">
        <AnuncioProprietario />
      </Section>
    </>
  )
}
