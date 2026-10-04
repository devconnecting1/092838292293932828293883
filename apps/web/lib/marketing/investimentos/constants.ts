import { TEAM_MANAGER_ROLES, type Role } from "@/lib/auth/roles"

/** Investimento em marketing por mês, canal e campanha (base do custo por lead). */
export const MARKETING_INVESTMENTS_PATH = "/marketing/investimentos"

/** Quem abre a página (RLS "marketing_investments: gestão e financeiro leem"). */
export const MARKETING_INVESTMENT_VIEWER_ROLES: readonly Role[] = ["owner", "manager", "finance"]

/** Quem lança, edita e exclui (RLS e RPC save_marketing_investment). */
export const MARKETING_INVESTMENT_EDITOR_ROLES: readonly Role[] = TEAM_MANAGER_ROLES

export function canEditMarketingInvestments(role: Role) {
  return MARKETING_INVESTMENT_EDITOR_ROLES.includes(role)
}

/** Meses oferecidos no formulário: 24 para trás e 12 para a frente do mês atual. */
export const INVESTMENT_MONTHS_BACK = 24
export const INVESTMENT_MONTHS_AHEAD = 12
