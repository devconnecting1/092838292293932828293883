import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { AdKit } from "@/components/portal/ad-kit"
import { SoCorretor } from "@/components/portal/corretor-acoes"
import { PORTAL } from "@/lib/portal/config"
import { brl, getPortalListing, tipoLabel } from "@/lib/portal/imoveis"
import { siteUrl } from "@/lib/portal/site-url"

export const revalidate = 600

type Props = { params: Promise<{ numero: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { numero } = await params
  const item = await getPortalListing(numero)
  return {
    title: item
      ? `Anúncio: ${tipoLabel(item.tipo)} em ${item.cidade}/${item.uf}`
      : "Imóvel não encontrado",
    robots: { index: false },
  }
}

export default async function AnunciarPage({ params }: Props) {
  const { numero } = await params
  const item = await getPortalListing(numero)
  if (!item) notFound()

  const titulo = `${tipoLabel(item.tipo)}${item.quartos ? ` com ${item.quartos} quarto${item.quartos > 1 ? "s" : ""}` : ""}`
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-8 sm:px-6">
      <nav className="text-sm text-slate-600">
        <Link href={`/leiloes/${item.numero}`} className="font-semibold text-[var(--brand)]">
          Voltar ao imóvel
        </Link>
      </nav>
      <div>
        <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
          Kit de anúncio do corretor
        </span>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
          {titulo} em {item.cidade}/{item.uf}
        </h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Preencha seus dados, escolha o formato e baixe ou compartilhe. A arte e a legenda saem com
          o seu nome, CRECI e WhatsApp, e o link leva para a página do imóvel.
        </p>
      </div>
      <SoCorretor>
        <AdKit
          cor={PORTAL.primary}
          marca={PORTAL.name}
          imovel={{
            titulo,
            local: [item.bairro, `${item.cidade}/${item.uf}`].filter(Boolean).join(", "),
            preco: brl(item.preco),
            avaliacao: item.valorAvaliacao ? brl(item.valorAvaliacao) : null,
            desconto: item.desconto,
            origem: item.origemNome,
            modalidade: item.modalidade,
            codigo: item.codigoBanco ?? item.numero,
            url: `${siteUrl()}/leiloes/${item.numero}`,
            financiamento: item.aceitaFinanciamento,
          }}
        />
      </SoCorretor>
    </div>
  )
}
