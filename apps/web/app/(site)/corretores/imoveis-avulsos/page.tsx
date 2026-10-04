import type { Metadata } from "next"

import { VitrineAvulsos } from "@/components/portal/avulsos"
import { SoCorretor } from "@/components/portal/corretor-acoes"
import { lerConfigPortal, pct } from "@/lib/portal/config-portal"

export const metadata: Metadata = {
  title: "Imóveis avulsos para corretores",
  robots: { index: false },
}

export const revalidate = 300

export default async function ImoveisAvulsosPage() {
  const a = (await lerConfigPortal()).comissao_avulso
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Imóveis avulsos</h1>
      <p className="text-slate-600">
        Imóveis de proprietários, corretores e investidores, liberados só para corretores parceiros.
        Levou o comprador e fechou? A comissão é sua: {pct(a.corretor)} do valor da venda (vale o
        percentual gravado em cada anúncio).
      </p>
      <SoCorretor>
        <VitrineAvulsos />
      </SoCorretor>
    </div>
  )
}
