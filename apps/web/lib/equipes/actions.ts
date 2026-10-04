"use server"

import { revalidatePath } from "next/cache"

import {
  checkAddMember,
  checkLeaderChoice,
  findTeamNameConflict,
  normalizeTeamName,
  type LeaderChoiceProblem,
  type TeamLike,
  type TeamMemberLike,
} from "@workspace/core/teams/rules"

import type { ActionResult } from "@/lib/auth/action-result"
import { INVALID_FIELDS_MESSAGE } from "@/lib/clientes/action-result"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { PERMISSION_DENIED_MESSAGE } from "@/lib/configuracoes/errors"
import { getFieldErrors } from "@/lib/configuracoes/schemas"
import { TEAM_EDITOR_ROLES, TEAMS_SETTINGS_PATH } from "@/lib/equipes/constants"
import {
  TEAM_NAME_TAKEN_MESSAGE,
  TEAM_NOT_FOUND_MESSAGE,
  translateTeamError,
} from "@/lib/equipes/errors"
import {
  addTeamMembersSchema,
  createTeamSchema,
  renameTeamSchema,
  setTeamLeaderSchema,
  teamIdSchema,
  teamMemberRefSchema,
  type AddTeamMembersValues,
  type CreateTeamValues,
  type RenameTeamValues,
  type SetTeamLeaderValues,
} from "@/lib/equipes/schemas"
import { createClient } from "@/lib/supabase/server"

// Toda action confere o papel no servidor (dono ou gerente) antes de tocar no
// banco, e o RLS de teams/team_members repete a mesma regra. A imobiliária vem
// da sessão, nunca do formulário.

const RELATORIOS_PATH = "/relatorios"

type Supabase = Awaited<ReturnType<typeof createClient>>

type TeamState = {
  teams: TeamLike[]
  teamMembers: TeamMemberLike[]
  members: { id: string; active: boolean }[]
}

function revalidateTeams() {
  revalidatePath(TEAMS_SETTINGS_PATH)
  revalidatePath(RELATORIOS_PATH)
}

/** Estado atual do banco (a tela pode estar desatualizada). */
async function loadTeamState(
  supabase: Supabase,
  organizationId: string
): Promise<{ ok: true; state: TeamState } | { ok: false; error: string }> {
  const [teams, teamMembers, memberships] = await Promise.all([
    supabase.from("teams").select("id, name, leader_id").eq("organization_id", organizationId),
    supabase.from("team_members").select("user_id, team_id").eq("organization_id", organizationId),
    supabase.from("memberships").select("user_id, active").eq("organization_id", organizationId),
  ])

  const failed = teams.error ?? teamMembers.error ?? memberships.error

  if (failed) {
    return { ok: false, error: translateTeamError(failed) }
  }

  return {
    ok: true,
    state: {
      teams: (teams.data ?? []).map((team) => ({
        id: team.id,
        name: team.name,
        leaderId: team.leader_id,
      })),
      teamMembers: (teamMembers.data ?? []).map((member) => ({
        userId: member.user_id,
        teamId: member.team_id,
      })),
      members: (memberships.data ?? []).map((membership) => ({
        id: membership.user_id,
        active: membership.active,
      })),
    },
  }
}

const LEADER_PROBLEM_MESSAGES: Record<LeaderChoiceProblem, string> = {
  not_member: "Essa pessoa não faz parte da imobiliária.",
  inactive: "O líder precisa ser um membro ativo da imobiliária.",
  other_team:
    "Essa pessoa está em outra equipe. Inclua-a nesta equipe primeiro (ela sai da outra) e depois escolha como líder.",
}

// ---------------------------------------------------------------------------
// Criar, renomear e excluir
// ---------------------------------------------------------------------------

export async function createTeam(
  values: CreateTeamValues
): Promise<FormActionResult<keyof CreateTeamValues>> {
  const parsed = createTeamSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof CreateTeamValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(TEAM_EDITOR_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const name = normalizeTeamName(parsed.data.name)
  const leaderId = parsed.data.leaderId || null
  const supabase = await createClient()
  const loaded = await loadTeamState(supabase, organizationId)

  if (!loaded.ok) {
    return loaded
  }

  if (findTeamNameConflict(name, loaded.state.teams)) {
    return {
      ok: false,
      error: TEAM_NAME_TAKEN_MESSAGE,
      fieldErrors: { name: TEAM_NAME_TAKEN_MESSAGE },
    }
  }

  if (leaderId) {
    // Equipe nova ainda não tem membros: o líder precisa estar sem equipe.
    const problem = checkLeaderChoice("__nova__", leaderId, loaded.state)

    if (problem) {
      const message = LEADER_PROBLEM_MESSAGES[problem]
      return { ok: false, error: message, fieldErrors: { leaderId: message } }
    }
  }

  // O gatilho teams_add_leader_as_member coloca o líder na equipe.
  const { data, error } = await supabase
    .from("teams")
    .insert({ organization_id: organizationId, name, leader_id: leaderId })
    .select("id")

  if (error) {
    const message = translateTeamError(error)
    return error.code === "23505"
      ? { ok: false, error: message, fieldErrors: { name: message } }
      : { ok: false, error: message }
  }

  if (!data?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidateTeams()
  return { ok: true, message: `Equipe "${name}" criada.` }
}

export async function renameTeam(
  values: RenameTeamValues
): Promise<FormActionResult<keyof RenameTeamValues>> {
  const parsed = renameTeamSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof RenameTeamValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(TEAM_EDITOR_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const name = normalizeTeamName(parsed.data.name)
  const supabase = await createClient()
  const loaded = await loadTeamState(supabase, organizationId)

  if (!loaded.ok) {
    return loaded
  }

  if (!loaded.state.teams.some((team) => team.id === parsed.data.teamId)) {
    return { ok: false, error: TEAM_NOT_FOUND_MESSAGE }
  }

  if (findTeamNameConflict(name, loaded.state.teams, parsed.data.teamId)) {
    return {
      ok: false,
      error: TEAM_NAME_TAKEN_MESSAGE,
      fieldErrors: { name: TEAM_NAME_TAKEN_MESSAGE },
    }
  }

  const { data, error } = await supabase
    .from("teams")
    .update({ name })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.teamId)
    .select("id")

  if (error) {
    const message = translateTeamError(error)
    return error.code === "23505"
      ? { ok: false, error: message, fieldErrors: { name: message } }
      : { ok: false, error: message }
  }

  if (!data?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidateTeams()
  return { ok: true, message: `Equipe renomeada para "${name}".` }
}

export async function deleteTeam(teamId: string): Promise<ActionResult> {
  const parsedId = teamIdSchema.safeParse(teamId)

  if (!parsedId.success) {
    return { ok: false, error: "Equipe inválida." }
  }

  const auth = await getActionMembership(TEAM_EDITOR_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  // Cascata do banco: os membros ficam sem equipe e as metas da equipe somem.
  const { data, error } = await supabase
    .from("teams")
    .delete()
    .eq("organization_id", auth.context.membership.organizationId)
    .eq("id", parsedId.data)
    .select("name")

  if (error) {
    return {
      ok: false,
      error: translateTeamError(error, "Não foi possível excluir a equipe agora."),
    }
  }

  if (!data?.length) {
    return { ok: false, error: TEAM_NOT_FOUND_MESSAGE }
  }

  revalidateTeams()
  return { ok: true, message: `Equipe "${data[0]?.name ?? ""}" excluída.` }
}

// ---------------------------------------------------------------------------
// Líder
// ---------------------------------------------------------------------------

export async function setTeamLeader(
  values: SetTeamLeaderValues
): Promise<FormActionResult<keyof SetTeamLeaderValues>> {
  const parsed = setTeamLeaderSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof SetTeamLeaderValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(TEAM_EDITOR_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const { teamId } = parsed.data
  const leaderId = parsed.data.leaderId || null
  const supabase = await createClient()
  const loaded = await loadTeamState(supabase, organizationId)

  if (!loaded.ok) {
    return loaded
  }

  const team = loaded.state.teams.find((candidate) => candidate.id === teamId)

  if (!team) {
    return { ok: false, error: TEAM_NOT_FOUND_MESSAGE }
  }

  if (team.leaderId === leaderId) {
    return { ok: true, message: "Nada mudou: o líder continua o mesmo." }
  }

  if (leaderId) {
    const problem = checkLeaderChoice(teamId, leaderId, loaded.state)

    if (problem) {
      const message = LEADER_PROBLEM_MESSAGES[problem]
      return { ok: false, error: message, fieldErrors: { leaderId: message } }
    }
  }

  const { data, error } = await supabase
    .from("teams")
    .update({ leader_id: leaderId })
    .eq("organization_id", organizationId)
    .eq("id", teamId)
    .select("id")

  if (error) {
    return { ok: false, error: translateTeamError(error) }
  }

  if (!data?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidateTeams()
  return {
    ok: true,
    message: leaderId ? "Líder atualizado." : "A equipe ficou sem líder.",
  }
}

// ---------------------------------------------------------------------------
// Membros
// ---------------------------------------------------------------------------

export async function addTeamMembers(
  values: AddTeamMembersValues
): Promise<FormActionResult<keyof AddTeamMembersValues>> {
  const parsed = addTeamMembersSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof AddTeamMembersValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(TEAM_EDITOR_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const { teamId } = parsed.data
  const userIds = [...new Set(parsed.data.userIds)]
  const supabase = await createClient()
  const loaded = await loadTeamState(supabase, organizationId)

  if (!loaded.ok) {
    return loaded
  }

  if (!loaded.state.teams.some((team) => team.id === teamId)) {
    return { ok: false, error: TEAM_NOT_FOUND_MESSAGE }
  }

  const toInsert: string[] = []
  const toMove: string[] = []

  for (const userId of userIds) {
    const check = checkAddMember(teamId, userId, loaded.state)

    if (check.ok) {
      const target = check.fromTeamId ? toMove : toInsert
      target.push(userId)
      continue
    }

    if (check.problem === "already_in_team") {
      continue
    }

    if (check.problem === "leads_other_team") {
      const other = loaded.state.teams.find((team) => team.id === check.teamId)
      return {
        ok: false,
        error: `Uma das pessoas marcadas é líder da equipe "${other?.name ?? "outra equipe"}". Troque o líder de lá antes de movê-la.`,
      }
    }

    return {
      ok: false,
      error:
        check.problem === "inactive"
          ? "Uma das pessoas marcadas está com o acesso desativado. Só membros ativos entram em equipe."
          : "Uma das pessoas marcadas não faz parte da imobiliária. Atualize a página.",
    }
  }

  if (toInsert.length === 0 && toMove.length === 0) {
    return { ok: true, message: "Essas pessoas já estavam na equipe." }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("team_members").insert(
      toInsert.map((userId) => ({
        organization_id: organizationId,
        user_id: userId,
        team_id: teamId,
      }))
    )

    if (error) {
      return { ok: false, error: translateTeamError(error) }
    }
  }

  if (toMove.length > 0) {
    const { data, error } = await supabase
      .from("team_members")
      .update({ team_id: teamId })
      .eq("organization_id", organizationId)
      .in("user_id", toMove)
      .select("user_id")

    if (error) {
      revalidateTeams()
      return { ok: false, error: translateTeamError(error) }
    }

    if ((data?.length ?? 0) < toMove.length) {
      revalidateTeams()
      return { ok: false, error: PERMISSION_DENIED_MESSAGE }
    }
  }

  revalidateTeams()

  const total = toInsert.length + toMove.length
  const moved = toMove.length > 0 ? ` (${toMove.length} saíram de outra equipe)` : ""

  return {
    ok: true,
    message: `${total === 1 ? "1 pessoa incluída" : `${total} pessoas incluídas`} na equipe${moved}.`,
  }
}

export async function removeTeamMember(teamId: string, userId: string): Promise<ActionResult> {
  const parsed = teamMemberRefSchema.safeParse({ teamId, userId })

  if (!parsed.success) {
    return { ok: false, error: "Pessoa ou equipe inválida." }
  }

  const auth = await getActionMembership(TEAM_EDITOR_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const supabase = await createClient()

  // Quem sai da equipe deixa de liderá-la: senão continuaria vendo os números
  // de uma equipe da qual não faz parte.
  const { error: leaderError } = await supabase
    .from("teams")
    .update({ leader_id: null })
    .eq("organization_id", organizationId)
    .eq("id", parsed.data.teamId)
    .eq("leader_id", parsed.data.userId)

  if (leaderError) {
    return { ok: false, error: translateTeamError(leaderError) }
  }

  const { data, error } = await supabase
    .from("team_members")
    .delete()
    .eq("organization_id", organizationId)
    .eq("team_id", parsed.data.teamId)
    .eq("user_id", parsed.data.userId)
    .select("user_id")

  if (error) {
    revalidateTeams()
    return {
      ok: false,
      error: translateTeamError(error, "Não foi possível retirar a pessoa agora."),
    }
  }

  revalidateTeams()

  if (!data?.length) {
    return { ok: false, error: "Essa pessoa já não estava na equipe. A página foi atualizada." }
  }

  return { ok: true, message: "Pessoa retirada da equipe. Ela entra só no total da imobiliária." }
}
