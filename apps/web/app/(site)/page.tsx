import Link from "next/link"

import { ListingCard } from "@/components/portal/listing-card"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { getPortalFacets, searchPortalListings, TIPOS_FILTRO } from "@/lib/portal/caixa"
import { PORTAL } from "@/lib/portal/config"
import { BRAZILIAN_STATES } from "@workspace/core/br/states"

export const revalidate = 600

export default async function PortalHome() {
  const [destaques, facets] = await Promise.all([
    searchPortalListings(
      {
        q: "",
        uf: "",
        cidade: "",
        tipo: "",
        financiamento: null,
        minDesconto: 40,
        maxPreco: null,
        sort: "desconto",
        page: 1,
      },
      8
    ),
    getPortalFacets(),
  ])
  const photos = areCaixaPhotosEnabled()

  return (
    <>
      <section className="bg-[var(--brand-soft)]">
        <div className="mx-auto grid max-w-[1240px] items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-20">
          <div className="flex flex-col gap-5">
            <span className="self-start rounded-full bg-white px-3 py-1.5 text-sm font-bold text-[var(--brand-deep)]">
              Atendimento em todo o Brasil
            </span>
            <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-5xl">
              Imóvel de leilão abaixo da avaliação, para morar ou para investir.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-slate-700">
              Leilões da Caixa em todos os estados, com a conta dos custos antes do lance e
              assessoria até a chave na mão.
            </p>
            <form
              action="/leiloes"
              className="flex max-w-2xl flex-col gap-2 rounded-2xl bg-white p-3 shadow-lg sm:flex-row sm:items-end"
            >
              <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-slate-600">
                Cidade, bairro ou código
                <input
                  name="q"
                  placeholder="Ex.: Nova Iguaçu"
                  className="h-12 rounded-lg border border-slate-300 px-3 text-base text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:w-36">
                Estado
                <select
                  name="uf"
                  defaultValue=""
                  className="h-12 rounded-lg border border-slate-300 bg-white px-2 text-base text-slate-900"
                >
                  <option value="">Todos</option>
                  {BRAZILIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:w-44">
                Tipo
                <select
                  name="tipo"
                  defaultValue=""
                  className="h-12 rounded-lg border border-slate-300 bg-white px-2 text-base text-slate-900"
                >
                  <option value="">Todos</option>
                  {TIPOS_FILTRO.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="h-12 rounded-lg bg-[var(--brand)] px-6 font-bold text-white hover:opacity-90">
                Buscar
              </button>
            </form>
            {facets.total > 0 ? (
              <span className="text-sm text-slate-600">
                {facets.total.toLocaleString("pt-BR")} imóveis da Caixa disponíveis agora
                {facets.atualizadoEm
                  ? `, lista de ${new Date(facets.atualizadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                  : ""}
                .
              </span>
            ) : null}
          </div>
          <div className="grid gap-3">
            <PromoCard
              href="/servicos/imissao-na-posse-amigavel"
              tag="Serviço em destaque"
              title="Imissão na posse amigável"
              text="O imóvel veio ocupado? Negociamos a saída do ocupante com prazo e termo assinado, sem briga e sem demora desnecessária."
            />
            <PromoCard
              href="/servicos/notificacao-extrajudicial"
              tag="Serviço em destaque"
              title="Notificação extrajudicial"
              text="O primeiro passo formal para cobrar, pedir a desocupação ou registrar um aviso com prova de entrega."
            />
            <PromoCard
              href="/credito"
              tag="Antes do lance"
              title="Avalie seu crédito"
              text="Descubra quanto pode financiar antes de escolher o imóvel."
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 py-14 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Maiores descontos agora</h2>
            <p className="mt-1 text-slate-600">
              Imóveis da Caixa com 40% ou mais abaixo da avaliação.
            </p>
          </div>
          <Link href="/leiloes?desconto=40" className="font-bold text-[var(--brand)]">
            Ver todos
          </Link>
        </div>
        {destaques.items.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {destaques.items.map((item) => (
              <ListingCard key={item.numero} item={item} photos={photos} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600">
            A lista de imóveis está sendo atualizada. Volte em instantes.
          </p>
        )}
      </section>

      <section id="perfis" className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-[1240px] px-4 py-14 sm:px-6">
          <h2 className="mb-6 text-3xl font-extrabold tracking-tight">Como você quer participar</h2>
          <div className="grid gap-5 md:grid-cols-3">
            <Step
              n="1"
              t="Comprador final"
              d="Quer um imóvel para morar pagando menos. Um corretor parceiro acompanha você do edital à chave."
            />
            <Step
              n="2"
              t="Investidor"
              d="Compra para revender ou alugar. Acesso grátis; anuncia em parceria 50/50 ou com pacote de anúncio."
            />
            <Step
              n="3"
              t="Corretor com CRECI"
              d="Página grátis com o seu nome e todos os leilões, Selo Verde e assessoria por trás."
            />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/como-funciona"
              className="rounded-xl bg-[var(--brand)] px-5 py-3.5 font-bold text-white"
            >
              Entender como funciona o leilão
            </Link>
            <Link
              href="/corretores"
              className="rounded-xl border border-slate-300 bg-white px-5 py-3.5 font-bold"
            >
              Sou corretor
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 py-14 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-3xl bg-[var(--brand-deep)] p-8 text-white sm:p-12">
          <div className="max-w-2xl">
            <span className="text-sm font-bold tracking-wider uppercase opacity-85">
              Para corretores
            </span>
            <h2 className="mt-2 text-3xl leading-tight font-extrabold">
              Além de vender, um profissional completo.
            </h2>
            <p className="mt-3 leading-relaxed opacity-90">
              Vistoria, avaliação, diligência e desocupação amigável: serviços que geram renda entre
              uma venda e outra.
            </p>
          </div>
          <Link
            href="/corretores"
            className="rounded-xl bg-white px-6 py-4 font-extrabold text-[var(--brand-deep)]"
          >
            Criar minha página grátis
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {PORTAL.name} · {PORTAL.creci}
        </p>
      </section>
    </>
  )
}

function PromoCard({
  href,
  tag,
  title,
  text,
}: {
  href: string
  tag: string
  title: string
  text: string
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:ring-[var(--brand)]"
    >
      <span className="text-xs font-extrabold tracking-wider text-[var(--brand)] uppercase">
        {tag}
      </span>
      <span className="text-lg font-extrabold">{title}</span>
      <span className="text-sm leading-relaxed text-slate-600">{text}</span>
    </Link>
  )
}

function Step({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-white p-6">
      <span className="flex size-9 items-center justify-center rounded-full bg-[var(--brand)] font-extrabold text-white">
        {n}
      </span>
      <span className="text-lg font-extrabold">{t}</span>
      <span className="leading-relaxed text-slate-600">{d}</span>
    </div>
  )
}
