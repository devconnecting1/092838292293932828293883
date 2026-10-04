// Aprovação de desconto vista da tela de Propostas.
//
// A conta (quanto é o desconto, se passa do limite e se a aprovação cobre) é a
// de `@workspace/core/comissoes`, a mesma do gatilho
// `private.proposals_require_discount_approval`. Aqui só se junta essa regra com
// o que a lista já carregou: o preço anunciado do imóvel e os pedidos que a RPC
// `list_proposal_discount_requests` devolve a quem edita a proposta (e à gestão).

import {
  discountApprovalCovers,
  discountPercent,
  needsDiscountApproval,
  type DiscountPolicy,
  type DiscountRequestStatus,
} from "@workspace/core/comissoes"

import type { DbErrorLike } from "@/lib/propostas/db-errors"
import { isOpenProposal, type ProposalStatus } from "@/lib/propostas/status"

export type ProposalDiscountRequest = {
  id: string
  proposalId: string
  status: DiscountRequestStatus
  /** Valor da proposta quando o pedido foi feito (ou atualizado). */
  amountCents: number
  /** Preço anunciado quando o pedido foi feito (ou atualizado). */
  referenceCents: number
  /** Justificativa e resposta do gerente: null para quem não é gestão nem pediu. */
  reason: string | null
  reviewNote: string | null
  /** Foi a própria pessoa que pediu (false também quando quem pediu saiu da conta). */
  requestedByMe: boolean
  createdAt: string
  reviewedAt: string | null
}

export type ProposalDiscount = {
  /** Desconto sobre o preço anunciado, em pontos percentuais (3 casas). */
  percent: number
  /** Desconto máximo sem aprovação, em pontos percentuais. */
  limitPercent: number
  referenceCents: number
  amountCents: number
  /**
   * Existe pedido aprovado para este valor (ou um menor) e para este preço
   * anunciado (ou um maior): o gatilho deixa a proposta seguir.
   */
  approved: boolean
  /** Pedido mais recente da proposta. */
  latestRequest: ProposalDiscountRequest | null
  /**
   * O pedido em aberto é de outra pessoa (ou de quem saiu da conta). O banco
   * recusa pedido novo até o gerente responder: a tela só mostra a situação.
   */
  pendingByOther: boolean
}

/** Reais (numeric(14,2) do banco) → centavos, como o `round(x * 100)` do gatilho. */
function toCents(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? 0 : Math.round(value * 100)
}

export type DiscountMeasureInput = {
  status: ProposalStatus
  purpose: "sale" | "rent"
  amount: number
  /** null quando o RLS esconde o imóvel: sem preço, não há o que medir aqui. */
  property: { salePrice: number | null; rentPrice: number | null } | null
}

/**
 * Desconto de uma proposta em negociação que passa do limite, ainda sem olhar
 * os pedidos. `null` quando a proposta não trava (encerrada, dentro do limite,
 * sem preço anunciado ou com a aprovação desligada).
 */
export function measureProposalDiscount(policy: DiscountPolicy, proposal: DiscountMeasureInput) {
  if (!proposal.property || !isOpenProposal(proposal.status)) {
    return null
  }

  const referenceCents = toCents(
    proposal.purpose === "rent" ? proposal.property.rentPrice : proposal.property.salePrice
  )
  const amountCents = toCents(proposal.amount)

  if (!needsDiscountApproval(policy, referenceCents, amountCents)) {
    return null
  }

  return {
    percent: discountPercent(referenceCents, amountCents),
    limitPercent: policy.maxDiscountPercent,
    referenceCents,
    amountCents,
  }
}

/** Junta a medida com os pedidos da proposta (mais recente primeiro). */
export function resolveProposalDiscount(
  measure: NonNullable<ReturnType<typeof measureProposalDiscount>>,
  requests: readonly ProposalDiscountRequest[]
): ProposalDiscount {
  const latestRequest = requests[0] ?? null

  return {
    ...measure,
    approved: requests.some(
      (request) => request.status === "approved" && discountApprovalCovers(request, measure)
    ),
    latestRequest,
    pendingByOther: latestRequest?.status === "pending" && !latestRequest.requestedByMe,
  }
}

// Recusa do gatilho --------------------------------------------------------------

/**
 * Trecho fixo da mensagem de `private.proposals_require_discount_approval`. O
 * banco usa P0001 em várias validações; é o texto que separa esta das outras.
 */
const DISCOUNT_TRIGGER_FRAGMENT = "que dispensa aprovação"

export function isDiscountApprovalError(error: DbErrorLike) {
  return error.code === "P0001" && error.message.includes(DISCOUNT_TRIGGER_FRAGMENT)
}

/**
 * A mensagem do banco manda ir até Comissões; em Propostas o pedido sai da
 * própria tela.
 */
export function discountApprovalMessage(error: DbErrorLike) {
  return error.message.replace(/\s+em Comissões\.?\s*$/, ".")
}
