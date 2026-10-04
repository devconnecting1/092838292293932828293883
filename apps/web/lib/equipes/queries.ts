import "server-only"

import { isRole, type Role } from "@/lib/auth/roles"
import { createClient } from "@/lib/supabase/server"

export type TeamPerson = {
  id: string
  name: string
  role: Role
  active: boolean
}

export type TeamRecord = {
  id: string
  name: string
  leaderId: string | null
  createdAt: string
}

export type TeamMemberRecord = {
  userId: string
  teamId: string
}

export type TeamsData = {
  teams: TeamRecord[]
  teamMembers: TeamMemberRecord[]
  /** Todos os membros da imobiliária (ativos e inativos), por nome. */
  people: TeamPerson[]
}

/**
 * Equipes, quem está em cada uma e as pessoas da imobiliária. Todo membro lê
 * (RLS "teams: membros leem"); quem pode alterar é decidido na action.
 * memberships.user_id aponta para auth.users (sem FK para profiles): são
 * consultas separadas.
 */
export async function getTeamsData(organizationId: string): Promise<TeamsData> {
  const supabase = await createClient()

  const [teamsResult, membersResult, membershipsResult] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, leader_id, created_at")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
    supabase.from("team_members").select("user_id, team_id").eq("organization_id", organizationId),
    supabase
      .from("memberships")
      .select("user_id, role, active")
      .eq("organization_id", organizationId),
  ])

  const failed = teamsResult.error ?? membersResult.error ?? membershipsResult.error

  if (failed) {
    throw new Error(`Não foi possível carregar as equipes (${failed.code ?? "erro"}).`)
  }

  const memberships = membershipsResult.data ?? []
  const userIds = memberships.map((membership) => membership.user_id)
  const profileById = new Map<string, { full_name: string | null; email: string | null }>()

  if (userIds.length > 0) {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds)

    if (error) {
      throw new Error(`Não foi possível carregar os nomes da equipe (${error.code ?? "erro"}).`)
    }

    for (const profile of profiles ?? []) {
      profileById.set(profile.id, profile)
    }
  }

  const people: TeamPerson[] = []

  for (const membership of memberships) {
    if (!isRole(membership.role)) {
      continue
    }

    const profile = profileById.get(membership.user_id)

    people.push({
      id: membership.user_id,
      name: profile?.full_name?.trim() || profile?.email || "Membro sem nome",
      role: membership.role,
      active: membership.active,
    })
  }

  people.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))

  return {
    teams: (teamsResult.data ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      leaderId: team.leader_id,
      createdAt: team.created_at,
    })),
    teamMembers: (membersResult.data ?? []).map((member) => ({
      userId: member.user_id,
      teamId: member.team_id,
    })),
    people,
  }
}
