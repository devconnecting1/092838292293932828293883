import { TEAM_MANAGER_ROLES, type Role } from "@/lib/auth/roles"

/** Probabilidade de fechamento por etapa da proposta (previsão de vendas). */
export const FORECAST_SETTINGS_PATH = "/configuracoes/previsao"

/** Quem abre a página: a gestão, que usa a previsão nos relatórios. */
export const FORECAST_VIEWER_ROLES: readonly Role[] = TEAM_MANAGER_ROLES

/** Quem altera: só o dono (RLS de proposal_stage_probabilities e a RPC). */
export const FORECAST_EDITOR_ROLES: readonly Role[] = ["owner"]

export function canEditForecastProbabilities(role: Role) {
  return FORECAST_EDITOR_ROLES.includes(role)
}
