import "server-only"

import {
  commissionTotalCents,
  discountPercent,
  needsDiscountApproval,
  type CommissionBasis,
  type CommissionPurpose,
  type CommissionRole,
  type CommissionStatus,
  type DiscountRequestStatus,
} from "@workspace/core/comissoes"

import { createClient } from "@/lib/supabase/server"

// Consultas do comissionamento. O RLS já decide o que cada papel enxerga
// (corretor só as partes dele; dono, gerente e financeiro, tudo): nenhuma
// consulta daqui filtra por usuário para "esconder" — o filtro é do banco.

type ServerClient = Awaited<ReturnType<typeof createClient>>

/** Teto de linhas por consulta (o extrato é paginado por período no futuro). */
const ROW_LIMIT = 300

export type CommissionRuleRow = {
  id: string
  purpose: CommissionPurpose
  basis: CommissionBasis
  percent: number
  fixedCents: number
  split: {
    capturer: number
    seller: number
    manager: number
    agency: number
    partner: number
  }
  note: string | null
  effectiveFrom: string
  effectiveTo: string | null
  createdBy: string | null
}

export type CommissionSettingsRow = {
  managerUserId: string | null
  discountApprovalEnabled: boolean
  maxDiscountPercent: number
  updatedBy: string | null
  updatedAt: string | null
}

export type CommissionDeal = {
  id: string
  purpose: CommissionPurpose
  status: CommissionStatus
  totalCents: number
  dealAmountCents: number
  closedAt: string
  propertyId: string | null
  propertyCode: string | null
  propertyTitle: string | null
  clientName: string | null
  /** Regra congelada no fechamento (o que vale para este negócio). */
  frozenPercent: number | null
  frozenBasis: CommissionBasis | null
  frozenSource: string | null
}

export type CommissionShareRow = {
  id: string
  role: CommissionRole
  percent: number
  amountCents: number
  paidAt: string | null
  paidNote: string | null
  userId: string | null
  partnerName: string | null
  deal: CommissionDeal
}

export type CommissionSummary = {
  pendingCents: number
  paidCents: number
  deals: number
  shares: number
}

export const EMPTY_SUMMARY: CommissionSummary = {
  pendingCents: 0,
  paidCents: 0,
  deals: 0,
  shares: 0,
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "string" ? Number(value) : value
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback
}

function readSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") {
    return { frozenPercent: null, frozenBasis: null, frozenSource: null }
  }

  const record = snapshot as Record<string, unknown>

  return {
    frozenPercent: record.percent == null ? null : toNumber(record.percent),
    frozenBasis: (record.basis as CommissionBasis | undefined) ?? null,
    frozenSource: typeof record.source === "string" ? record.source : null,
  }
}

const RULE_COLUMNS =
  "id, purpose, basis, percent, fixed_cents, capturer_percent, seller_percent, manager_percent, agency_percent, partner_percent, note, effective_from, effective_to, created_by"

function toRuleRow(row: {
  id: string
  purpose: string
  basis: string
  percent: number | string
  fixed_cents: number | string
  capturer_percent: number | string
  seller_percent: number | string
  manager_percent: number | string
  agency_percent: number | string
  partner_percent: number | string
  note: string | null
  effective_from: string
  effective_to: string | null
  created_by: string | null
}): CommissionRuleRow {
  return {
    id: row.id,
    purpose: row.purpose as CommissionPurpose,
    basis: row.basis as CommissionBasis,
    percent: toNumber(row.percent),
    fixedCents: toNumber(row.fixed_cents),
    split: {
      capturer: toNumber(row.capturer_percent),
      seller: toNumber(row.seller_percent),
      manager: toNumber(row.manager_percent),
      agency: toNumber(row.agency_percent),
      partner: toNumber(row.partner_percent),
    },
    note: row.note,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdBy: row.created_by,
  }
}

/** Tabela em vigor por tipo de negócio, mais o histórico fechado. */
export async function getCommissionRules(supabase: ServerClient, organizationId: string) {
  const { data, error } = await supabase
    .from("commission_rules")
    .select(RULE_COLUMNS)
    .eq("organization_id", organizationId)
    .order("effective_from", { ascending: false })
    .limit(ROW_LIMIT)

  if (error) {
    throw new Error(`Não foi possível carregar a tabela de comissão (${error.code ?? "erro"}).`)
  }

  const rules = (data ?? []).map(toRuleRow)

  return {
    current: {
      sale: rules.find((rule) => rule.purpose === "sale" && rule.effectiveTo === null) ?? null,
      rent: rules.find((rule) => rule.purpose === "rent" && rule.effectiveTo === null) ?? null,
    },
    history: rules.filter((rule) => rule.effectiveTo !== null),
  }
}

export async function getCommissionSettings(
  supabase: ServerClient,
  organizationId: string
): Promise<CommissionSettingsRow> {
  const { data, error } = await supabase
    .from("commission_settings")
    .select(
      "manager_user_id, discount_approval_enabled, max_discount_percent, updated_by, updated_at"
    )
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (error) {
    throw new Error(`Não foi possível carregar os ajustes de comissão (${error.code ?? "erro"}).`)
  }

  return {
    managerUserId: data?.manager_user_id ?? null,
    discountApprovalEnabled: data?.discount_approval_enabled ?? false,
    maxDiscountPercent: toNumber(data?.max_discount_percent, 10),
    updatedBy: data?.updated_by ?? null,
    updatedAt: data?.updated_at ?? null,
  }
}

const SHARE_COLUMNS = `
  id, role, percent, amount_cents, paid_at, paid_note, user_id, partner_name,
  commission:commissions!inner(
    id, purpose, status, total_cents, deal_amount_cents, closed_at,
    property_id, property_code, property_title, client_name, rule_snapshot
  )
`

type RawShare = {
  id: string
  role: string
  percent: number | string
  amount_cents: number | string
  paid_at: string | null
  paid_note: string | null
  user_id: string | null
  partner_name: string | null
  commission: {
    id: string
    purpose: string
    status: string
    total_cents: number | string
    deal_amount_cents: number | string
    closed_at: string
    property_id: string | null
    property_code: string | null
    property_title: string | null
    client_name: string | null
    rule_snapshot: unknown
  } | null
}

function toShareRow(row: RawShare): CommissionShareRow | null {
  const commission = row.commission

  if (!commission) {
    return null
  }

  return {
    id: row.id,
    role: row.role as CommissionRole,
    percent: toNumber(row.percent),
    amountCents: toNumber(row.amount_cents),
    paidAt: row.paid_at,
    paidNote: row.paid_note,
    userId: row.user_id,
    partnerName: row.partner_name,
    deal: {
      id: commission.id,
      purpose: commission.purpose as CommissionPurpose,
      status: commission.status as CommissionStatus,
      totalCents: toNumber(commission.total_cents),
      dealAmountCents: toNumber(commission.deal_amount_cents),
      closedAt: commission.closed_at,
      propertyId: commission.property_id,
      propertyCode: commission.property_code,
      propertyTitle: commission.property_title,
      clientName: commission.client_name,
      ...readSnapshot(commission.rule_snapshot),
    },
  }
}

export type StatementFilter = {
  /** Só as partes desta pessoa (o corretor sempre cai aqui pelo RLS). */
  userId?: string | null
  /** "pending" = a receber; "paid" = já recebido. */
  payment?: "all" | "pending" | "paid"
}

/**
 * Extrato: uma linha por parte. Comissão cancelada fica de fora — o que o
 * corretor quer ver é o que entra.
 */
export async function getCommissionStatement(
  supabase: ServerClient,
  organizationId: string,
  filter: StatementFilter = {}
): Promise<CommissionShareRow[]> {
  let query = supabase
    .from("commission_shares")
    .select(SHARE_COLUMNS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT)

  if (filter.userId) {
    query = query.eq("user_id", filter.userId)
  }

  if (filter.payment === "pending") {
    query = query.is("paid_at", null)
  } else if (filter.payment === "paid") {
    query = query.not("paid_at", "is", null)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Não foi possível carregar o extrato (${error.code ?? "erro"}).`)
  }

  const rows: CommissionShareRow[] = []

  for (const row of (data ?? []) as unknown as RawShare[]) {
    const share = toShareRow(row)

    // Comissão cancelada fica de fora do extrato: o que interessa é o que entra.
    if (share && share.deal.status !== "canceled") {
      rows.push(share)
    }
  }

  return rows.sort((a, b) => b.deal.closedAt.localeCompare(a.deal.closedAt))
}

/** Resumo (a receber / recebido) pelo RPC, que respeita o RLS do extrato. */
export async function getCommissionSummary(
  supabase: ServerClient,
  userId: string | null
): Promise<CommissionSummary> {
  // Sem usuário, o parâmetro é omitido e a RPC usa o padrão (null = todo mundo
  // que o RLS deixar ver).
  const { data, error } = await supabase.rpc("commission_summary", {
    p_user_id: userId ?? undefined,
  })

  if (error || !data || typeof data !== "object") {
    return EMPTY_SUMMARY
  }

  const record = data as Record<string, unknown>

  return {
    pendingCents: toNumber(record.pending_cents),
    paidCents: toNumber(record.paid_cents),
    deals: toNumber(record.deals),
    shares: toNumber(record.shares),
  }
}

/** Agrupa o extrato por negócio (visão de quem vê tudo). */
export function groupSharesByDeal(shares: readonly CommissionShareRow[]) {
  const deals = new Map<string, { deal: CommissionDeal; shares: CommissionShareRow[] }>()

  for (const share of shares) {
    const current = deals.get(share.deal.id)

    if (current) {
      current.shares.push(share)
    } else {
      deals.set(share.deal.id, { deal: share.deal, shares: [share] })
    }
  }

  return [...deals.values()]
}

// ---------------------------------------------------------------------------
// Aprovação de desconto
// ---------------------------------------------------------------------------

export type DiscountRequestRow = {
  id: string
  proposalId: string
  status: DiscountRequestStatus
  amountCents: number
  referenceCents: number
  discountPercent: number
  reason: string | null
  reviewNote: string | null
  requestedBy: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
  propertyCode: string | null
  propertyTitle: string | null
  proposalStatus: string | null
}

export async function getDiscountRequests(
  supabase: ServerClient,
  organizationId: string
): Promise<DiscountRequestRow[]> {
  const { data, error } = await supabase
    .from("proposal_discount_requests")
    .select(
      `id, proposal_id, status, amount_cents, reference_cents, discount_percent, reason,
       review_note, requested_by, reviewed_by, reviewed_at, created_at,
       proposal:proposals(id, status, property:properties!proposals_property_fkey(code, title))`
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT)

  if (error) {
    throw new Error(`Não foi possível carregar os pedidos de desconto (${error.code ?? "erro"}).`)
  }

  type RawRequest = {
    id: string
    proposal_id: string
    status: string
    amount_cents: number | string
    reference_cents: number | string
    discount_percent: number | string
    reason: string | null
    review_note: string | null
    requested_by: string | null
    reviewed_by: string | null
    reviewed_at: string | null
    created_at: string
    proposal: {
      status: string | null
      property: { code: string | null; title: string | null } | null
    } | null
  }

  return ((data ?? []) as unknown as RawRequest[]).map((row) => ({
    id: row.id,
    proposalId: row.proposal_id,
    status: row.status as DiscountRequestStatus,
    amountCents: toNumber(row.amount_cents),
    referenceCents: toNumber(row.reference_cents),
    discountPercent: toNumber(row.discount_percent),
    reason: row.reason,
    reviewNote: row.review_note,
    requestedBy: row.requested_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    propertyCode: row.proposal?.property?.code ?? null,
    propertyTitle: row.proposal?.property?.title ?? null,
    proposalStatus: row.proposal?.status ?? null,
  }))
}

export type ProposalNeedingApproval = {
  id: string
  status: string
  brokerId: string | null
  amountCents: number
  referenceCents: number
  discountPercent: number
  propertyCode: string | null
  propertyTitle: string | null
  /** Já existe pedido em aberto ou aprovado para este valor. */
  requestStatus: DiscountRequestStatus | null
}

/**
 * Propostas abertas cujo desconto passa do limite: são as que o banco vai
 * barrar quando alguém tentar enviar ou aceitar. A conta é a mesma do gatilho
 * (private.proposals_require_discount_approval), feita aqui só para listar.
 */
export async function getProposalsNeedingApproval(
  supabase: ServerClient,
  organizationId: string,
  settings: CommissionSettingsRow,
  requests: readonly DiscountRequestRow[]
): Promise<ProposalNeedingApproval[]> {
  if (!settings.discountApprovalEnabled) {
    return []
  }

  const { data, error } = await supabase
    .from("proposals")
    .select(
      `id, status, amount, purpose, broker_id,
       property:properties!proposals_property_fkey(code, title, sale_price, rent_price)`
    )
    .eq("organization_id", organizationId)
    .in("status", ["draft", "sent", "countered"])
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT)

  if (error) {
    return []
  }

  type RawProposal = {
    id: string
    status: string
    amount: number | string
    purpose: string
    broker_id: string | null
    property: {
      code: string | null
      title: string | null
      sale_price: number | string | null
      rent_price: number | string | null
    } | null
  }

  const policy = {
    approvalEnabled: settings.discountApprovalEnabled,
    maxDiscountPercent: settings.maxDiscountPercent,
  }
  const latestByProposal = new Map<string, DiscountRequestRow>()

  for (const request of requests) {
    if (!latestByProposal.has(request.proposalId)) {
      latestByProposal.set(request.proposalId, request)
    }
  }

  const rows: ProposalNeedingApproval[] = []

  for (const row of (data ?? []) as unknown as RawProposal[]) {
    const price = row.purpose === "rent" ? row.property?.rent_price : row.property?.sale_price
    const referenceCents = Math.round(toNumber(price) * 100)
    const amountCents = Math.round(toNumber(row.amount) * 100)

    if (!needsDiscountApproval(policy, referenceCents, amountCents)) {
      continue
    }

    const request = latestByProposal.get(row.id)

    rows.push({
      id: row.id,
      status: row.status,
      brokerId: row.broker_id,
      amountCents,
      referenceCents,
      discountPercent: discountPercent(referenceCents, amountCents),
      propertyCode: row.property?.code ?? null,
      propertyTitle: row.property?.title ?? null,
      requestStatus:
        request && (request.status !== "approved" || request.amountCents <= amountCents)
          ? request.status
          : null,
    })
  }

  return rows
}

/** Quanto a tabela em vigor renderia neste negócio (usado na prévia da tela). */
export function previewCommissionCents(rule: CommissionRuleRow | null, dealCents: number) {
  if (!rule) {
    return 0
  }

  return commissionTotalCents(
    {
      purpose: rule.purpose,
      basis: rule.basis,
      percent: rule.percent,
      fixedCents: rule.fixedCents,
      split: rule.split,
    },
    dealCents
  )
}
