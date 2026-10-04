import type { Metadata } from "next"

import { VitrineAvulsos } from "@/components/portal/avulsos"
import { SoCorretor } from "@/components/portal/corretor-acoes"

export const metadata: Metadata = {
  title: "Imóveis avulsos para corretores",
  robots: { index: false },
}

export default function ImoveisAvulsosPage() {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Imóveis avulsos</h1>
      <p className="text-slate-600">
        Imóveis de proprietários, corretores e investidores, liberados só para corretores parceiros.
        Levou o comprador e fechou? A comissão é sua: 4% do valor da venda.
      </p>
      <SoCorretor>
        <VitrineAvulsos />
      </SoCorretor>
    </div>
  )
}
