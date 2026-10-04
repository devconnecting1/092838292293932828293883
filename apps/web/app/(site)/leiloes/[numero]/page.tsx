import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { CaixaPhoto } from "@/components/caixa/caixa-photo"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { brl, getPortalListing, tipoLabel } from "@/lib/portal/caixa"
import { PORTAL, whatsappHref } from "@/lib/portal/config"

export const revalidate = 600

type Props = { params: Promise<{ numero: string }> }

export async function generateStaticParams(): Promise<{ numero: string }[]> {
  return []
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { numero } = await params
  const item = await getPortalListing(numero)
  if (!item) return { title: "Imóvel não encontrado", robots: { index: false } }
  return {
    title: `${tipoLabel(item.tipo)} em ${item.cidade}/${item.uf}${item.desconto ? `, ${Math.round(item.desconto)}% abaixo` : ""}`,
    description: `${item.endereco}. Preço ${brl(item.preco)}${item.valorAvaliacao ? `, avaliação ${brl(item.valorAvaliacao)}` : ""}. Imóvel da Caixa.`,
  }
}

export default async function ImovelPage({ params }: Props) {
  const { numero } = await params
  const item = await getPortalListing(numero)
  if (!item) notFound()
  const photos = areCaixaPhotosEnabled()
  const msg = `Olá! Tenho interesse no imóvel da Caixa nº ${item.numero} (${item.cidade}/${item.uf}) e quero um corretor para me acompanhar.`

  const facts: [string, string][] = [
    ["Tipo", tipoLabel(item.tipo)],
    ["Área privativa", item.areaPrivativa ? `${item.areaPrivativa} m²` : "Ver edital"],
    ["Área do terreno", item.areaTerreno ? `${item.areaTerreno} m²` : "Ver edital"],
    ["Quartos", item.quartos != null ? String(item.quartos) : "Ver edital"],
    ["Vagas", item.vagas != null ? String(item.vagas) : "Ver edital"],
    ["Modalidade", item.modalidade ?? "Ver edital"],
  ]

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 py-8 sm:px-6">
      <nav className="text-sm text-slate-600">
        <Link href="/leiloes" className="font-semibold text-[var(--brand)]">
          Leilões
        </Link>{" "}
        ·{" "}
        <Link href={`/leiloes?uf=${item.uf}`} className="font-semibold text-[var(--brand)]">
          {item.uf}
        </Link>{" "}
        · {item.cidade}
      </nav>

      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <CaixaPhoto
          numero={item.numero}
          index={0}
          enabled={photos}
          alt="Foto principal do imóvel"
          className="h-72 w-full rounded-2xl md:h-[420px]"
        />
        <div className="grid gap-3">
          <CaixaPhoto
            numero={item.numero}
            index={1}
            enabled={photos}
            alt="Foto do imóvel"
            className="h-40 w-full rounded-2xl md:h-[204px]"
          />
          <CaixaPhoto
            numero={item.numero}
            index={2}
            enabled={photos}
            alt="Foto do imóvel"
            className="h-40 w-full rounded-2xl md:h-[204px]"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-7">
        <div className="min-w-0 flex-[999_1_560px]">
          <div className="flex flex-wrap gap-2">
            {item.desconto ? (
              <span className="rounded-lg bg-[#C2410C] px-2.5 py-1 text-sm font-extrabold text-white">
                {Math.round(item.desconto)}% abaixo da avaliação
              </span>
            ) : null}
            {item.aceitaFinanciamento ? (
              <span className="rounded-lg bg-[var(--brand-soft)] px-2.5 py-1 text-sm font-bold text-[var(--brand-deep)]">
                Aceita financiamento
              </span>
            ) : null}
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-700">
              Imóvel da Caixa nº {item.numero}
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
            {tipoLabel(item.tipo)} em {item.bairro ? `${item.bairro}, ` : ""}
            {item.cidade}/{item.uf}
          </h1>
          <p className="mt-2 text-slate-600">{item.endereco}</p>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-200 p-3">
                <dt className="text-xs font-semibold text-slate-500">{k}</dt>
                <dd className="font-extrabold">{v}</dd>
              </div>
            ))}
          </dl>
          {item.descricao ? (
            <div className="mt-6">
              <h2 className="text-lg font-extrabold">Descrição da Caixa</h2>
              <p className="mt-2 leading-relaxed whitespace-pre-line text-slate-700">
                {item.descricao}
              </p>
            </div>
          ) : null}
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
            Antes de qualquer proposta, leia o edital e a matrícula no site da Caixa: eles dizem
            quem paga as dívidas do imóvel, a forma de pagamento e se o imóvel está ocupado. A lista
            oficial não informa ocupação nem uso do FGTS.
          </div>
        </div>

        <aside className="flex w-full flex-[1_1_300px] flex-col gap-3 rounded-2xl border border-slate-200 p-6 shadow-sm lg:sticky lg:top-24">
          <span className="text-sm font-semibold text-slate-600">Preço de venda</span>
          <span className="text-3xl font-extrabold tracking-tight">{brl(item.preco)}</span>
          {item.valorAvaliacao ? (
            <span className="text-sm text-slate-500">Avaliação: {brl(item.valorAvaliacao)}</span>
          ) : null}
          <a
            href={whatsappHref(msg)}
            className="mt-2 rounded-xl bg-[var(--brand)] py-3.5 text-center font-bold text-white"
          >
            Quero um corretor para me acompanhar
          </a>
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="rounded-xl border-[1.5px] border-[var(--brand)] py-3 text-center font-bold text-[var(--brand)]"
          >
            Ver edital no site da Caixa
          </a>
          <Link href="/credito" className="py-2 text-center text-sm font-semibold text-slate-700">
            Avaliar meu crédito antes
          </Link>
          <p className="text-xs leading-relaxed text-slate-500">
            Um corretor parceiro com Selo Verde acompanha você. A parte administrativa, a nota
            fiscal e a diligência no local ficam com a equipe {PORTAL.name}.
          </p>
        </aside>
      </div>
    </div>
  )
}
