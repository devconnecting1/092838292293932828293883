import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { AssessoriaForm } from "@/components/portal/assessoria-form"
import { CorretorAcoes } from "@/components/portal/corretor-acoes"
import { FinancingSimulator } from "@/components/portal/financing-simulator"
import { ListingGallery } from "@/components/portal/listing-gallery"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { brl, dataHora, getPortalListing, tipoLabel, usaFotoCaixa } from "@/lib/portal/imoveis"
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
    description: `${item.endereco}. Preço ${brl(item.preco)}${item.valorAvaliacao ? `, avaliação ${brl(item.valorAvaliacao)}` : ""}. ${item.origemNome}.`,
  }
}

export default async function ImovelPage({ params }: Props) {
  const { numero } = await params
  const item = await getPortalListing(numero)
  if (!item) notFound()
  const photos = areCaixaPhotosEnabled()
  const codigo = item.codigoBanco ?? item.numero
  const msg = `Olá! Tenho interesse no imóvel ${item.origemNome} nº ${codigo} (${item.cidade}/${item.uf}) e quero um corretor para me acompanhar.`
  const leilao: [string, string | null][] = [
    ["Origem", item.origemNome],
    ["Modalidade", item.modalidade],
    [
      "Leiloeiro",
      item.leiloeiro
        ? `${item.leiloeiro}${item.leiloeiroRegistro ? ` (${item.leiloeiroRegistro})` : ""}`
        : null,
    ],
    ["Intermediação", item.intermediador],
    ["Código do imóvel no banco", item.codigoBanco],
    ["Código do leilão / lote", item.codigoLeilao],
    ["1º leilão", dataHora(item.dataLeilao1)],
    ["2º leilão", dataHora(item.dataLeilao2)],
    ["Lance mínimo no 2º leilão", item.lanceLeilao2 ? brl(item.lanceLeilao2) : null],
    ["Encerramento", dataHora(item.dataEncerramento)],
    [
      "Matrícula",
      item.matricula ? `${item.matricula}${item.cartorio ? `, ${item.cartorio}` : ""}` : null,
    ],
    ["Processo", item.processo ? `${item.processo}${item.vara ? `, ${item.vara}` : ""}` : null],
  ]

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

      <ListingGallery
        numero={item.numero}
        fotos={item.fotos}
        caixa={usaFotoCaixa(item)}
        enabled={photos}
      />

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
              {item.origemNome} nº {codigo}
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
          <div className="mt-6">
            <h2 className="text-lg font-extrabold">Dados do leilão</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {leilao
                .filter((l): l is [string, string] => !!l[1])
                .map(([k, v]) => (
                  <div
                    key={k}
                    className="flex justify-between gap-3 border-b border-slate-100 py-2"
                  >
                    <dt className="text-sm text-slate-500">{k}</dt>
                    <dd className="text-right text-sm font-bold">{v}</dd>
                  </div>
                ))}
            </dl>
            {item.processo ? (
              <a
                href="#assessoria"
                className="mt-3 inline-block rounded-lg border-[1.5px] border-[var(--brand)] px-4 py-2 text-sm font-bold text-[var(--brand)]"
              >
                Pedir diligência deste processo
              </a>
            ) : null}
          </div>
          {item.aceitaFinanciamento ? (
            <div className="mt-6" id="financiamento">
              <FinancingSimulator
                valorImovel={item.preco}
                imovelId={item.numero}
                imovelTitulo={`${tipoLabel(item.tipo)} em ${item.cidade}/${item.uf}`}
              />
            </div>
          ) : null}
          {item.descricao ? (
            <div className="mt-6">
              <h2 className="text-lg font-extrabold">Descrição</h2>
              <p className="mt-2 leading-relaxed whitespace-pre-line text-slate-700">
                {item.descricao}
              </p>
            </div>
          ) : null}
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
            Antes de qualquer lance, leia o edital e a matrícula: eles dizem quem paga as dívidas do
            imóvel, a forma de pagamento, a comissão do leiloeiro e se o imóvel está ocupado.
          </div>
        </div>

        <aside className="flex w-full flex-[1_1_300px] flex-col gap-3 rounded-2xl border border-slate-200 p-6 shadow-sm lg:sticky lg:top-24">
          <span className="text-sm font-semibold text-slate-600">
            {item.dataLeilao1 || item.dataLeilao2 ? "Lance mínimo" : "Preço de venda"}
          </span>
          <span className="text-3xl font-extrabold tracking-tight">{brl(item.preco)}</span>
          {item.valorAvaliacao ? (
            <span className="text-sm text-slate-500">Avaliação: {brl(item.valorAvaliacao)}</span>
          ) : null}
          <div id="assessoria" className="mt-2 flex scroll-mt-24 flex-col gap-3">
            <AssessoriaForm
              imovelId={item.numero}
              titulo={`${tipoLabel(item.tipo)} em ${item.cidade}/${item.uf}`}
            />
            <Link
              href={`/cotas/${item.numero}`}
              className="rounded-xl border-[1.5px] border-[var(--brand)] py-3 text-center font-bold text-[var(--brand)]"
            >
              Arrematar em cotas (a partir de 10%)
            </Link>
          </div>
          <Link
            href={`/leiloes/${item.numero}/viabilidade`}
            className="rounded-xl border-[1.5px] border-[var(--brand)] py-3 text-center font-bold text-[var(--brand)]"
          >
            Calcular viabilidade
          </Link>
          {item.editalUrl ? (
            <a
              href={item.editalUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="py-1 text-center text-sm font-bold text-[var(--brand)]"
            >
              Ver edital
            </a>
          ) : null}
          <a
            href={whatsappHref(msg)}
            className="rounded-xl border-[1.5px] border-slate-300 py-3 text-center font-bold text-slate-800"
          >
            Falar com um corretor
          </a>
          <CorretorAcoes id={item.numero} />
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
