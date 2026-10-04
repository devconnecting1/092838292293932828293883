// Regras puras das equipes comerciais (public.teams e public.team_members).
//
// O banco já garante o essencial: nome único por imobiliária (sem diferença de
// maiúsculas), uma equipe por pessoa (chave organization_id + user_id) e líder
// membro ativo. Estas funções repetem as regras para a tela avisar antes de
// gravar e para as Server Actions recusarem combinações que o banco aceitaria,
// mas que deixariam a equipe incoerente (ex.: líder que está em outra equipe).

/** Mesmo teto do CHECK teams_name_length. */
export const TEAM_NAME_MAX_LENGTH = 80

export type TeamLike = {
  id: string
  name: string
  leaderId: string | null
}

export type TeamMemberLike = {
  userId: string
  teamId: string
}

export type MemberLike = {
  id: string
  active: boolean
}

/** Tira espaços das pontas e junta espaços repetidos ("  Zona   Sul " → "Zona Sul"). */
export function normalizeTeamName(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/** Chave de comparação do nome (a mesma ideia do índice lower(btrim(name))). */
export function teamNameKey(value: string): string {
  return normalizeTeamName(value).toLocaleLowerCase("pt-BR")
}

/** Equipe que já usa o nome (ignorando a própria equipe ao renomear). */
export function findTeamNameConflict<T extends TeamLike>(
  name: string,
  teams: readonly T[],
  exceptTeamId?: string | null
): T | null {
  const key = teamNameKey(name)

  if (!key) {
    return null
  }

  return teams.find((team) => team.id !== exceptTeamId && teamNameKey(team.name) === key) ?? null
}

/** Em que equipe a pessoa está (ou null). */
export function teamIdOf(userId: string, teamMembers: readonly TeamMemberLike[]): string | null {
  return teamMembers.find((member) => member.userId === userId)?.teamId ?? null
}

/** Equipes que a pessoa lidera. */
export function teamsLedBy<T extends TeamLike>(userId: string, teams: readonly T[]): T[] {
  return teams.filter((team) => team.leaderId === userId)
}

export type LeaderChoiceProblem = "not_member" | "inactive" | "other_team"

/**
 * Pode ser líder da equipe quem é membro ATIVO e está nesta equipe ou em
 * nenhuma (o banco coloca o líder na equipe sozinho). Quem está em outra equipe
 * precisa ser movido antes: senão lideraria uma equipe sem fazer parte dela.
 */
export function checkLeaderChoice(
  teamId: string,
  userId: string,
  context: { members: readonly MemberLike[]; teamMembers: readonly TeamMemberLike[] }
): LeaderChoiceProblem | null {
  const member = context.members.find((candidate) => candidate.id === userId)

  if (!member) {
    return "not_member"
  }

  if (!member.active) {
    return "inactive"
  }

  const currentTeam = teamIdOf(userId, context.teamMembers)
  return currentTeam !== null && currentTeam !== teamId ? "other_team" : null
}

/** Quem aparece na escolha de líder, na ordem recebida. */
export function leaderCandidates<M extends MemberLike>(
  teamId: string,
  context: { members: readonly M[]; teamMembers: readonly TeamMemberLike[] }
): M[] {
  return context.members.filter(
    (member) => checkLeaderChoice(teamId, member.id, { ...context, members: [member] }) === null
  )
}

export type AddMemberCheck =
  | { ok: true; fromTeamId: string | null }
  | { ok: false; problem: "not_member" | "inactive" | "already_in_team" }
  | { ok: false; problem: "leads_other_team"; teamId: string }

/**
 * Incluir alguém na equipe. Quem está em outra equipe é MOVIDO (a chave do
 * banco só permite uma equipe por pessoa), exceto o líder de outra equipe: ele
 * precisa deixar a liderança antes, para aquela equipe não ficar com um líder
 * de fora.
 */
export function checkAddMember(
  teamId: string,
  userId: string,
  context: {
    teams: readonly TeamLike[]
    members: readonly MemberLike[]
    teamMembers: readonly TeamMemberLike[]
  }
): AddMemberCheck {
  const member = context.members.find((candidate) => candidate.id === userId)

  if (!member) {
    return { ok: false, problem: "not_member" }
  }

  if (!member.active) {
    return { ok: false, problem: "inactive" }
  }

  const currentTeam = teamIdOf(userId, context.teamMembers)

  if (currentTeam === teamId) {
    return { ok: false, problem: "already_in_team" }
  }

  const ledElsewhere = teamsLedBy(userId, context.teams).find((team) => team.id !== teamId)

  if (ledElsewhere) {
    return { ok: false, problem: "leads_other_team", teamId: ledElsewhere.id }
  }

  return { ok: true, fromTeamId: currentTeam }
}

/** Membros ativos fora de qualquer equipe (entram só no total da imobiliária). */
export function membersWithoutTeam<M extends MemberLike>(
  members: readonly M[],
  teamMembers: readonly TeamMemberLike[]
): M[] {
  const inTeam = new Set(teamMembers.map((member) => member.userId))
  return members.filter((member) => member.active && !inTeam.has(member.id))
}
