import type { Role } from "@/lib/auth/roles"

/**
 * Espelho, para a interface, das regras de RLS de clientes
 * (private.can_access_client_row). Só decide o que mostrar/habilitar: a
 * garantia continua sendo o banco.
 */
export const CLIENT_FULL_ACCESS_ROLES: readonly Role[] = ["owner", "manager", "assistant"]
export const CLIENT_CREATOR_ROLES: readonly Role[] = [
  "owner",
  "manager",
  "broker",
  "capturer",
  "assistant",
]
export const CLIENT_ADMIN_ROLES: readonly Role[] = ["owner", "manager"]

export type ClientAccessInfo = {
  assignedTo: string | null
  createdBy: string | null
  /** O usuário atual recebeu o cliente por compartilhamento. */
  sharedWithMe?: boolean
  /** O cliente é proprietário de algum imóvel (captador pode editar). */
  isPropertyOwner?: boolean
}

export function canCreateClients(role: Role) {
  return CLIENT_CREATOR_ROLES.includes(role)
}

export function canEditClient(role: Role, client: ClientAccessInfo, userId: string) {
  if (CLIENT_FULL_ACCESS_ROLES.includes(role)) {
    return true
  }

  if (role === "broker") {
    return client.assignedTo === userId || Boolean(client.sharedWithMe)
  }

  if (role === "capturer") {
    return client.createdBy === userId || Boolean(client.isPropertyOwner)
  }

  return false
}

/** Excluir cliente, documento, perfil de busca ou atividade: dono e gerente. */
export function canDeleteClientData(role: Role) {
  return CLIENT_ADMIN_ROLES.includes(role)
}

/** Remover compartilhamento: dono, gerente ou quem compartilhou. */
export function canRemoveClientShare(role: Role, sharedBy: string | null, userId: string) {
  return CLIENT_ADMIN_ROLES.includes(role) || sharedBy === userId
}

/** Corretor pode escolher outro responsável? Não: perderia o acesso ao cliente. */
export function canChooseClientAssignee(role: Role) {
  return role !== "broker"
}

/** Registrar atividade exige papel comercial e poder editar o cliente. */
export function canRegisterActivities(role: Role, canEdit: boolean) {
  return role !== "finance" && canEdit
}
