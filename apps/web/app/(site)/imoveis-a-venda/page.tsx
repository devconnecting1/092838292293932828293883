import type { Metadata } from "next"

import { VitrineDireta } from "@/components/portal/vitrine-direta"

export const metadata: Metadata = {
  title: "Imóveis à venda direto com o proprietário",
  description:
    "Casas, apartamentos e terrenos anunciados pelos próprios donos no Vamos Arrematar. Fale direto com quem está vendendo.",
}

type Params = Promise<Record<string, string | string[] | undefined>>

export default async function ImoveisAVendaPage({ searchParams }: { searchParams: Params }) {
  return <VitrineDireta finalidade="venda" filtros={await searchParams} />
}
