// Rodadas da negociação (tabela proposal_rounds). Módulo puro: tipos,
// rótulos, que rodada cabe em cada status e o status que a rodada deixa.
//
// O banco numera e grava a rodada (gatilhos de proposals) e recusa o que não
// cabe: rascunho só corrige a proposta inicial, e a negociação não volta para
// "proposta inicial" depois de uma contraproposta.

import type { ProposalStatus } from "../properties/enums"

export type ProposalRoundKind = "initial" | "owner_counter" | "client_offer"

export const PROPOSAL_ROUND_KIND_VALUES: readonly ProposalRoundKind[] = [
  "initial",
  "owner_counter",
  "client_offer",
]

export const PROPOSAL_ROUND_KIND_LABELS: Record<ProposalRoundKind, string> = {
  initial: "Proposta inicial",
  owner_counter: "Contraproposta do proprietário",
  client_offer: "Nova oferta do cliente",
}

export function isProposalRoundKind(value: unknown): value is ProposalRoundKind {
  return (
    typeof value === "string" && (PROPOSAL_ROUND_KIND_VALUES as readonly string[]).includes(value)
  )
}

/** Limites dos CHECKs de proposals. */
export const PROPOSAL_EXCHANGE_MAX_LENGTH = 1000
export const PROPOSAL_DEADLINE_MAX_LENGTH = 300

/**
 * Rodadas que podem ser registradas agora. Rascunho ainda não foi apresentado:
 * só corrige a proposta inicial. Encerrada: nenhuma.
 */
export function allowedRoundKinds(status: ProposalStatus): ProposalRoundKind[] {
  if (status === "draft") return ["initial"]
  if (status === "sent" || status === "countered") return ["owner_counter", "client_offer"]
  return []
}

/**
 * Status da proposta depois da rodada. Contraproposta do proprietário fica
 * "contraproposta"; nova oferta do cliente volta a "enviada" — ou fica como
 * contraproposta (`holdForApproval`) enquanto espera o gerente aprovar um
 * desconto acima do limite (proposta enviada não pode passar do limite).
 */
export function statusAfterRound(
  kind: ProposalRoundKind,
  current: ProposalStatus,
  { holdForApproval = false }: { holdForApproval?: boolean } = {}
): ProposalStatus {
  if (kind === "initial") return current
  if (kind === "owner_counter") return "countered"
  return holdForApproval ? "countered" : "sent"
}

export type ProposalRoundTerms = {
  downPayment: number | null
  financingAmount: number | null
  exchangeDescription: string | null
  paymentDeadline: string | null
}

export type ProposalRoundTermLine = { label: string; value: string }

/**
 * Condições da rodada em linhas "rótulo: valor", na ordem do documento. Campo
 * vazio não aparece. `formatMoney` recebe reais.
 */
export function describeRoundTerms(
  terms: ProposalRoundTerms,
  formatMoney: (value: number) => string
): ProposalRoundTermLine[] {
  const lines: ProposalRoundTermLine[] = []

  if (terms.downPayment != null) {
    lines.push({ label: "Sinal", value: formatMoney(terms.downPayment) })
  }
  if (terms.financingAmount != null) {
    lines.push({ label: "Financiamento", value: formatMoney(terms.financingAmount) })
  }

  const exchange = terms.exchangeDescription?.trim()
  if (exchange) lines.push({ label: "Permuta", value: exchange })

  const deadline = terms.paymentDeadline?.trim()
  if (deadline) lines.push({ label: "Prazo", value: deadline })

  return lines
}

/** "Rodada 3 · Contraproposta do proprietário" */
export function formatRoundTitle(roundNumber: number, kind: ProposalRoundKind): string {
  return `Rodada ${roundNumber} · ${PROPOSAL_ROUND_KIND_LABELS[kind]}`
}
