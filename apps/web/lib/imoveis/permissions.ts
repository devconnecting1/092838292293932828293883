import { permissionDeniedMessage } from "@/lib/auth/permission-messages"
import type { Role } from "@/lib/auth/roles"

/**
 * Espelho das políticas RLS de imóveis e condomínios, só para esconder ou
 * desabilitar ações na interface. A garantia continua sendo o RLS do banco.
 */

const COMMERCIAL_ROLES: readonly Role[] = ["owner", "manager", "broker", "capturer", "assistant"]
const MANAGEMENT_ROLES: readonly Role[] = ["owner", "manager", "assistant"]
const OWNER_MANAGER_ROLES: readonly Role[] = ["owner", "manager"]
const CAPTURE_READER_ROLES: readonly Role[] = ["owner", "manager", "capturer", "assistant"]

type PropertyAssignment = {
  captured_by: string | null
  broker_id: string | null
}

/** "properties: equipe comercial cria". */
export function canCreateProperty(role: Role) {
  return COMMERCIAL_ROLES.includes(role)
}

/** private.can_edit_property_row: gestão edita tudo; corretor/captador só os seus. */
export function canEditProperty(role: Role, userId: string, property: PropertyAssignment) {
  if (MANAGEMENT_ROLES.includes(role)) return true
  if (role === "broker" || role === "capturer") {
    return property.captured_by === userId || property.broker_id === userId
  }
  return false
}

/**
 * private.can_manage_property_row: dono, gerente, captador e corretor
 * responsável. Muda o sigilo (imóvel restrito), escolhe quem vê e envia ou
 * remove documentos do dossiê.
 */
export function canManageProperty(role: Role, userId: string, property: PropertyAssignment) {
  return (
    OWNER_MANAGER_ROLES.includes(role) ||
    property.captured_by === userId ||
    property.broker_id === userId
  )
}

/** Recusa das ações de sigilo e dossiê (quem pode fazer). */
export const MANAGE_PROPERTY_DENIED_MESSAGE =
  "Só o dono, o gerente, o captador ou o corretor responsável pelo imóvel podem fazer isso."

/** Remoção de fotos, proprietários, autorizações e do próprio imóvel: dono e gerente. */
export function canDeletePropertyRecords(role: Role) {
  return OWNER_MANAGER_ROLES.includes(role)
}

/** Recusas de remoção (mesma regra de RLS, mensagens que dizem a quem pedir). */
export const REMOVE_MEDIA_DENIED_MESSAGE = permissionDeniedMessage(
  "remover fotos",
  OWNER_MANAGER_ROLES
)
export const REMOVE_OWNER_DENIED_MESSAGE = permissionDeniedMessage(
  "remover proprietários",
  OWNER_MANAGER_ROLES
)
export const REMOVE_AUTHORIZATION_DENIED_MESSAGE = permissionDeniedMessage(
  "remover autorizações",
  OWNER_MANAGER_ROLES
)
export const DELETE_PROPERTY_DENIED_MESSAGE = permissionDeniedMessage(
  "excluir imóveis",
  OWNER_MANAGER_ROLES
)

/** "capture_requests: gestão, captador e assistente leem/atualizam". */
export function canReadCaptureRequests(role: Role) {
  return CAPTURE_READER_ROLES.includes(role)
}

/** Corretor/captador precisa continuar vinculado ao imóvel para editá-lo depois. */
export function mustStayAssigned(role: Role) {
  return role === "broker" || role === "capturer"
}

/** "condominiums: equipe comercial cria". */
export function canCreateCondominium(role: Role) {
  return COMMERCIAL_ROLES.includes(role)
}

/** "condominiums: gestão ou quem criou atualiza". */
export function canEditCondominium(role: Role, userId: string, createdBy: string | null) {
  if (MANAGEMENT_ROLES.includes(role)) return true
  return (role === "broker" || role === "capturer") && createdBy === userId
}

/** "condominiums: dono e gerente removem". */
export function canDeleteCondominium(role: Role) {
  return OWNER_MANAGER_ROLES.includes(role)
}
