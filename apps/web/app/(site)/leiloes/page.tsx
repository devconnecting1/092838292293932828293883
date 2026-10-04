import type { Metadata } from "next"
import Link from "next/link"

import { ListingCard } from "@/components/portal/listing-card"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import {
  filtersToParams,
  getPortalFacets,
  parsePortalFilters,
  searchPortalListings,
  TIPOS_FILTRO,
} from "@/lib/portal/caixa"
import { BRAZILIAN_STATES } from "@workspace/core/br/states"

export const metadata: Metadata = {
  title: "Leilões de imóveis da Caixa em todo o Brasil",
  description: "Busque imóveis da Caixa por estado, cidade, tipo, desconto e financiamento.",
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function LeiloesPage({ searchParams }: Props) {
  const filters = parsePortalFilters(await searchParams)
  const [result, facets] = await Promise.all([
    searchPortalListings(filters),
    getPortalFacets(filters.uf),
  ])
  const photos = areCaixaPhotosEnabled()
  const base = filtersToParams(filters)
  const pageHref = (page: number) => {
    const p = new URLSearchParams(base)
    if (page > 1) p.set("pagina", String(page))
    const qs = p.toString()
    return `/leiloes${qs ? `?${qs}` : ""}`
  }
  const lugar = filters.cidade ? `${filters.cidade}/${filters.uf}` : filters.uf || "todo o Brasil"

  return (
    <div className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-7 px-4 py-8 sm:px-6">
      <aside
        id="filtros"
        className="order-2 w-full scroll-mt-20 rounded-2xl border border-slate-200 p-5 lg:sticky lg:top-24 lg:order-1 lg:w-72"
      >
        <form action="/leiloes" className="flex flex-col gap-4">
          <span className="text-lg font-extrabold">Filtros</span>
          <Field label="Busca">
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Cidade, bairro, endereço ou código"
              className="h-11 rounded-lg border border-slate-300 px-3"
            />
          </Field>
          <Field label="Estado">
            <select
              name="uf"
              defaultValue={filters.uf}
              className="h-11 rounded-lg border border-slate-300 bg-white px-2"
            >
              <option value="">Todo o Brasil</option>
              {BRAZILIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          {filters.uf && facets.cidades.length ? (
            <Field label="Cidade">
              <select
                name="cidade"
                defaultValue={filters.cidade}
                className="h-11 rounded-lg border border-slate-300 bg-white px-2"
              >
                <option value="">Todas</option>
                {facets.cidades.map((c) => (
                  <option key={c.cidade} value={c.cidade}>
                    {c.cidade} ({c.count})
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Tipo">
            <select
              name="tipo"
              defaultValue={filters.tipo}
              className="h-11 rounded-lg border border-slate-300 bg-white px-2"
            >
              <option value="">Todos</option>
              {TIPOS_FILTRO.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Preço até (R$)">
            <input
              name="ate"
              inputMode="numeric"
              defaultValue={filters.maxPreco ?? ""}
              className="h-11 rounded-lg border border-slate-300 px-3"
            />
          </Field>
          <Field label="Desconto mínimo">
            <select
              name="desconto"
              defaultValue={filters.minDesconto ?? ""}
              className="h-11 rounded-lg border border-slate-300 bg-white px-2"
            >
              <option value="">Qualquer</option>
              <option value="30">30% ou mais</option>
              <option value="50">50% ou mais</option>
              <option value="70">70% ou mais</option>
            </select>
          </Field>
          <Field label="Financiamento">
            <select
              name="financiamento"
              defaultValue={
                filters.financiamento == null ? "" : filters.financiamento ? "sim" : "nao"
              }
              className="h-11 rounded-lg border border-slate-300 bg-white px-2"
            >
              <option value="">Tanto faz</option>
              <option value="sim">Aceita financiamento</option>
              <option value="nao">Só à vista</option>
            </select>
          </Field>
          <Field label="Ordenar por">
            <select
              name="ordem"
              defaultValue={filters.sort}
              className="h-11 rounded-lg border border-slate-300 bg-white px-2"
            >
              <option value="desconto">Maior desconto</option>
              <option value="preco_asc">Menor preço</option>
              <option value="preco_desc">Maior preço</option>
              <option value="novidades">Mais recentes</option>
            </select>
          </Field>
          <button className="h-12 rounded-lg bg-[var(--brand)] font-bold text-white">
            Aplicar filtros
          </button>
          <Link href="/leiloes" className="text-center text-sm font-semibold text-slate-600">
            Limpar filtros
          </Link>
        </form>
      </aside>

      <section className="order-1 min-w-0 flex-1 lg:order-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Leilões da Caixa em {lugar}
          </h1>
          <a
            href="#filtros"
            className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold lg:hidden"
          >
            Filtrar
          </a>
        </div>
        <p className="mt-1 text-slate-600">
          {result.total.toLocaleString("pt-BR")} imóve{result.total === 1 ? "l" : "is"} encontrado
          {result.total === 1 ? "" : "s"}
        </p>
        {result.items.length ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {result.items.map((item) => (
              <ListingCard key={item.numero} item={item} photos={photos} />
            ))}
          </div>
        ) : (
          <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-600">
            Nenhum imóvel com esses filtros. Tente ampliar a busca.
          </p>
        )}
        {result.pageCount > 1 ? (
          <nav aria-label="Paginação" className="mt-8 flex items-center justify-center gap-3">
            {filters.page > 1 ? (
              <Link
                href={pageHref(filters.page - 1)}
                className="rounded-lg border border-slate-300 px-4 py-2.5 font-semibold"
              >
                Anterior
              </Link>
            ) : null}
            <span className="text-sm text-slate-600">
              Página {filters.page} de {result.pageCount}
            </span>
            {filters.page < result.pageCount ? (
              <Link
                href={pageHref(filters.page + 1)}
                className="rounded-lg border border-slate-300 px-4 py-2.5 font-semibold"
              >
                Próxima
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-bold text-slate-600">
      {label}
      {children}
    </label>
  )
}
