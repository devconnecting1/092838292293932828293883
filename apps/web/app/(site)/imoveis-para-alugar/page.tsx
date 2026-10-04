import type { Metadata } from "next"

import { VitrineDireta } from "@/components/portal/vitrine-direta"

export const metadata: Metadata = {
  title: "Imóveis para alugar direto com o proprietário",
  description:
    "Casas e apartamentos para alugar anunciados pelos próprios donos no Vamos Arrematar. Fale direto com quem está alugando.",
}

type Params = Promise<Record<string, string | string[] | undefined>>

export default async function ImoveisParaAlugarPage({ searchParams }: { searchParams: Params }) {
  return <VitrineDireta finalidade="aluguel" filtros={await searchParams} />
}
