import { TEAM_MANAGER_ROLES, type Role } from "@/lib/auth/roles"

/** Equipes comerciais (public.teams). A página abre para todos; só a gestão edita. */
export const TEAMS_SETTINGS_PATH = "/configuracoes/equipes"

/** Quem cria, renomeia, escolhe líder, move membros e exclui (RLS de teams e team_members). */
export const TEAM_EDITOR_ROLES: readonly Role[] = TEAM_MANAGER_ROLES

export function canEditTeams(role: Role) {
  return TEAM_EDITOR_ROLES.includes(role)
}

/** Teto de pessoas incluídas de uma vez (proteção da action; a tela lista a imobiliária inteira). */
export const TEAM_ADD_MEMBERS_MAX = 200
