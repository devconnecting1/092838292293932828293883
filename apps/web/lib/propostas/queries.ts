import "server-only"

import type { ProposalRoundKind } from "@workspace/core/proposals/rounds"
import type { Enums } from "@workspace/database/types"

import type { ProposalDiscountRequest } from "@/lib/propostas/discount"
import { getProfileNames } from "@/lib/propostas/options"
import type { ProposalStatus } from "@/lib/propostas/status"
import type { createClient } from "@/lib/supabase/server"

type ServerClient = Awaited<ReturnType<typeof createClient>>

export type ProposalPurpose = "sale" | "rent"

export type ProposalFilters = {
  status: ProposalStatus | null
  propertyId: string | null
  brokerId: string | null
  purpose: ProposalPurpose | null
}

/** Estado do link público da proposta (tabela proposal_shares). */
export type ProposalShareInfo = {
  /** null quando o link foi revogado (o histórico de leitura continua). */
  token: string | null
  expiresAt: string | null
  firstViewedAt: string | null
  lastViewedAt: string | null
  viewCount: number
}

export type ProposalRow = {
  id: string
  status: ProposalStatus
  purpose: ProposalPurpose
  amount: number
  /** Rodada vigente da negociação (1 = proposta inicial). Mantida pelo banco. */
  roundNumber: number
  roundKind: ProposalRoundKind
  paymentTerms: string | null
  conditions: string | null
  validUntil: string | null
  decidedAt: string | null
  createdAt: string
  brokerId: string | null
  brokerLabel: string | null
  propertyId: string
  clientId: string
  property: {
    id: string
    code: string
    title: string
    status: Enums<"property_status">
    capturedBy: string | null
    brokerId: string | null
    /** Preço anunciado: base da conta de desconto (aprovação do gerente). */
    salePrice: number | null
    rentPrice: number | null
  } | null
  client: { id: string; name: string } | null
  share: ProposalShareInfo | null
}

export type ProposalCounts = Record<ProposalStatus | "all", number>

/**
 * Links públicos das propostas listadas, por proposta. Consulta à parte (como
 * os nomes da equipe) para não depender de join embutido do PostgREST.
 */
async function listProposalShares(
  supabase: ServerClient,
  organizationId: string,
  proposalIds: string[]
): Promise<Map<string, ProposalShareInfo>> {
  const shares = new Map<string, ProposalShareInfo>()

  if (proposalIds.length === 0) {
    return shares
  }

  const { data, error } = await supabase
    .from("proposal_shares")
    .select("proposal_id, token, expires_at, first_viewed_at, last_viewed_at, view_count")
    .eq("organization_id", organizationId)
    .in("proposal_id", proposalIds)

  if (error) {
    throw new Error(`Não foi possível carregar os links das propostas (${error.code ?? "erro"}).`)
  }

  for (const row of data) {
    shares.set(row.proposal_id, {
      token: row.token,
      expiresAt: row.expires_at,
      firstViewedAt: row.first_viewed_at,
      lastViewedAt: row.last_viewed_at,
      viewCount: row.view_count,
    })
  }

  return shares
}

export async function listProposals(
  supabase: ServerClient,
  organizationId: string,
  filters: ProposalFilters
): Promise<{ rows: ProposalRow[]; counts: ProposalCounts }> {
  let rowsQuery = supabase
    .from("proposals")
    .select(
      "id, status, purpose, amount, round_number, round_kind, payment_terms, conditions, valid_until, decided_at, created_at, broker_id, property_id, client_id, property:properties!proposals_property_fkey(id, code, title, status, captured_by, broker_id, sale_price, rent_price), client:clients!proposals_client_fkey(id, name)"
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(500)

  // As contagens por status respeitam os demais filtros.
  let countsQuery = supabase
    .from("proposals")
    .select("status")
    .eq("organization_id", organizationId)
    .limit(5000)

  if (filters.propertyId) {
    rowsQuery = rowsQuery.eq("property_id", filters.propertyId)
    countsQuery = countsQuery.eq("property_id", filters.propertyId)
  }

  if (filters.brokerId) {
    rowsQuery = rowsQuery.eq("broker_id", filters.brokerId)
    countsQuery = countsQuery.eq("broker_id", filters.brokerId)
  }

  if (filters.purpose) {
    rowsQuery = rowsQuery.eq("purpose", filters.purpose)
    countsQuery = countsQuery.eq("purpose", filters.purpose)
  }

  if (filters.status) {
    rowsQuery = rowsQuery.eq("status", filters.status)
  }

  const [rowsResult, countsResult] = await Promise.all([rowsQuery, countsQuery])

  if (rowsResult.error) {
    throw new Error(`Não foi possível carregar as propostas (${rowsResult.error.code ?? "erro"}).`)
  }

  if (countsResult.error) {
    throw new Error(`Não foi possível contar as propostas (${countsResult.error.code ?? "erro"}).`)
  }

  const counts: ProposalCounts = {
    all: 0,
    draft: 0,
    sent: 0,
    countered: 0,
    accepted: 0,
    rejected: 0,
    withdrawn: 0,
  }

  for (const row of countsResult.data) {
    counts.all += 1
    counts[row.status] += 1
  }

  const [names, shares] = await Promise.all([
    getProfileNames(
      supabase,
      rowsResult.data.flatMap((row) => (row.broker_id ? [row.broker_id] : []))
    ),
    listProposalShares(
      supabase,
      organizationId,
      rowsResult.data.map((row) => row.id)
    ),
  ])

  const rows: ProposalRow[] = rowsResult.data.map((row) => ({
    id: row.id,
    status: row.status,
    purpose: row.purpose === "rent" ? "rent" : "sale",
    amount: row.amount,
    roundNumber: row.round_number,
    roundKind: row.round_kind,
    paymentTerms: row.payment_terms,
    conditions: row.conditions,
    validUntil: row.valid_until,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    brokerId: row.broker_id,
    brokerLabel: row.broker_id ? (names.get(row.broker_id) ?? "Ex-membro da equipe") : null,
    propertyId: row.property_id,
    clientId: row.client_id,
    property: row.property
      ? {
          id: row.property.id,
          code: row.property.code,
          title: row.property.title,
          status: row.property.status,
          capturedBy: row.property.captured_by,
          brokerId: row.property.broker_id,
          salePrice: row.property.sale_price,
          rentPrice: row.property.rent_price,
        }
      : null,
    client: row.client ? { id: row.client.id, name: row.client.name } : null,
    share: shares.get(row.id) ?? null,
  }))

  return { rows, counts }
}

/**
 * Pedidos de aprovação de desconto das propostas informadas, por proposta e do
 * mais recente para o mais antigo. Vem da RPC list_proposal_discount_requests:
 * entram as propostas que a pessoa edita (corretor da proposta, quem edita o
 * imóvel) e, para dono, gerente e financeiro, todas. Justificativa e resposta do
 * gerente chegam só para a gestão e para quem pediu.
 */
export async function listProposalDiscountRequests(
  supabase: ServerClient,
  organizationId: string,
  proposalIds: string[]
): Promise<Map<string, ProposalDiscountRequest[]>> {
  const requests = new Map<string, ProposalDiscountRequest[]>()

  if (proposalIds.length === 0) {
    return requests
  }

  const { data, error } = await supabase.rpc("list_proposal_discount_requests", {
    p_organization_id: organizationId,
    p_proposal_ids: proposalIds,
  })

  if (error) {
    throw new Error(`Não foi possível carregar os pedidos de desconto (${error.code ?? "erro"}).`)
  }

  for (const row of data) {
    const list = requests.get(row.proposal_id) ?? []

    list.push({
      id: row.id,
      proposalId: row.proposal_id,
      status: row.status,
      amountCents: Number(row.amount_cents),
      referenceCents: Number(row.reference_cents),
      // O gerador tipa como string, mas a RPC devolve null para quem não pode ler.
      reason: row.reason as string | null,
      reviewNote: row.review_note as string | null,
      requestedByMe: row.requested_by_me,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
    })
    requests.set(row.proposal_id, list)
  }

  return requests
}
