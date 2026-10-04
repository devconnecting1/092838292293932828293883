import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { TabelaPlanos } from "@/components/portal/assinar-plano"
import { PORTAL } from "@/lib/portal/config"

export const metadata: Metadata = {
  title: "Planos para corretores e investidores de leilão",
  description:
    "Calculadora com lance máximo, consulta processual, leads por proximidade e página própria. Planos a partir de R$ 39,90 por mês, cancele quando quiser.",
}

export default function PlanosPage() {
  return (
    <>
      <PageHero
        kicker="Planos"
        title="Ferramentas de quem arremata, num preço que se paga no primeiro negócio."
        text="Busca, calculadora e simuladores continuam grátis. Os planos liberam o que dá dinheiro: leads perto de você, consulta processual e relatórios com a sua marca."
      />
      <Section title="Escolha o seu plano">
        <TabelaPlanos />
        <ul className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
          <li>Pagamento seguro pela Stripe, no cartão.</li>
          <li>Renovação automática. Cancele quando quiser, sem multa.</li>
          <li>Nota fiscal emitida por {PORTAL.legalName}.</li>
        </ul>
      </Section>
    </>
  )
}
