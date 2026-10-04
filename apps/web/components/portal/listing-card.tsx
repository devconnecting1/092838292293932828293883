import Link from "next/link"

import { CaixaPhoto } from "@/components/caixa/caixa-photo"
import { brl, tipoLabel, type PortalListing } from "@/lib/portal/caixa"

export function ListingCard({ item, photos }: { item: PortalListing; photos: boolean }) {
  const area = item.areaPrivativa ?? item.areaTotal ?? item.areaTerreno
  const title = `${tipoLabel(item.tipo)}${item.quartos ? ` ${item.quartos} quarto${item.quartos > 1 ? "s" : ""}` : ""}`
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <Link href={`/leiloes/${item.numero}`} className="relative block">
        <CaixaPhoto
          numero={item.numero}
          enabled={photos}
          alt={`${title} em ${item.cidade}/${item.uf}`}
          className="h-44 w-full"
        />
        {item.desconto ? (
          <span className="absolute top-3 left-3 rounded-lg bg-[#C2410C] px-2.5 py-1 text-sm font-extrabold text-white">
            {Math.round(item.desconto)}% abaixo
          </span>
        ) : null}
        {item.aceitaFinanciamento ? (
          <span className="absolute top-3 right-3 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-[var(--brand-deep)]">
            Aceita financiamento
          </span>
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <span className="text-xs font-bold tracking-wide text-slate-500 uppercase">
          Caixa · {item.modalidade ?? "Venda"}
        </span>
        <Link
          href={`/leiloes/${item.numero}`}
          className="font-bold text-slate-900 hover:text-[var(--brand)]"
        >
          {title}
        </Link>
        <span className="text-sm text-slate-600">
          {[item.bairro, `${item.cidade}/${item.uf}`].filter(Boolean).join(" · ")}
          {area ? ` · ${Math.round(area)} m²` : ""}
        </span>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-extrabold">{brl(item.preco)}</span>
          {item.valorAvaliacao && item.valorAvaliacao > item.preco ? (
            <span className="text-xs text-slate-500 line-through">{brl(item.valorAvaliacao)}</span>
          ) : null}
        </div>
        <Link
          href={`/leiloes/${item.numero}`}
          className="mt-auto rounded-lg border-[1.5px] border-[var(--brand)] py-2.5 text-center text-sm font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)]"
        >
          Ver imóvel
        </Link>
      </div>
    </article>
  )
}
