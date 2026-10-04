import { APP_ROLE_LABELS, APP_ROLE_VALUES, type AppRole } from "@workspace/core/properties/enums"

/**
 * Espelha as políticas RLS de memberships e invitations: o dono gerencia
 * qualquer papel; o gerente só a equipe operacional. A UI usa estas regras
 * para esconder ou desabilitar ações, mas quem garante é o banco.
 */
export const OPERATIONAL_ROLES: readonly AppRole[] = ["broker", "capturer", "assistant"]

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  owner: "Acesso total, inclusive dados da imobiliária, marca e equipe.",
  manager: "Imóveis e clientes de todos; convida corretores, captadores e assistentes.",
  broker: "Vê todos os imóveis, edita os seus e atende os próprios clientes.",
  capturer: "Cadastra e edita os imóveis que captou e seus proprietários.",
  assistant: "Edita imóveis e clientes da imobiliária.",
  finance: "Leitura de imóveis, clientes e dados da imobiliária.",
}

export function getAssignableRoles(actorRole: AppRole): readonly AppRole[] {
  if (actorRole === "owner") return APP_ROLE_VALUES
  if (actorRole === "manager") return OPERATIONAL_ROLES
  return []
}

/** Se `actorRole` pode alterar, desativar ou convidar alguém com `targetRole`. */
export function canManageRole(actorRole: AppRole, targetRole: AppRole) {
  return getAssignableRoles(actorRole).includes(targetRole)
}

export function getRoleSelectItems(roles: readonly AppRole[]) {
  return roles.map((role) => ({ label: APP_ROLE_LABELS[role], value: role }))
}

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLE_VALUES as readonly string[]).includes(value)
}
