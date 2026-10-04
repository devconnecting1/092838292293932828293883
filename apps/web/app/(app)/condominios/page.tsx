import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { BuildingIcon, RotateCwIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { CondominiumSearchForm } from "@/components/condominios/condominium-search-form"
import { CondominiumsCards, CondominiumsTable } from "@/components/condominios/condominiums-list"
import { CondominiumsPagination } from "@/components/condominios/condominiums-pagination"
import { NewCondominiumButton } from "@/components/condominios/new-condominium-button"
import { PageHeading } from "@/components/crm/page-placeholder"
import { SupportHelpButton } from "@/components/crm/support-help-button"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import { CONDOMINIUMS_PAGE_SIZE, listCondominiums } from "@/lib/condominios/queries"
import {
  buildCondominiumsHref,
  CONDOMINIUMS_PATH,
  parsePageParam,
  readSearchQuery,
  sanitizeCondominiumSearch,
} from "@/lib/condominios/search"
import { canCreateCondominium } from "@/lib/imoveis/permissions"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Condomínios",
}

type CondominiosPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CondominiosPage({ searchParams }: CondominiosPageProps) {
  const [{ membership }, params] = await Promise.all([requireMembership(), searchParams])

  const query = readSearchQuery(params.q)
  const term = sanitizeCondominiumSearch(query)
  const page = parsePageParam(params.pagina)
  const canCreate = canCreateCondominium(membership.role)

  const supabase = await createClient()
  const result = await listCondominiums(supabase, membership.organizationId, {
    term,
    page,
  })

  // Página além do total (link antigo ou itens excluídos): volta para a primeira.
  if (
    page > 1 &&
    (result.status === "out-of-range" || (result.status === "ok" && result.rows.length === 0))
  ) {
    redirect(buildCondominiumsHref({ query }))
  }

  const currentHref = buildCondominiumsHref({ query, page })

  return (
    <PageShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Condomínios"
          description="Condomínios e empreendimentos com infraestrutura e taxa média, para vincular aos imóveis."
        />
        {canCreate ? <NewCondominiumButton /> : null}
      </div>

      <CondominiumSearchForm query={query} />

      {result.status !== "ok" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Não foi possível carregar os condomínios</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <p>Tente novamente em instantes. Se o problema continuar, chame o suporte.</p>
            <SupportHelpButton label="Chamar o suporte" />
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={currentHref} />}
              nativeButton={false}
            >
              <RotateCwIcon data-icon="inline-start" />
              Tentar de novo
            </Button>
          </AlertAction>
        </Alert>
      ) : result.total === 0 && query ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum condomínio encontrado</EmptyTitle>
            <EmptyDescription>
              Nada corresponde a “{query}”. Confira a grafia ou busque por outro nome, bairro ou
              cidade.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              render={<Link href={CONDOMINIUMS_PATH} />}
              nativeButton={false}
            >
              Limpar busca
            </Button>
          </EmptyContent>
        </Empty>
      ) : result.total === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BuildingIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum condomínio cadastrado</EmptyTitle>
            <EmptyDescription>
              {canCreate
                ? "Cadastre os condomínios com endereço, infraestrutura e taxa média para reaproveitar os dados em todos os imóveis."
                : "Quando a equipe cadastrar condomínios, eles aparecerão aqui."}
            </EmptyDescription>
          </EmptyHeader>
          {canCreate ? (
            <EmptyContent>
              <NewCondominiumButton />
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <section aria-label="Lista de condomínios" className="flex flex-col gap-4">
          <CondominiumsTable rows={result.rows} />
          <CondominiumsCards rows={result.rows} />
          <CondominiumsPagination
            page={page}
            pageSize={CONDOMINIUMS_PAGE_SIZE}
            total={result.total}
            query={query}
          />
        </section>
      )}
    </PageShell>
  )
}
