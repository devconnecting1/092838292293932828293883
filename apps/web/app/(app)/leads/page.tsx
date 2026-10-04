import type { Metadata } from "next"
import { headers } from "next/headers"
import Link from "next/link"
import { FilterXIcon, InboxIcon, PlusIcon, TriangleAlertIcon } from "lucide-react"

import {
  defaultLeadViewForRequest,
  resolveLeadView,
  withLeadView,
} from "@workspace/core/leads/initial-view"
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

import { PageHeading } from "@/components/crm/page-placeholder"
import { LeadFilters } from "@/components/leads/lead-filters"
import { LeadsSummary } from "@/components/leads/leads-summary"
import { LeadsWorkspace } from "@/components/leads/leads-workspace"
import { ImportSheetLink } from "@/components/importacao/import-sheet-link"
import { NewLeadDialog } from "@/components/leads/new-lead-dialog"
import { requireMembership } from "@/lib/auth/session"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { IMPORT_ROLES } from "@/lib/importacao/constants"
import { LEADS_LIST_LIMIT, LEADS_PATH } from "@/lib/leads/constants"
import { createLeadsClient } from "@/lib/leads/db"
import {
  hasActiveLeadFilters,
  LEAD_PERIOD_LABELS,
  parseLeadListFilters,
  type LeadListFilters,
  type RawSearchParams,
} from "@/lib/leads/filters"
import { canCreateLeads, canSeeLeadTrackingIds, canViewAllLeads } from "@/lib/leads/permissions"
import {
  countLeads,
  getLeadSummary,
  listLandingPages,
  listLeadCampaigns,
  listLeads,
} from "@/lib/leads/queries"
import { getLeadSlaSettings } from "@/lib/leads/sla"

export const metadata: Metadata = {
  title: "Leads",
}

type LeadsPageProps = {
  searchParams: Promise<RawSearchParams>
}

export default async function LeadsPage({ searchParams }: LeadsPageProps) {
  const [{ user, membership }, params, requestHeaders] = await Promise.all([
    requireMembership(),
    searchParams,
    headers(),
  ])
  const organizationId = membership.organizationId
  const role = membership.role
  // Sem `?visao=`, a visão inicial sai já do servidor pelo aparelho do pedido
  // (lista em cartões no celular, quadro no computador): o quadro não pisca no
  // celular antes da troca. Nada é redirecionado.
  const defaultView = defaultLeadViewForRequest({
    secChUaMobile: requestHeaders.get("sec-ch-ua-mobile"),
    userAgent: requestHeaders.get("user-agent"),
  })
  const filters: LeadListFilters = {
    ...parseLeadListFilters(params),
    visao: resolveLeadView(params.visao, defaultView),
  }
  const now = new Date()
  const supabase = await createLeadsClient()

  // O prazo de 1º contato é configurável por imobiliária: vem antes do resumo,
  // que conta "fora do prazo" com ele.
  const sla = await getLeadSlaSettings(supabase, organizationId)

  const [landingPages, members, campaigns, summary] = await Promise.all([
    listLandingPages(supabase, organizationId),
    getOrganizationMembers(organizationId),
    listLeadCampaigns(supabase, organizationId),
    getLeadSummary(supabase, organizationId, now, sla.slaMinutes),
  ])

  const [result, filteredCounts] = await Promise.all([
    listLeads(supabase, {
      organizationId,
      userId: user.id,
      filters,
      now,
      landingPages,
      options: { showTrackingIds: canSeeLeadTrackingIds(role) },
    }),
    countLeads(supabase, { organizationId, userId: user.id, filters, now }),
  ])

  const canCreate = canCreateLeads(role)
  const canImport = IMPORT_ROLES.includes(role)
  const isFiltered = hasActiveLeadFilters(filters)

  const description =
    role === "broker"
      ? "Leads atribuídos a você e os sem responsável, que você pode assumir."
      : role === "capturer" || role === "finance"
        ? "Leads atribuídos a você (somente leitura)."
        : "Contatos das landing pages, portais e site, do primeiro contato até virar cliente."

  const newLeadButton = canCreate ? (
    <NewLeadDialog
      members={members}
      currentUserId={user.id}
      organizationId={organizationId}
      role={role}
      trigger={<Button />}
    >
      <PlusIcon data-icon="inline-start" />
      Novo lead
    </NewLeadDialog>
  ) : null

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading title="Leads" description={description} />
        {newLeadButton}
      </div>

      <LeadsSummary
        counts={summary}
        wonCount={filteredCounts.won}
        totalCount={filteredCounts.total}
        periodLabel={LEAD_PERIOD_LABELS[filters.periodo]}
        slaMinutes={sla.slaMinutes}
      />

      <LeadFilters
        filters={filters}
        members={members}
        landingPages={landingPages}
        campaigns={campaigns}
        showMemberOptions={canViewAllLeads(role)}
        defaultView={defaultView}
      />

      {result.failed ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Não foi possível carregar os leads</AlertTitle>
          <AlertDescription>
            Pode ser uma instabilidade momentânea. Recarregue a página em instantes.
          </AlertDescription>
        </Alert>
      ) : result.leads.length === 0 ? (
        isFiltered ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FilterXIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhum lead encontrado</EmptyTitle>
              <EmptyDescription>Nenhum lead corresponde aos filtros escolhidos.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                render={<Link href={withLeadView(LEADS_PATH, filters.visao)} />}
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
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>Nenhum lead por aqui</EmptyTitle>
              <EmptyDescription>
                Os contatos das landing pages aparecem aqui assim que alguém preenche o formulário.
                {canCreate ? " Você também pode cadastrar um lead que chegou por outro canal." : ""}
              </EmptyDescription>
            </EmptyHeader>
            {newLeadButton || canImport ? (
              <EmptyContent>
                <div className="flex flex-wrap justify-center gap-2">
                  {newLeadButton}
                  {canImport ? <ImportSheetLink /> : null}
                </div>
              </EmptyContent>
            ) : null}
          </Empty>
        )
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {result.truncated ? (
            <Alert>
              <TriangleAlertIcon />
              <AlertTitle>
                Mostrando os {LEADS_LIST_LIMIT.toLocaleString("pt-BR")} leads mais recentes
              </AlertTitle>
              <AlertDescription>
                Use o filtro de período ou de responsável para ver os mais antigos.
              </AlertDescription>
            </Alert>
          ) : null}
          <LeadsWorkspace
            leads={result.leads}
            members={members}
            currentUserId={user.id}
            role={role}
            nowMs={now.getTime()}
            sla={sla}
            view={filters.visao}
          />
        </div>
      )}
    </div>
  )
}
