import type { Metadata } from "next"
import Link from "next/link"
import { Building2Icon, FilterXIcon } from "lucide-react"

import {
  buildOrganizationListHref,
  hasActiveOrganizationFilters,
  parseOrganizationListFilters,
  PLATFORM_ORGANIZATIONS_PATH,
} from "@workspace/core/platform/accounts"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { PageHeading } from "@/components/crm/page-placeholder"
import { OrganizationFilters } from "@/components/plataforma/imobiliarias/organization-filters"
import { OrganizationsPagination } from "@/components/plataforma/imobiliarias/organizations-pagination"
import { OrganizationsTable } from "@/components/plataforma/imobiliarias/organizations-table"
import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { RefreshButton } from "@/components/plataforma/refresh-button"
import { requirePlatformAdmin } from "@/lib/plataforma/admin"
import { listPlatformOrganizations } from "@/lib/plataforma/imobiliarias"

export const metadata: Metadata = {
  title: "Imobiliárias",
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Console da Plataforma: todas as imobiliárias, com plano, situação da
 * assinatura, uso e última atividade. Só contagens: nenhum dado de cliente ou
 * lead das imobiliárias aparece aqui.
 */
export default async function PlatformOrganizationsPage({ searchParams }: PageProps) {
  await requirePlatformAdmin()

  const filters = parseOrganizationListFilters(await searchParams)
  const result = await listPlatformOrganizations(filters)
  const now = new Date()
  const isFiltered = hasActiveOrganizationFilters(filters)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Imobiliárias"
          description="Todas as imobiliárias da plataforma, com plano, situação da assinatura, uso e última atividade. Abra a ficha para ver membros, histórico e ações."
        />
        <RefreshButton />
      </div>

      <OrganizationFilters filters={filters} />

      {!result.ok ? (
        <PlatformRpcFailureAlert failure={result} />
      ) : result.data.rows.length > 0 ? (
        <div className="flex flex-col gap-4">
          <OrganizationsTable rows={result.data.rows} now={now} />
          <OrganizationsPagination
            filters={filters}
            total={result.data.total}
            totalPages={result.data.totalPages}
          />
        </div>
      ) : filters.pagina > 1 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2Icon />
            </EmptyMedia>
            <EmptyTitle>Esta página não tem imobiliárias</EmptyTitle>
            <EmptyDescription>A lista tem menos páginas. Volte para a primeira.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              render={<Link href={buildOrganizationListHref({ ...filters, pagina: 1 })} />}
              nativeButton={false}
            >
              Ir para a primeira página
            </Button>
          </EmptyContent>
        </Empty>
      ) : isFiltered ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FilterXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma imobiliária encontrada</EmptyTitle>
            <EmptyDescription>
              Nenhuma imobiliária corresponde à busca e aos filtros escolhidos.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              render={<Link href={PLATFORM_ORGANIZATIONS_PATH} />}
              nativeButton={false}
            >
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2Icon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma imobiliária ainda</EmptyTitle>
            <EmptyDescription>
              Quando alguém criar uma conta, a imobiliária aparece aqui com o teste grátis.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
