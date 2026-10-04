// Espelho (só para a interface) das regras de RLS do comissionamento. A
// garantia continua sendo o banco: private.commission_auditor nas políticas de
// commissions/commission_shares e private.has_role nas RPCs.

import type { Role } from "@/lib/auth/roles"

/**
 * Quem vê o extrato inteiro da imobiliária e marca pagamento
 * (private.commission_auditor). Corretor, captador e assistente veem só as
 * partes que são deles.
 */
export const COMMISSION_AUDITOR_ROLES: readonly Role[] = ["owner", "manager", "finance"]

/** Quem grava a tabela de comissão, aprova desconto e registra parceiro. */
export const COMMISSION_MANAGER_ROLES: readonly Role[] = ["owner", "manager"]

export function isCommissionAuditor(role: Role) {
  return COMMISSION_AUDITOR_ROLES.includes(role)
}

export function canManageCommissions(role: Role) {
  return COMMISSION_MANAGER_ROLES.includes(role)
}

/** Rota do extrato de comissões. */
export const COMMISSIONS_PATH = "/comissoes"

/** Tabela de comissão e limite de desconto, dentro de Configurações. */
export const COMMISSION_SETTINGS_PATH = "/configuracoes/comissoes"
