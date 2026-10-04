import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ListingSheet } from "@/components/portal/listing-sheet"
import { ViabilityCalculator } from "@/components/portal/viability-calculator"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { PORTAL } from "@/lib/portal/config"
import { getPortalListing, tipoLabel } from "@/lib/portal/imoveis"
import { entradasPadrao, modalidadeDe } from "@/lib/portal/viabilidade"

export const revalidate = 600

type Props = { params: Promise<{ numero: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { numero } = await params
  const item = await getPortalListing(numero)
  if (!item) return { title: "Imóvel não encontrado", robots: { index: false } }
  return {
    title: `Viabilidade: ${tipoLabel(item.tipo)} em ${item.cidade}/${item.uf}`,
    robots: { index: false },
  }
}

export default async function ViabilidadePage({ params }: Props) {
  const { numero } = await params
  const item = await getPortalListing(numero)
  if (!item) notFound()

  const titulo = `${tipoLabel(item.tipo)} em ${item.bairro ? `${item.bairro}, ` : ""}${item.cidade}/${item.uf}`
  const referencia = [item.origemNome, item.codigoBanco ?? item.numero, item.codigoLeilao]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-8 sm:px-6">
      <nav className="text-sm text-slate-600 print:hidden">
        <Link href={`/leiloes/${item.numero}`} className="font-semibold text-[var(--brand)]">
          Voltar ao imóvel
        </Link>
      </nav>
      <div className="print:hidden">
        <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
          Calculadora de viabilidade
        </span>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{titulo}</h1>
        <p className="mt-1 text-slate-600">
          Ref. {referencia}. Os valores do imóvel já vêm preenchidos; ajuste o que souber e deixe o
          resto como está.
        </p>
      </div>
      <div className="hidden print:block">
        <h1 className="text-2xl font-extrabold">Dossiê de viabilidade</h1>
        <p className="text-sm">
          {titulo} · Ref. {referencia} ·{" "}
          {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
        </p>
      </div>
      <ListingSheet item={item} photos={areCaixaPhotosEnabled()} />
      <ViabilityCalculator
        inicial={entradasPadrao({
          avaliacao: item.valorAvaliacao,
          preco: item.preco,
          modalidade: modalidadeDe(item.modalidade, item.origem),
        })}
        empresa={PORTAL.legalName}
      />
    </div>
  )
}
