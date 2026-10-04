import type { Role } from "@/lib/auth/roles"

/**
 * Espelho, para a interface, do recorte que o banco já aplica em
 * `private.report_member_scope` (migração `gestao_comercial_equipes_metas`).
 *
 * - **dono e gerente**: veem a imobiliária inteira e escolhem equipe ou
 *   corretor no filtro;
 * - **líder de equipe**: vê os membros das equipes que lidera (e ele mesmo) e
 *   filtra só dentro delas. Mandar o id de outra equipe na URL não amplia nada:
 *   o banco ignora;
 * - **qualquer outro papel**: vê só o próprio desempenho.
 *
 * A garantia continua sendo o banco; isto aqui só decide o que desenhar e qual
 * aviso mostrar na tela. Por isso a tela DIZ o recorte em que está, em vez de
 * deixar o corretor achar que o número da imobiliária inteira é o dele.
 */
export const REPORT_TEAM_ROLES: readonly Role[] = ["owner", "manager"]

/** Quem define metas (`save_sales_goal` e `copy_sales_goals`). */
export const GOAL_EDITOR_ROLES: readonly Role[] = ["owner", "manager"]

/** Vê a imobiliária inteira e pode filtrar por equipe e corretor. */
export function canSeeTeamReports(role: Role) {
  return REPORT_TEAM_ROLES.includes(role)
}

export function canEditGoals(role: Role) {
  return GOAL_EDITOR_ROLES.includes(role)
}

/** Quem lança investimento em marketing (`save_marketing_investment`). */
export function canManageMarketingInvestments(role: Role) {
  return REPORT_TEAM_ROLES.includes(role)
}

export type ReportAccess = "organization" | "leader" | "self"

/**
 * Recorte de quem está olhando. `ledTeamIds` são as equipes que o usuário
 * lidera (vazio quando não lidera nenhuma).
 */
export function reportAccess(role: Role, ledTeamIds: readonly string[]): ReportAccess {
  if (canSeeTeamReports(role)) return "organization"
  return ledTeamIds.length > 0 ? "leader" : "self"
}

/**
 * Colunas sensíveis da exportação (CPF/CNPJ e data de nascimento do cliente,
 * ids de clique do lead): mesmos papéis de `canSeeLeadTrackingIds`. Quem não
 * pode ver recebe a coluna vazia — a RPC devolve null, isto aqui só evita
 * prometer na tela o que o arquivo não vai trazer.
 */
export function canExportSensitiveColumns(role: Role) {
  return REPORT_TEAM_ROLES.includes(role)
}

/** Título do aviso de recorte, no topo da tela. */
export function reportScopeTitle(access: ReportAccess, roleLabel: string) {
  switch (access) {
    case "organization":
      return "Visão da imobiliária"
    case "leader":
      return "Visão das equipes que você lidera"
    default:
      return `Visão do seu papel (${roleLabel})`
  }
}

/** Texto do aviso de recorte, no topo da tela. */
export function reportScopeNotice(
  access: ReportAccess,
  memberName: string | null,
  ledTeamNames: readonly string[] = []
) {
  if (access === "organization") {
    return "Você vê o desempenho de toda a imobiliária e pode filtrar por equipe ou corretor."
  }

  if (access === "leader") {
    const teams = ledTeamNames.length > 0 ? ` (${ledTeamNames.join(", ")})` : ""
    return `Você vê o desempenho das equipes que lidera${teams} e o seu. Só o dono e o gerente veem as outras equipes.`
  }

  return memberName
    ? `Você vê apenas o seu desempenho (${memberName}). Só o dono, o gerente e o líder da sua equipe veem o número dos colegas.`
    : "Você vê apenas o seu desempenho. Só o dono, o gerente e o líder da sua equipe veem o número dos colegas."
}
