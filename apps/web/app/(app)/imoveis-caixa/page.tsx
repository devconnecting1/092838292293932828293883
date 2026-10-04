import type { Metadata } from "next"
import Link from "next/link"
import { LandmarkIcon, SearchXIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { CaixaFilters } from "@/components/caixa/caixa-filters"
import { CaixaListingCard } from "@/components/caixa/caixa-listing-card"
import { CaixaSourceNotice } from "@/components/caixa/caixa-source-notice"
import { PageHeading } from "@/components/crm/page-placeholder"
import { ListPagination } from "@/components/imoveis/list-pagination"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import { CAIXA_BASE_PATH, CAIXA_MISSING_FIELDS_NOTICE } from "@/lib/caixa/constants"
import {
  caixaFiltersToSearchParams,
  getCaixaCatalogStatus,
  getCaixaFacets,
  hasActiveCaixaFilters,
  listCaixaListings,
  parseCaixaListFilters,
} from "@/lib/caixa/list-queries"
import { areCaixaPhotosEnabled } from "@/lib/caixa/photos"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Imóveis da Caixa",
}

const countFormat = new Intl.NumberFormat("pt-BR")

type CaixaPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ImoveisCaixaPage({ searchParams }: CaixaPageProps) {
  const [{ membership }, params] = await Promise.all([requireMembership(), searchParams])
  const filters = parseCaixaListFilters(params)
  const supabase = await createClient()

  const [result, facets, status] = await Promise.all([
    listCaixaListings(supabase, membership.organizationId, filters),
    getCaixaFacets(supabase, filters.uf),
    getCaixaCatalogStatus(supabase),
  ])

  const filtered = hasActiveCaixaFilters(filters)
  const filterParams = caixaFiltersToSearchParams(filters)
  // Um único valor decide as fotos da lista e as da página do imóvel.
  const photosEnabled = areCaixaPhotosEnabled()

  return (
    <PageShell>
      <PageHeading
        title="Imóveis da Caixa"
        description="Os imóveis que a Caixa Econômica Federal vende — leilão, licitação e venda direta — para você filtrar e ligar aos seus clientes. Não consome o seu limite de imóveis próprios."
      />

      <CaixaSourceNotice status={status} />

      <Card>
        <CardContent>
          <CaixaFilters
            facets={facets}
            defaults={{
              q: filters.q,
              uf: filters.uf,
              cidade: filters.city,
              bairro: filters.neighborhood,
              tipo: filters.type,
              modalidade: filters.saleMode,
              precoMin: filters.minPrice == null ? "" : String(filters.minPrice),
              precoMax: filters.maxPrice == null ? "" : String(filters.maxPrice),
              financiamento: filters.financing == null ? "" : filters.financing ? "sim" : "nao",
              favoritos: filters.onlyFavorites ? "1" : "",
              ordenar: filters.sort === "novidades" ? "" : filters.sort,
            }}
          />
        </CardContent>
      </Card>

      {result.items.length > 0 ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.total === 1
              ? "1 imóvel encontrado"
              : `${countFormat.format(result.total)} imóveis encontrados`}
            {result.pageCount > 1 ? ` · página ${result.page} de ${result.pageCount}` : ""}
          </p>
          {/* Duas colunas a partir de 576 px de largura útil. O contêiner é o
              "page": nesta casca (fluid simples) não existe o "main". */}
          <div className="grid grid-cols-1 gap-4 @min-[36rem]/page:grid-cols-2">
            {result.items.map((item) => (
              <CaixaListingCard key={item.numero} item={item} photosEnabled={photosEnabled} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{CAIXA_MISSING_FIELDS_NOTICE}</p>
          <ListPagination
            basePath={CAIXA_BASE_PATH}
            searchParams={filterParams}
            page={result.page}
            pageCount={result.pageCount}
          />
        </div>
      ) : result.outOfRange ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Esta página não existe</EmptyTitle>
            <EmptyDescription>A lista tem menos páginas do que o endereço pediu.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              render={
                <Link
                  href={filterParams.size ? `${CAIXA_BASE_PATH}?${filterParams}` : CAIXA_BASE_PATH}
                />
              }
              nativeButton={false}
            >
              Ir para a primeira página
            </Button>
          </EmptyContent>
        </Empty>
      ) : filtered ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum imóvel encontrado</EmptyTitle>
            <EmptyDescription>
              Nenhum imóvel da Caixa corresponde aos filtros. Ajuste a busca ou limpe os filtros.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href={CAIXA_BASE_PATH} />} nativeButton={false}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LandmarkIcon />
            </EmptyMedia>
            <EmptyTitle>O catálogo da Caixa ainda está sendo carregado.</EmptyTitle>
            <EmptyDescription>Volte em breve.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </PageShell>
  )
}
