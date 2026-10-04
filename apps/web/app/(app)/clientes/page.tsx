import type { Metadata } from "next"
import Link from "next/link"
import { FilterXIcon, PlusIcon, TriangleAlertIcon, UsersIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { ClientFilters } from "@/components/clientes/client-filters"
import { ClientsPagination } from "@/components/clientes/clients-pagination"
import { ClientsTable } from "@/components/clientes/clients-table"
import { PageHeading } from "@/components/crm/page-placeholder"
import { ImportSheetLink } from "@/components/importacao/import-sheet-link"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import { CLIENTS_PAGE_SIZE, CLIENTS_PATH } from "@/lib/clientes/constants"
import {
  buildClientListHref,
  hasActiveClientFilters,
  parseClientListFilters,
  type RawSearchParams,
} from "@/lib/clientes/filters"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { canCreateClients } from "@/lib/clientes/permissions"
import { IMPORT_ROLES } from "@/lib/importacao/constants"
import { listClients, listClientTags } from "@/lib/clientes/queries"

export const metadata: Metadata = {
  title: "Clientes",
}

type ClientesPageProps = {
  searchParams: Promise<RawSearchParams>
}

export default async function ClientesPage({ searchParams }: ClientesPageProps) {
  const [{ membership }, params] = await Promise.all([requireMembership(), searchParams])
  const organizationId = membership.organizationId
  const filters = parseClientListFilters(params)

  const [result, members, tags] = await Promise.all([
    listClients(organizationId, filters),
    getOrganizationMembers(organizationId),
    listClientTags(organizationId),
  ])

  const totalPages = Math.max(1, Math.ceil(result.total / CLIENTS_PAGE_SIZE))
  const canCreate = canCreateClients(membership.role)
  const canImport = IMPORT_ROLES.includes(membership.role)
  const isFiltered = hasActiveClientFilters(filters)

  const description =
    membership.role === "broker"
      ? "Clientes atribuídos a você ou compartilhados com você."
      : membership.role === "capturer"
        ? "Clientes que você cadastrou e proprietários de imóveis."
        : "Pessoas e empresas, com histórico, documentos e perfil de busca."

  return (
    <PageShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading title="Clientes" description={description} />
        {canCreate ? (
          <Button render={<Link href={`${CLIENTS_PATH}/novo`} />} nativeButton={false}>
            <PlusIcon data-icon="inline-start" />
            Novo cliente
          </Button>
        ) : null}
      </div>

      <ClientFilters
        filters={filters}
        members={members}
        tags={tags}
        showAssigneeFilter={membership.role !== "broker"}
      />

      {result.failed ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Não foi possível carregar os clientes</AlertTitle>
          <AlertDescription>
            Pode ser uma instabilidade momentânea. Recarregue a página em instantes.
          </AlertDescription>
        </Alert>
      ) : result.rows.length > 0 ? (
        <div className="flex flex-col gap-4">
          <ClientsTable rows={result.rows} members={members} />
          <ClientsPagination filters={filters} total={result.total} totalPages={totalPages} />
        </div>
      ) : result.total > 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>Esta página não tem clientes</EmptyTitle>
            <EmptyDescription>
              A lista tem {totalPages} página(s). Volte para a primeira.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              render={<Link href={buildClientListHref({ ...filters, pagina: 1 })} />}
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
            <EmptyTitle>Nenhum cliente encontrado</EmptyTitle>
            <EmptyDescription>
              Nenhum cliente corresponde à busca e aos filtros escolhidos.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href={CLIENTS_PATH} />} nativeButton={false}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum cliente por aqui</EmptyTitle>
            <EmptyDescription>
              {canCreate
                ? "Cadastre compradores, inquilinos e proprietários para acompanhar visitas, documentos e o perfil de busca de cada um."
                : "Ainda não há clientes visíveis para o seu papel nesta imobiliária."}
            </EmptyDescription>
          </EmptyHeader>
          {canCreate || canImport ? (
            <EmptyContent>
              <div className="flex flex-wrap justify-center gap-2">
                {canCreate ? (
                  <Button render={<Link href={`${CLIENTS_PATH}/novo`} />} nativeButton={false}>
                    <PlusIcon data-icon="inline-start" />
                    Cadastrar cliente
                  </Button>
                ) : null}
                {canImport ? <ImportSheetLink /> : null}
              </div>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </PageShell>
  )
}
