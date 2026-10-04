// Espelho (somente para a interface) das regras de RLS de chaves, propostas e
// captações. A garantia de verdade continua sendo o RLS do banco.
import type { Role } from "@/lib/auth/roles"

/** Equipe comercial: registra retirada de chave e cria propostas. */
export const COMMERCIAL_ROLES: readonly Role[] = [
  "owner",
  "manager",
  "broker",
  "capturer",
  "assistant",
]

/** Quem lê e atualiza a caixa de entrada de captações. */
export const CAPTURE_INBOX_ROLES: readonly Role[] = ["owner", "manager", "capturer", "assistant"]

/**
 * Papéis que só criam proposta em imóvel que não editam se forem o próprio
 * corretor da proposta (política de INSERT de proposals). Nesses papéis o
 * corretor da nova proposta é sempre o próprio usuário.
 */
export const SELF_BROKER_ROLES: readonly Role[] = ["broker", "capturer"]

export function isSelfBrokerRole(role: Role) {
  return SELF_BROKER_ROLES.includes(role)
}

/** Papéis que editam qualquer imóvel da imobiliária. */
const PROPERTY_MANAGER_ROLES: readonly Role[] = ["owner", "manager", "assistant"]

type PropertyOwnership = {
  capturedBy: string | null
  brokerId: string | null
}

/** private.can_edit_property_row */
export function canEditProperty(role: Role, userId: string, property: PropertyOwnership) {
  if (PROPERTY_MANAGER_ROLES.includes(role)) {
    return true
  }

  return (
    (role === "broker" || role === "capturer") &&
    (property.capturedBy === userId || property.brokerId === userId)
  )
}

/** Política de UPDATE de proposals. */
export function canUpdateProposal(
  role: Role,
  userId: string,
  proposal: { brokerId: string | null },
  property: PropertyOwnership
) {
  return (
    canEditProperty(role, userId, property) ||
    ((role === "broker" || role === "capturer") && proposal.brokerId === userId)
  )
}

/** Política de UPDATE de key_movements (registrar devolução). */
export function canReturnKey(
  role: Role,
  userId: string,
  movement: { takenByUser: string | null; createdBy: string | null },
  property: PropertyOwnership
) {
  return (
    COMMERCIAL_ROLES.includes(role) &&
    (movement.takenByUser === userId ||
      movement.createdBy === userId ||
      canEditProperty(role, userId, property))
  )
}
