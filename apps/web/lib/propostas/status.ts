// Fluxo de status das propostas (regra pura, usada na interface e nas actions).
import { PROPOSAL_STATUS_LABELS, type ProposalStatus } from "@workspace/core/properties/enums"

export { PROPOSAL_STATUS_LABELS, type ProposalStatus }

/** Propostas ainda em negociação (podem ser editadas e vencer). */
export const OPEN_PROPOSAL_STATUSES: readonly ProposalStatus[] = ["draft", "sent", "countered"]

/**
 * rascunho → enviada → (contraproposta ⇄ enviada) → aceita | recusada.
 * "Retirada" encerra a proposta a qualquer momento antes da decisão.
 * Aceita, recusada e retirada são finais.
 */
const TRANSITIONS: Record<ProposalStatus, readonly ProposalStatus[]> = {
  draft: ["sent", "withdrawn"],
  sent: ["countered", "accepted", "rejected", "withdrawn"],
  countered: ["sent", "accepted", "rejected", "withdrawn"],
  accepted: [],
  rejected: [],
  withdrawn: [],
}

const DECISION_STATUSES: readonly ProposalStatus[] = ["accepted", "rejected", "withdrawn"]

export function getAllowedTransitions(from: ProposalStatus) {
  return TRANSITIONS[from]
}

export function canTransition(from: ProposalStatus, to: ProposalStatus) {
  return TRANSITIONS[from].includes(to)
}

export function isOpenProposal(status: ProposalStatus) {
  return OPEN_PROPOSAL_STATUSES.includes(status)
}

export function isDecisionStatus(status: ProposalStatus) {
  return DECISION_STATUSES.includes(status)
}

/** Validade (data, sem hora) já passou e a proposta não foi decidida. */
export function isProposalExpired(
  proposal: { status: ProposalStatus; validUntil: string | null },
  today: string
) {
  return (
    isOpenProposal(proposal.status) && proposal.validUntil !== null && proposal.validUntil < today
  )
}

export type TransitionCopy = {
  action: string
  title: string
  description: string
  confirm: string
  success: string
  destructive?: boolean
}

const TRANSITION_COPY: Record<ProposalStatus, TransitionCopy> = {
  draft: {
    action: "Voltar para rascunho",
    title: "Voltar para rascunho?",
    description: "A proposta volta a ser um rascunho.",
    confirm: "Voltar para rascunho",
    success: "Proposta voltou para rascunho.",
  },
  sent: {
    action: "Marcar como enviada",
    title: "Marcar a proposta como enviada?",
    description: "Use quando a proposta for apresentada ao proprietário.",
    confirm: "Marcar como enviada",
    success: "Proposta marcada como enviada.",
  },
  countered: {
    action: "Registrar contraproposta",
    title: "Registrar contraproposta?",
    description:
      "O proprietário respondeu com outra condição. Para guardar o valor e as condições dele no histórico, abra a proposta e registre a rodada como contraproposta do proprietário.",
    confirm: "Registrar contraproposta",
    success: "Contraproposta registrada.",
  },
  accepted: {
    action: "Marcar como aceita",
    title: "Marcar a proposta como aceita?",
    description: "A proposta será encerrada como aceita e não poderá mais ser editada.",
    confirm: "Marcar como aceita",
    success: "Proposta aceita.",
  },
  rejected: {
    action: "Marcar como recusada",
    title: "Marcar a proposta como recusada?",
    description: "A proposta será encerrada como recusada e não poderá mais ser editada.",
    confirm: "Marcar como recusada",
    success: "Proposta marcada como recusada.",
    destructive: true,
  },
  withdrawn: {
    action: "Retirar proposta",
    title: "Retirar a proposta?",
    description:
      "Use quando o cliente desistir. A proposta será encerrada e não poderá mais ser editada.",
    confirm: "Retirar proposta",
    success: "Proposta retirada.",
    destructive: true,
  },
}

export function getTransitionCopy(from: ProposalStatus, to: ProposalStatus): TransitionCopy {
  const copy = TRANSITION_COPY[to]

  if (from === "countered" && to === "sent") {
    return {
      ...copy,
      action: "Reenviar proposta",
      title: "Reenviar a proposta?",
      description:
        "Se o cliente mudou o valor ou as condições, registre antes a nova oferta na proposta: ela entra no histórico e já reenvia.",
      confirm: "Reenviar",
      success: "Proposta reenviada.",
    }
  }

  return copy
}

export const PROPOSAL_STATUS_BADGE: Record<
  ProposalStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  sent: "secondary",
  countered: "secondary",
  accepted: "default",
  rejected: "destructive",
  withdrawn: "outline",
}
