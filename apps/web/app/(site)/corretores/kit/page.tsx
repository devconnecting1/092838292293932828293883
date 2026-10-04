import type { Metadata } from "next"

import { AdKit } from "@/components/portal/ad-kit"
import { SoCorretor } from "@/components/portal/corretor-acoes"
import { PORTAL } from "@/lib/portal/config"

export const metadata: Metadata = { title: "Kit de anúncio", robots: { index: false } }

export default function KitPage() {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
          Kit de anúncio
        </span>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
          Anuncie qualquer imóvel seu nas redes
        </h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Coloque a foto, o bairro e o preço. Seus dados do cadastro entram sozinhos na arte e na
          legenda.
        </p>
      </div>
      <SoCorretor>
        <AdKit
          editavel
          cor={PORTAL.primary}
          marca={PORTAL.name}
          imovel={{
            titulo: "Apartamento com 2 quartos",
            local: "Bairro, Cidade/UF",
            preco: "R$ 0",
            avaliacao: null,
            desconto: null,
            origem: "Venda",
            modalidade: null,
            codigo: "anuncio",
            url: "",
            financiamento: null,
          }}
        />
      </SoCorretor>
    </div>
  )
}
