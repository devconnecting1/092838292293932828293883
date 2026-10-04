"use server"

import { revalidatePath } from "next/cache"

import {
  allowedRoundKinds,
  PROPOSAL_ROUND_KIND_LABELS,
  statusAfterRound,
  type ProposalRoundKind,
} from "@workspace/core/proposals/rounds"

import { requireMembership } from "@/lib/auth/session"
import { translateDbError } from "@/lib/propostas/db-errors"
import { discountApprovalMessage, isDiscountApprovalError } from "@/lib/propostas/discount"
import { parseBrlInput } from "@/lib/propostas/money"
import { getProfileNames } from "@/lib/propostas/options"
import {
  proposalIdSchema,
  proposalRoundSchema,
  type ProposalRoundValues,
} from "@/lib/propostas/schemas"
import type { ProposalStatus } from "@/lib/propostas/status"
import { createClient } from "@/lib/supabase/server"

const NO_PERMISSION =
  "Você não tem permissão para alterar esta proposta. Só o corretor da proposta ou quem edita o imóvel pode fazer isso."

export type ProposalRoundView = {
  number: number
  kind: ProposalRoundKind
  amount: number
  downPayment: number | null
  financingAmount: number | null
  exchangeDescription: string | null
  paymentDeadline: string | null
  paymentTerms: string | null
  conditions: string | null
  validUntil: string | null
  authorName: string | null
  createdAt: string
}

export type ProposalNegotiation = {
  status: ProposalStatus
  purpose: "sale" | "rent"
  currentRound: number
  /** Da mais recente para a mais antiga. */
  rounds: ProposalRoundView[]
}

function toNumber(value: number | string | null) {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Linha do tempo da negociação (o RLS esconde proposta de imóvel restrito). */
export async function getProposalNegotiation(
  proposalId: string
): Promise<{ ok: true; data: ProposalNegotiation } | { ok: false; error: string }> {
  const id = proposalIdSchema.safeParse(proposalId)

  if (!id.success) return { ok: false, error: "Proposta inválida." }

  const { membership } = await requireMembership()
  const supabase = await createClient()

  const [proposalResult, roundsResult] = await Promise.all([
    supabase
      .from("proposals")
      .select("status, purpose, round_number")
      .eq("organization_id", membership.organizationId)
      .eq("id", id.data)
      .maybeSingle(),
    supabase
      .from("proposal_rounds")
      .select(
        "round_number, kind, amount, down_payment, financing_amount, exchange_description, payment_deadline, payment_terms, conditions, valid_until, created_by, created_at"
      )
      .eq("organization_id", membership.organizationId)
      .eq("proposal_id", id.data)
      .order("round_number", { ascending: false })
      .limit(200),
  ])

  if (proposalResult.error || roundsResult.error) {
    return { ok: false, error: "Não foi possível carregar a negociação. Tente novamente." }
  }

  const proposal = proposalResult.data

  if (!proposal) {
    return { ok: false, error: "Proposta não encontrada. Recarregue a página." }
  }

  let names = new Map<string, string>()

  try {
    names = await getProfileNames(
      supabase,
      roundsResult.data.flatMap((round) => (round.created_by ? [round.created_by] : []))
    )
  } catch {
    // Sem os nomes a linha do tempo continua útil.
  }

  return {
    ok: true,
    data: {
      status: proposal.status,
      purpose: proposal.purpose === "rent" ? "rent" : "sale",
      currentRound: proposal.round_number,
      rounds: roundsResult.data.map((round) => ({
        number: round.round_number,
        kind: round.kind,
        amount: toNumber(round.amount) ?? 0,
        downPayment: toNumber(round.down_payment),
        financingAmount: toNumber(round.financing_amount),
        exchangeDescription: round.exchange_description,
        paymentDeadline: round.payment_deadline,
        paymentTerms: round.payment_terms,
        conditions: round.conditions,
        validUntil: round.valid_until,
        authorName: round.created_by ? (names.get(round.created_by) ?? null) : null,
        createdAt: round.created_at,
      })),
    },
  }
}

export type ProposalRoundResult =
  { ok: true; message: string } | { ok: false; error: string; needsDiscountApproval?: boolean }

function kindNotAllowedMessage(status: ProposalStatus, kind: ProposalRoundKind) {
  if (status === "draft") {
    return "Envie a proposta antes de registrar contraproposta ou nova oferta. No rascunho, corrija a proposta inicial."
  }
  if (kind === "initial") {
    return "A negociação já começou: registre uma contraproposta do proprietário ou uma nova oferta do cliente."
  }
  return "Propostas encerradas (aceitas, recusadas ou retiradas) não recebem novas rodadas."
}

/**
 * Registra uma rodada: grava valor e condições vigentes na proposta e o banco
 * guarda o retrato imutável em proposal_rounds. Contraproposta do proprietário
 * deixa a proposta como "contraproposta"; nova oferta do cliente reenvia (ou,
 * com `holdForApproval`, fica aguardando a aprovação do desconto).
 */
export async function registerProposalRound(
  proposalId: string,
  values: ProposalRoundValues,
  { holdForApproval = false }: { holdForApproval?: boolean } = {}
): Promise<ProposalRoundResult> {
  const id = proposalIdSchema.safeParse(proposalId)
  const parsed = proposalRoundSchema.safeParse(values)

  if (!id.success) return { ok: false, error: "Proposta inválida." }
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Confira os campos." }
  }

  const { membership } = await requireMembership()
  const supabase = await createClient()

  const { data: current, error: loadError } = await supabase
    .from("proposals")
    .select(
      "status, round_number, round_kind, amount, down_payment, financing_amount, exchange_description, payment_deadline, payment_terms, conditions, valid_until"
    )
    .eq("organization_id", membership.organizationId)
    .eq("id", id.data)
    .maybeSingle()

  if (loadError) return { ok: false, error: translateDbError(loadError, NO_PERMISSION) }
  if (!current) return { ok: false, error: "Proposta não encontrada. Recarregue a página." }

  const round = parsed.data

  if (!allowedRoundKinds(current.status).includes(round.kind)) {
    return { ok: false, error: kindNotAllowedMessage(current.status, round.kind) }
  }

  const columns = {
    round_kind: round.kind,
    amount: parseBrlInput(round.amount) ?? 0,
    down_payment: round.downPayment ? parseBrlInput(round.downPayment) : null,
    financing_amount: round.financingAmount ? parseBrlInput(round.financingAmount) : null,
    exchange_description: round.exchangeDescription || null,
    payment_deadline: round.paymentDeadline || null,
    payment_terms: round.paymentTerms || null,
    conditions: round.conditions || null,
    valid_until: round.validUntil || null,
  }

  const unchanged =
    columns.round_kind === current.round_kind &&
    columns.amount === toNumber(current.amount) &&
    columns.down_payment === toNumber(current.down_payment) &&
    columns.financing_amount === toNumber(current.financing_amount) &&
    columns.exchange_description === current.exchange_description &&
    columns.payment_deadline === current.payment_deadline &&
    columns.payment_terms === current.payment_terms &&
    columns.conditions === current.conditions &&
    columns.valid_until === current.valid_until

  if (unchanged) {
    return {
      ok: false,
      error: "Nada mudou em relação à rodada atual. Altere o valor ou alguma condição.",
    }
  }

  const nextStatus = statusAfterRound(round.kind, current.status, { holdForApproval })

  const { data, error } = await supabase
    .from("proposals")
    .update(nextStatus === current.status ? columns : { ...columns, status: nextStatus })
    .eq("organization_id", membership.organizationId)
    .eq("id", id.data)
    .eq("status", current.status)
    .eq("round_number", current.round_number)
    .select("round_number")

  if (error) {
    if (isDiscountApprovalError(error)) {
      return { ok: false, error: discountApprovalMessage(error), needsDiscountApproval: true }
    }

    return { ok: false, error: translateDbError(error, NO_PERMISSION) }
  }

  const saved = data?.[0]

  if (!saved) {
    const { data: latest } = await supabase
      .from("proposals")
      .select("round_number, status")
      .eq("id", id.data)
      .maybeSingle()

    return {
      ok: false,
      error:
        latest && (latest.round_number !== current.round_number || latest.status !== current.status)
          ? "A proposta foi alterada por outra pessoa. Recarregue a página."
          : NO_PERMISSION,
    }
  }

  revalidatePath("/propostas")
  revalidatePath("/imoveis", "layout")

  const label = PROPOSAL_ROUND_KIND_LABELS[round.kind]
  const waiting =
    holdForApproval && round.kind === "client_offer"
      ? " A proposta aguarda a aprovação do desconto antes de ser reenviada."
      : ""

  return {
    ok: true,
    message: `${label} registrada (rodada ${saved.round_number}).${waiting}`,
  }
}
