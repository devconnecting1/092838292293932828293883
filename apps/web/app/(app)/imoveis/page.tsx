import type { Metadata } from "next"
import Link from "next/link"
import { HouseIcon, PlusIcon, SearchXIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { OwnedListingsUsageNotice } from "@/components/billing/owned-listings-usage-notice"
import { PageHeading } from "@/components/crm/page-placeholder"
import { ListPagination } from "@/components/imoveis/list-pagination"
import { PropertiesFilters } from "@/components/imoveis/properties-filters"
import { PropertiesList } from "@/components/imoveis/properties-list"
import { PropertiesShortcuts } from "@/components/imoveis/properties-shortcuts"
import { ImportSheetLink } from "@/components/importacao/import-sheet-link"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import {
  filtersToSearchParams,
  hasActiveFilters,
  listProperties,
  parsePropertyListFilters,
} from "@/lib/imoveis/list-queries"
import { canCreateProperty } from "@/lib/imoveis/permissions"
import { IMPORT_ROLES } from "@/lib/importacao/constants"
import { getOrganizationMembers } from "@/lib/imoveis/queries"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Imóveis",
}

const countFormat = new Intl.NumberFormat("pt-BR")

type ImoveisPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ImoveisPage({ searchParams }: ImoveisPageProps) {
  const [{ membership }, params] = await Promise.all([requireMembership(), searchParams])
  const organizationId = membership.organizationId
  const filters = parsePropertyListFilters(params)
  const supabase = await createClient()

  const [result, members] = await Promise.all([
    listProperties(supabase, organizationId, filters),
    getOrganizationMembers(supabase, organizationId),
  ])

  const memberNames = Object.fromEntries(members.map((member) => [member.id, member.name]))
  const filtered = hasActiveFilters(filters)
  const canCreate = canCreateProperty(membership.role)
  const canImport = IMPORT_ROLES.includes(membership.role)
  const filterParams = filtersToSearchParams(filters)

  const newPropertyButton = canCreate ? (
    <Button render={<Link href="/imoveis/novo" />} nativeButton={false} aria-keyshortcuts="n">
      <PlusIcon data-icon="inline-start" />
      Novo imóvel
      <Kbd className="ms-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">
        N
      </Kbd>
    </Button>
  ) : null

  return (
    <PageShell>
      <PropertiesShortcuts canCreate={canCreate} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeading
          title="Imóveis"
          description="Cadastro, fotos, status e publicação nos portais."
        />
        {newPropertyButton}
      </div>

      <OwnedListingsUsageNotice
        organizationId={organizationId}
        organizationSlug={membership.organization.slug}
        isOwner={membership.role === "owner"}
      />

      <Card>
        <CardContent>
          <PropertiesFilters
            defaults={{
              q: filters.q,
              status: filters.status,
              finalidade: filters.purpose,
              tipo: filters.type,
              precoMin: filters.minPrice == null ? "" : String(filters.minPrice),
              precoMax: filters.maxPrice == null ? "" : String(filters.maxPrice),
              quartos: filters.minBedrooms == null ? "" : String(filters.minBedrooms),
              autorizacao: filters.authorization,
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
          <PropertiesList items={result.items} memberNames={memberNames} />
          <ListPagination
            basePath="/imoveis"
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
              render={<Link href={filterParams.size ? `/imoveis?${filterParams}` : "/imoveis"} />}
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
              Nenhum imóvel corresponde aos filtros. Ajuste a busca ou limpe os filtros.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href="/imoveis" />} nativeButton={false}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HouseIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum imóvel cadastrado</EmptyTitle>
            <EmptyDescription>
              {canCreate
                ? "Cadastre o primeiro imóvel. Você pode salvar como rascunho e completar depois."
                : "Quando a equipe cadastrar imóveis, eles aparecem aqui."}
            </EmptyDescription>
          </EmptyHeader>
          {newPropertyButton || canImport ? (
            <EmptyContent>
              <div className="flex flex-wrap justify-center gap-2">
                {newPropertyButton}
                {canImport ? <ImportSheetLink /> : null}
              </div>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </PageShell>
  )
}
