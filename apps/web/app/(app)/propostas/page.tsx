import type { Metadata } from "next"
import Link from "next/link"
import { HandshakeIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react"
import { z } from "zod"

import { DEFAULT_DISCOUNT_POLICY, type DiscountPolicy } from "@workspace/core/comissoes"
import {
  LISTING_PURPOSE_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPOSAL_STATUS_VALUES,
} from "@workspace/core/properties/enums"
import { isProposalShareActive } from "@workspace/core/proposals/share"
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
import { NewProposalButton } from "@/components/propostas/new-proposal-button"
import type { ProposalPropertyOption } from "@/components/propostas/proposal-form-dialog"
import { ProposalsFilters } from "@/components/propostas/proposals-filters"
import { ProposalsTable, type ProposalTableRow } from "@/components/propostas/proposals-table"
import { StatusTabs } from "@/components/propostas/status-tabs"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import { todayInSaoPaulo } from "@/lib/chaves/datetime"
import { canManageCommissions } from "@/lib/comissoes/permissions"
import { getCommissionSettings } from "@/lib/comissoes/queries"
import { measureProposalDiscount, resolveProposalDiscount } from "@/lib/propostas/discount"
import { getClientOptions, getPropertyOptions, getTeamMembers } from "@/lib/propostas/options"
import { canUpdateProposal, COMMERCIAL_ROLES, isSelfBrokerRole } from "@/lib/propostas/permissions"
import {
  listProposalDiscountRequests,
  listProposals,
  type ProposalPurpose,
  type ProposalShareInfo,
} from "@/lib/propostas/queries"
import { isProposalExpired, PROPOSAL_STATUS_LABELS } from "@/lib/propostas/status"
import { createClient } from "@/lib/supabase/server"
import { buildProposalShareUrl } from "@/lib/tenant/urls"

export const metadata: Metadata = {
  title: "Propostas",
}

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function guidParam(value: string | string[] | undefined) {
  const first = firstValue(value)
  return first && z.guid().safeParse(first).success ? first : null
}

/**
 * Endereço do link público, só quando ele existe e está no prazo (espelho do
 * `expires_at > now()` da RPC). Sem o endereço público configurado, a tela
 * segue funcionando sem o link.
 */
function proposalShareUrl(slug: string, share: ProposalShareInfo | null) {
  const token = share?.token

  if (!token || !isProposalShareActive({ token, expiresAt: share?.expiresAt ?? null })) {
    return null
  }

  try {
    return buildProposalShareUrl(slug, token)
  } catch {
    return null
  }
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Trava de desconto da imobiliária. Se os ajustes não carregarem, a lista abre
 * sem o aviso: quem garante a regra é o gatilho do banco, e a recusa dele já
 * oferece pedir a aprovação na hora de enviar ou aceitar.
 */
async function getDiscountPolicy(
  supabase: ServerClient,
  organizationId: string
): Promise<DiscountPolicy> {
  try {
    const settings = await getCommissionSettings(supabase, organizationId)

    return {
      approvalEnabled: settings.discountApprovalEnabled,
      maxDiscountPercent: settings.maxDiscountPercent,
    }
  } catch {
    return DEFAULT_DISCOUNT_POLICY
  }
}

export default async function PropostasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const [{ user, membership }, params] = await Promise.all([requireMembership(), searchParams])

  const statusParam = firstValue(params.status)
  const status = PROPOSAL_STATUS_VALUES.find((value) => value === statusParam) ?? null
  const propertyId = guidParam(params.imovel)
  const brokerId = guidParam(params.corretor)
  const purposeParam = firstValue(params.finalidade)
  const purpose: ProposalPurpose | null =
    purposeParam === "sale" || purposeParam === "rent" ? purposeParam : null
  const hasFilters = Boolean(status || propertyId || brokerId || purpose)

  const organizationId = membership.organizationId
  const role = membership.role
  const isCommercial = COMMERCIAL_ROLES.includes(role)
  const supabase = await createClient()

  const [{ rows, counts }, properties, members, clients, discountPolicy] = await Promise.all([
    listProposals(supabase, organizationId, {
      status,
      propertyId,
      brokerId,
      purpose,
    }),
    getPropertyOptions(supabase, organizationId),
    getTeamMembers(supabase, organizationId),
    isCommercial ? getClientOptions(supabase, organizationId) : Promise.resolve([]),
    getDiscountPolicy(supabase, organizationId),
  ])

  // Pedidos de desconto só das propostas que o gatilho vai barrar.
  const discountMeasures = new Map(
    rows.flatMap((row) => {
      const measure = measureProposalDiscount(discountPolicy, row)
      return measure ? [[row.id, measure] as const] : []
    })
  )
  // Sem os pedidos, o selo mostraria "pedir aprovação" onde já há pedido em
  // aberto ou aprovado: melhor abrir a lista sem o aviso (o gatilho segue valendo).
  const discountRequests = await listProposalDiscountRequests(supabase, organizationId, [
    ...discountMeasures.keys(),
  ]).catch(() => null)

  const today = todayInSaoPaulo()
  const tableRows: ProposalTableRow[] = rows.map((row) => {
    const measure = discountMeasures.get(row.id)

    return {
      ...row,
      canUpdate: row.property
        ? canUpdateProposal(role, user.id, { brokerId: row.brokerId }, row.property)
        : false,
      isExpired: isProposalExpired(row, today),
      shareUrl: proposalShareUrl(membership.organization.slug, row.share),
      discount:
        measure && discountRequests
          ? resolveProposalDiscount(measure, discountRequests.get(row.id) ?? [])
          : null,
    }
  })

  const brokers = members
    .filter((member) => COMMERCIAL_ROLES.includes(member.role))
    .map(({ value, label }) => ({ value, label }))
  const propertyFilterOptions = properties.map(({ value, label }) => ({
    value,
    label,
  }))
  const propertyFormOptions: ProposalPropertyOption[] = properties.map((property) => ({
    value: property.value,
    label: property.label,
    description: `${PROPERTY_STATUS_LABELS[property.status]} · ${LISTING_PURPOSE_LABELS[property.purpose]}`,
    purpose: property.purpose,
  }))
  const selectedProperty = properties.find((property) => property.value === propertyId)
  const lockBroker = isSelfBrokerRole(role)
  const defaultBrokerId =
    lockBroker || brokers.some((broker) => broker.value === user.id) ? user.id : ""
  const expiredCount = tableRows.filter((row) => row.isExpired).length
  // O rascunho local do formulário já nasce com o escopo, sem Server Action ao abrir.
  const draftScope = { userId: user.id, organizationId }

  const statusItems = PROPOSAL_STATUS_VALUES.map((value) => ({
    value,
    label: PROPOSAL_STATUS_LABELS[value],
    count: counts[value],
  }))

  return (
    <PageShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Propostas"
          description={
            selectedProperty
              ? `Propostas do imóvel ${selectedProperty.label}.`
              : "Propostas com valor, condições e status da negociação."
          }
        />
        {isCommercial && properties.length > 0 ? (
          <NewProposalButton
            properties={propertyFormOptions}
            clients={clients}
            brokers={brokers}
            defaultPropertyId={propertyId ?? undefined}
            defaultBrokerId={defaultBrokerId}
            lockBroker={lockBroker}
            draftScope={draftScope}
          />
        ) : null}
      </div>

      <StatusTabs items={statusItems} allLabel="Todas" allCount={counts.all} />

      <ProposalsFilters properties={propertyFilterOptions} brokers={brokers} />

      {expiredCount > 0 ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            {expiredCount === 1
              ? "1 proposta vencida sem decisão"
              : `${expiredCount} propostas vencidas sem decisão`}
          </AlertTitle>
          <AlertDescription>
            A validade passou e a proposta continua em negociação. Renove a validade, registre a
            decisão ou retire a proposta.
          </AlertDescription>
        </Alert>
      ) : null}

      {tableRows.length > 0 ? (
        <ProposalsTable
          rows={tableRows}
          properties={propertyFormOptions}
          clients={clients}
          brokers={brokers}
          organizationName={membership.organization.name}
          canReviewDiscounts={canManageCommissions(role)}
          draftScope={draftScope}
        />
      ) : hasFilters ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma proposta encontrada</EmptyTitle>
            <EmptyDescription>
              Nenhuma proposta corresponde aos filtros escolhidos.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href="/propostas" />} nativeButton={false}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HandshakeIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma proposta registrada</EmptyTitle>
            <EmptyDescription>
              {properties.length === 0
                ? "Cadastre imóveis e clientes para registrar as propostas recebidas."
                : isCommercial && clients.length === 0
                  ? "Cadastre o cliente interessado para registrar a primeira proposta."
                  : "Registre as propostas dos clientes para acompanhar valores, condições e decisões."}
            </EmptyDescription>
          </EmptyHeader>
          {properties.length === 0 || (isCommercial && clients.length === 0) ? (
            <EmptyContent>
              <Button
                variant="outline"
                render={<Link href={properties.length === 0 ? "/imoveis" : "/clientes"} />}
                nativeButton={false}
              >
                {properties.length === 0 ? "Ir para imóveis" : "Ir para clientes"}
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </PageShell>
  )
}
