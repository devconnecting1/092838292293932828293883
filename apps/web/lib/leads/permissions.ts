import type { Role } from "@/lib/auth/roles"

/**
 * Espelho, para a interface, das políticas RLS de `leads`. Só decide o que
 * mostrar/habilitar: a garantia continua sendo o banco.
 *
 * - dono, gerente e assistente: veem e editam todos;
 * - corretor: vê e edita os atribuídos a ele e os sem responsável (pode assumir);
 * - captador e financeiro: só leitura dos atribuídos a eles;
 * - cadastro manual: dono, gerente, assistente e corretor;
 * - exclusão: dono e gerente.
 *
 * Com o rodízio de leads LIGADO (`lead_routing_settings.roulette_enabled`),
 * quem decide o responsável é a roleta, não a ordem de chegada: o lead já entra
 * com dono e "assumir lead" praticamente não aparece. `canClaimLead` continua
 * valendo para o que sobra sem responsável (rodízio desligado, fila vazia ou
 * lead liberado em massa), e a distribuição manual pela roleta fica com a
 * gestão (`canAssignFromRoulette`).
 */
export const LEAD_FULL_ACCESS_ROLES: readonly Role[] = ["owner", "manager", "assistant"]
export const LEAD_CREATOR_ROLES: readonly Role[] = ["owner", "manager", "assistant", "broker"]
export const LEAD_ADMIN_ROLES: readonly Role[] = ["owner", "manager"]

export type LeadAccessInfo = {
  assignedTo: string | null
}

export function canViewAllLeads(role: Role) {
  return LEAD_FULL_ACCESS_ROLES.includes(role)
}

export function canCreateLeads(role: Role) {
  return LEAD_CREATOR_ROLES.includes(role)
}

/** Papel que edita algum lead (mover, atribuir, converter). */
export function canWorkLeads(role: Role) {
  return LEAD_CREATOR_ROLES.includes(role)
}

export function canEditLead(role: Role, lead: LeadAccessInfo, userId: string) {
  if (LEAD_FULL_ACCESS_ROLES.includes(role)) {
    return true
  }

  if (role === "broker") {
    return lead.assignedTo === null || lead.assignedTo === userId
  }

  return false
}

/** Gestão escolhe qualquer responsável (ou nenhum). */
export function canChooseLeadAssignee(role: Role) {
  return LEAD_FULL_ACCESS_ROLES.includes(role)
}

/** Corretor assume lead sem responsável (atribui a si mesmo). */
export function canClaimLead(role: Role, lead: LeadAccessInfo) {
  return role === "broker" && lead.assignedTo === null
}

/**
 * Mandar o lead para a roleta (RPC `assign_lead_from_roulette`): mesmos papéis
 * que a RPC aceita. A tela ainda checa se o rodízio está ligado.
 */
export function canAssignFromRoulette(role: Role) {
  return LEAD_FULL_ACCESS_ROLES.includes(role)
}

export function canDeleteLeads(role: Role) {
  return LEAD_ADMIN_ROLES.includes(role)
}

/** Ids crus de clique (gclid, fbclid…) e event_id: só dono e gerente. */
export function canSeeLeadTrackingIds(role: Role) {
  return LEAD_ADMIN_ROLES.includes(role)
}

/** Converter cria/vincula cliente: exige editar o lead. */
export function canConvertLead(role: Role, lead: LeadAccessInfo, userId: string) {
  return canEditLead(role, lead, userId)
}
