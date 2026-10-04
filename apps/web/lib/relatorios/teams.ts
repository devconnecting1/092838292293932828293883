import "server-only"

import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

/**
 * Equipes para o filtro de /relatorios.
 *
 * Nome da equipe, líder e quem está em cada uma não são dado sensível: todo
 * membro lê (`teams: membros leem` e `team_members: membros leem`). O recorte
 * dos NÚMEROS continua no banco; isto aqui só monta o filtro e diz se quem olha
 * é líder de alguma equipe.
 */

export type ReportTeam = {
  id: string
  name: string
  leaderId: string | null
  /** Membros atuais da equipe (user_id). */
  memberIds: string[]
}

export type ReportTeams = {
  teams: ReportTeam[]
  /** Equipe atual de cada membro (user_id → team_id). */
  teamByMember: Map<string, string>
  failed: boolean
}

export const loadReportTeams = cache(async (organizationId: string): Promise<ReportTeams> => {
  try {
    const supabase = await createClient()
    const [teamsResult, membersResult] = await Promise.all([
      supabase
        .from("teams")
        .select("id, name, leader_id")
        .eq("organization_id", organizationId)
        .order("name"),
      supabase
        .from("team_members")
        .select("user_id, team_id")
        .eq("organization_id", organizationId),
    ])

    if (teamsResult.error || membersResult.error) {
      console.error(
        "[relatorios] falha ao carregar as equipes:",
        teamsResult.error?.code ?? membersResult.error?.code ?? "erro"
      )
      return { teams: [], teamByMember: new Map(), failed: true }
    }

    const teamByMember = new Map<string, string>()
    const membersByTeam = new Map<string, string[]>()

    for (const row of membersResult.data ?? []) {
      teamByMember.set(row.user_id, row.team_id)
      const list = membersByTeam.get(row.team_id) ?? []
      list.push(row.user_id)
      membersByTeam.set(row.team_id, list)
    }

    const teams = (teamsResult.data ?? []).map((team) => ({
      id: team.id,
      name: team.name.trim() || "Equipe sem nome",
      leaderId: team.leader_id,
      memberIds: membersByTeam.get(team.id) ?? [],
    }))

    teams.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))

    return { teams, teamByMember, failed: false }
  } catch (error) {
    console.error(
      "[relatorios] falha ao carregar as equipes:",
      error instanceof Error ? error.message : "erro desconhecido"
    )
    return { teams: [], teamByMember: new Map(), failed: true }
  }
})

/** Equipes que o usuário lidera. */
export function ledTeams(teams: readonly ReportTeam[], userId: string): ReportTeam[] {
  return teams.filter((team) => team.leaderId === userId)
}
