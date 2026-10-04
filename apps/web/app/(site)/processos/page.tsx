import type { Metadata } from "next"

import { PageHero, Section } from "@/components/portal/content"
import { FerramentaRestrita } from "@/components/portal/ferramenta-restrita"
import { FerramentasPagas } from "@/components/portal/ferramentas-pagas"

export const metadata: Metadata = {
  robots: { index: false },
  title: "Ferramentas de análise",
  description:
    "Veja o andamento do processo de um imóvel de leilão judicial: classe, vara e movimentações, direto da base do CNJ.",
}

export default async function ProcessosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const n = typeof sp.numero === "string" ? sp.numero.slice(0, 30) : ""
  return (
    <>
      <PageHero
        kicker="Consulta processual"
        title="Processo, CPF e certidões: tudo conferido antes do lance."
        text="Digite o número do processo que está no edital e veja a vara, a classe e as últimas movimentações. Ajuda a saber se há recurso, embargos ou suspensão antes de arrematar."
      />
      <Section title="Ferramentas de análise">
        <FerramentaRestrita>
          <FerramentasPagas numeroInicial={n} />
        </FerramentaRestrita>
      </Section>
    </>
  )
}
