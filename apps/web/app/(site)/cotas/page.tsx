import type { Metadata } from "next"
import Link from "next/link"

import { CtaBand, PageHero, Section, Steps } from "@/components/portal/content"
import { CotaProgresso } from "@/components/portal/cota-reserva"
import { ListingPhoto } from "@/components/portal/listing-photo"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { contaDaCota, imoveisSugeridos, resumoCotas, TOTAL_COTAS } from "@/lib/portal/cotas"
import { brl, tipoLabel, usaFotoCaixa } from "@/lib/portal/imoveis"

import { grupoCotasHref } from "./grupo"

export const revalidate = 600

export const metadata: Metadata = {
  title: "Arremate em cotas: invista em imóvel de leilão a partir de 10%",
  description:
    "Junte amigos e parentes para arrematar um imóvel de leilão em cotas de 10%. Reforma leve, venda pela imobiliária e divisão do resultado em contrato.",
}

export default async function CotasPage() {
  const sugeridos = await imoveisSugeridos(9)
  const resumo = await resumoCotas(sugeridos.map((i) => i.numero))
  const photos = areCaixaPhotosEnabled()
  const grupo = grupoCotasHref()

  return (
    <>
      <PageHero
        kicker="Arremate em cotas"
        title="Invista em imóvel de leilão com cotas a partir de 10%."
        text="Você escolhe quantas cotas quer, chama amigos e parentes e, quando o grupo fecha 100%, a gente arremata, faz a manutenção e vende o imóvel. É investimento: o lucro da venda é dividido conforme as cotas de cada um."
      >
        <div className="flex flex-wrap gap-3">
          <a
            href="#imoveis"
            className="rounded-xl bg-[var(--brand)] px-6 py-3.5 font-bold text-white"
          >
            Ver imóveis para cota
          </a>
          <a
            href={grupo}
            className="rounded-xl border-[1.5px] border-emerald-600 bg-white px-6 py-3.5 font-bold text-emerald-700"
          >
            Entrar no grupo de cotas
          </a>
        </div>
      </PageHero>

      <Section title="Como funciona">
        <Steps
          items={[
            {
              t: "Escolha o imóvel e as cotas",
              d: "Cada cota vale 10% do investimento total: lance, comissão do leiloeiro, ITBI, cartório, assessoria e manutenção. Você pode ficar com quantas cotas quiser.",
            },
            {
              t: "Feche os 100%",
              d: "Compartilhe o link com amigos e parentes. O imóvel só é arrematado quando as 10 cotas fecham. Se não fechar, ninguém paga nada.",
            },
            {
              t: "Contrato e titular",
              d: "Assinamos um contrato entre os cotistas. Um deles fica como titular do imóvel nesta rodada; na próxima, o titular é outro, e só repete se quiser e não houver mais ninguém.",
            },
            {
              t: "Manutenção e venda",
              d: "Fazemos a manutenção necessária, como pintura e pequenos reparos, e a imobiliária vende o imóvel. O resultado é dividido conforme as cotas.",
            },
          ]}
        />
      </Section>

      <Section title="Quanto pode render" muted>
        <p className="max-w-3xl leading-relaxed text-slate-700">
          Nas operações que acompanhamos, o retorno costuma ficar entre 30% e 100% sobre o valor
          investido. Isso depende do valor de mercado, do bairro, da cidade, do custo da reforma e
          do tempo até a venda. Cada imóvel tem a conta feita pela nossa calculadora de viabilidade,
          e você pode refazer com os seus números.
        </p>
        <p className="max-w-3xl rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
          Retorno não é garantido. Leilão tem riscos, como ocupação, dívidas não informadas, demora
          na venda e mudança de preço no mercado. Leia o edital e o contrato antes de confirmar a
          sua cota.
        </p>
      </Section>

      <Section id="imoveis" title="Imóveis sugeridos para cota">
        {sugeridos.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {sugeridos.map((item) => {
              const conta = contaDaCota(item)
              const r = resumo[item.numero]?.reservadas ?? 0
              const titulo = `${tipoLabel(item.tipo)} em ${item.cidade}/${item.uf}`
              return (
                <article
                  key={item.numero}
                  className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  <Link href={`/cotas/${item.numero}`} className="relative block">
                    <ListingPhoto
                      numero={item.numero}
                      fotos={item.fotos}
                      caixa={usaFotoCaixa(item)}
                      enabled={photos}
                      alt={titulo}
                      className="h-40 w-full"
                    />
                    {item.desconto ? (
                      <span className="absolute top-3 left-3 rounded-lg bg-[#C2410C] px-2.5 py-1 text-sm font-extrabold text-white">
                        {Math.round(item.desconto)}% abaixo
                      </span>
                    ) : null}
                  </Link>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <span className="font-bold">{titulo}</span>
                    <span className="text-sm text-slate-600">{item.bairro ?? item.endereco}</span>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <span>
                        Investimento
                        <b className="block text-base">{brl(conta.total)}</b>
                      </span>
                      <span>
                        Cota de 10%
                        <b className="block text-base">{brl(conta.valorCota)}</b>
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">
                      Retorno estimado pela calculadora: {Math.round(conta.roi)}%
                    </span>
                    <CotaProgresso reservadas={Math.min(r, TOTAL_COTAS)} />
                    <Link
                      href={`/cotas/${item.numero}`}
                      className="mt-auto rounded-lg bg-[var(--brand)] py-2.5 text-center text-sm font-bold text-white"
                    >
                      Quero cotas deste imóvel
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600">
            Estamos selecionando os próximos imóveis. Entre no grupo para ser avisado.
          </p>
        )}
        <p className="text-sm text-slate-600">
          Viu outro imóvel no portal que daria uma boa cota? Abra a página dele e use o link{" "}
          <b>Arrematar em cotas</b>.
        </p>
      </Section>

      <CtaBand
        title="Grupo de arremate em cotas"
        text="No grupo de WhatsApp a gente apresenta os imóveis, o projeto de cada um e as visitas. Entrar no grupo não obriga a nada."
        href={grupo}
        label="Entrar no grupo"
      />
    </>
  )
}
