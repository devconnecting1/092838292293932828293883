import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { CotaCompartilhar, CotaProgresso, CotaReserva } from "@/components/portal/cota-reserva"
import { ListingGallery } from "@/components/portal/listing-gallery"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { contaDaCota, resumoCotas, TOTAL_COTAS } from "@/lib/portal/cotas"
import { brl, getPortalListing, tipoLabel, usaFotoCaixa } from "@/lib/portal/imoveis"

import { grupoCotasHref } from "../grupo"

export const revalidate = 300

type Props = { params: Promise<{ numero: string }> }

export async function generateStaticParams(): Promise<{ numero: string }[]> {
  return []
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { numero } = await params
  const item = await getPortalListing(numero)
  if (!item) return { title: "Imóvel não encontrado", robots: { index: false } }
  const conta = contaDaCota(item)
  return {
    title: `Cotas de 10% em ${tipoLabel(item.tipo)} em ${item.cidade}/${item.uf}`,
    description: `Cada cota de 10% sai por cerca de ${brl(conta.valorCota)}. O arremate só acontece quando o grupo fecha 100%.`,
  }
}

export default async function CotaImovelPage({ params }: Props) {
  const { numero } = await params
  const item = await getPortalListing(numero)
  if (!item) notFound()
  const conta = contaDaCota(item)
  const r = (await resumoCotas([item.numero]))[item.numero] ?? { reservadas: 0, status: "aberto" }
  const reservadas = Math.min(r.reservadas, TOTAL_COTAS)
  const restantes = r.status === "aberto" ? TOTAL_COTAS - reservadas : 0
  const titulo = `${tipoLabel(item.tipo)} em ${item.cidade}/${item.uf}`
  const linhas: [string, number][] = [
    ["Lance", conta.lance],
    ["Comissão do leiloeiro", conta.leiloeiro],
    ["ITBI", conta.itbi],
    ["Cartório (registro e escritura)", conta.cartorio],
    ["Assessoria", conta.assessoria],
    ["Manutenção e pintura (estimativa)", conta.manutencao],
  ]

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-1">
        <Link href="/cotas" className="text-sm font-bold text-[var(--brand)]">
          Arremate em cotas
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">{titulo}</h1>
        <p className="text-slate-600">{item.endereco}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-start">
        <div className="flex flex-col gap-6">
          <ListingGallery
            numero={item.numero}
            fotos={item.fotos}
            caixa={usaFotoCaixa(item)}
            enabled={areCaixaPhotosEnabled()}
          />
          <section className="rounded-2xl border border-slate-200 p-5">
            <h2 className="text-xl font-extrabold">Conta do investimento</h2>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {linhas.map(([t, v]) => (
                  <tr key={t} className="border-b border-slate-100">
                    <td className="py-2 text-slate-700">{t}</td>
                    <td className="py-2 text-right font-bold">{brl(v)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-3 font-extrabold">Investimento total</td>
                  <td className="pt-3 text-right text-lg font-extrabold">{brl(conta.total)}</td>
                </tr>
                <tr>
                  <td className="py-1 font-extrabold text-[var(--brand)]">Cada cota de 10%</td>
                  <td className="py-1 text-right text-lg font-extrabold text-[var(--brand)]">
                    {brl(conta.valorCota)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Pela calculadora de viabilidade, vendendo pelo valor de avaliação
              {item.valorAvaliacao ? ` (${brl(item.valorAvaliacao)})` : ""}, o lucro líquido
              estimado é de {brl(conta.lucroLiquido)}, um retorno de cerca de{" "}
              {Math.round(conta.roi)}% sobre o investido. É uma estimativa, não uma garantia.
            </p>
            <Link
              href={`/leiloes/${item.numero}/viabilidade`}
              className="mt-3 inline-block rounded-lg border-[1.5px] border-[var(--brand)] px-4 py-2 text-sm font-bold text-[var(--brand)]"
            >
              Refazer a conta na calculadora
            </Link>
          </section>
          <section className="rounded-2xl bg-slate-50 p-5 text-sm leading-relaxed text-slate-700">
            <h2 className="text-base font-extrabold text-slate-900">Regras da cota</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Cota mínima de 10%. Cada pessoa pode ficar com quantas cotas quiser.</li>
              <li>O imóvel só é arrematado quando as cotas fecham 100%.</li>
              <li>
                Um dos cotistas fica como titular nesta rodada. Na próxima, o titular é outro; quem
                já foi só repete se quiser e não houver outra pessoa.
              </li>
              <li>Tudo é formalizado em contrato entre os cotistas antes do lance.</li>
              <li>
                Depois do arremate, fazemos a manutenção e a imobiliária vende. O resultado é
                dividido conforme as cotas.
              </li>
            </ul>
          </section>
        </div>

        <aside className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-5 lg:sticky lg:top-24">
          <span className="text-sm font-bold tracking-wide text-[var(--brand)] uppercase">
            Reserve sua cota
          </span>
          <CotaProgresso reservadas={reservadas} />
          <CotaReserva
            imovelId={item.numero}
            titulo={titulo}
            valorCota={conta.valorCota}
            restantes={restantes}
          />
          <CotaCompartilhar titulo={titulo} />
          <a href={grupoCotasHref()} className="text-center text-sm font-bold text-emerald-700">
            Entrar no grupo de cotas no WhatsApp
          </a>
          <Link href={`/leiloes/${item.numero}`} className="text-center text-sm text-slate-600">
            Ver a ficha completa do imóvel
          </Link>
        </aside>
      </div>
    </div>
  )
}
