"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"

import { isPlatformAdminEmail } from "@workspace/core/caixa/platform-admins"
import {
  isPlatformStaffRole,
  isPlatformTeamId,
  normalizePlatformTeamEmail,
  PLATFORM_ROLE_LABELS,
  PLATFORM_TEAM_OWNER_ONLY_MESSAGE,
  PLATFORM_TEAM_PATH,
  type PlatformStaffRole,
} from "@workspace/core/platform/staff"

import { canManageTeam, getPlatformAdmin, type PlatformAdmin } from "@/lib/plataforma/admin"
import {
  invitePlatformTeamMember,
  listPlatformTeam,
  notifyPlatformOwnersOfTeamChange,
  removePlatformTeamMember,
  resendPlatformTeamInvitation,
  revokePlatformTeamInvitation,
  setPlatformTeamMemberRole,
  type IssuedInvitation,
} from "@/lib/plataforma/equipe"
import { PLATFORM_RPC_FAILURE_MESSAGES } from "@/lib/plataforma/rpc"

/**
 * Server Actions da equipe do Console da Plataforma. Só o Dono
 * (PLATFORM_ADMIN_EMAILS) convida, reenvia, revoga, muda o papel e remove.
 * Cada action confere a sessão de novo (a página não roda antes dela), valida
 * a entrada no servidor e chama a RPC, que confere mais uma vez e grava o
 * registro do console na mesma transação. As Server Actions do Next já recusam
 * chamadas de outra origem (Origin ≠ Host).
 */

export type TeamActionResult = { ok: true; message: string } | { ok: false; error: string }

export type InviteActionResult =
  | {
      ok: true
      message: string
      /** Só quando o e-mail não saiu: o Dono manda o link por outro meio. */
      manualLink: string | null
    }
  | { ok: false; error: string; fieldErrors?: Partial<Record<"email" | "role", string>> }

type Failure = { ok: false; error: string }

const INVALID_INVITATION: Failure = {
  ok: false,
  error: "Convite inválido. Atualize a página.",
}
const INVALID_MEMBER: Failure = {
  ok: false,
  error: "Pessoa inválida. Atualize a página.",
}

type OwnerCheck = { ok: true; owner: PlatformAdmin } | { ok: false; error: string }

async function requireOwner(): Promise<OwnerCheck> {
  const admin = await getPlatformAdmin()

  if (!admin) {
    return { ok: false, error: PLATFORM_RPC_FAILURE_MESSAGES.sem_acesso }
  }

  if (!canManageTeam(admin)) {
    return { ok: false, error: PLATFORM_TEAM_OWNER_ONLY_MESSAGE }
  }

  return { ok: true, owner: admin }
}

function deliveryMessage(invitation: IssuedInvitation): string {
  const action = invitation.resent ? "Convite reenviado" : "Convite criado"

  switch (invitation.delivery) {
    case "enviado":
      return `${action}: enviamos o link para ${invitation.email}.`
    case "simulado":
      return `${action}, mas o envio de e-mail está em modo simulado neste ambiente. Copie o link abaixo e mande para ${invitation.email}.`
    default:
      return `${action}, mas o e-mail não saiu. Copie o link abaixo e mande para ${invitation.email} por outro meio.`
  }
}

export async function inviteTeamMemberAction(values: unknown): Promise<InviteActionResult> {
  const check = await requireOwner()

  if (!check.ok) {
    return check
  }

  const record =
    typeof values === "object" && values !== null ? (values as Record<string, unknown>) : {}
  const email = normalizePlatformTeamEmail(record.email)
  const role = record.role

  if (!email || !isPlatformStaffRole(role)) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: {
        ...(email ? {} : { email: "Informe um e-mail válido." }),
        ...(isPlatformStaffRole(role) ? {} : { role: "Escolha o papel." }),
      },
    }
  }

  if (isPlatformAdminEmail(email, process.env.PLATFORM_ADMIN_EMAILS)) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: {
        email: "Este e-mail já é Dono pela configuração do servidor e não precisa de convite.",
      },
    }
  }

  const result = await invitePlatformTeamMember({ email, role })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  revalidatePath(PLATFORM_TEAM_PATH)

  return {
    ok: true,
    message: deliveryMessage(result.data),
    manualLink: result.data.manualLink,
  }
}

export async function resendTeamInvitationAction(
  invitationId: string
): Promise<InviteActionResult> {
  const check = await requireOwner()

  if (!check.ok) {
    return check
  }

  if (!isPlatformTeamId(invitationId)) {
    return INVALID_INVITATION
  }

  const result = await resendPlatformTeamInvitation(invitationId)

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  revalidatePath(PLATFORM_TEAM_PATH)

  return {
    ok: true,
    message: deliveryMessage(result.data),
    manualLink: result.data.manualLink,
  }
}

export async function revokeTeamInvitationAction(invitationId: string): Promise<TeamActionResult> {
  const check = await requireOwner()

  if (!check.ok) {
    return check
  }

  if (!isPlatformTeamId(invitationId)) {
    return INVALID_INVITATION
  }

  const result = await revokePlatformTeamInvitation(invitationId)

  if (!result.ok) {
    return result
  }

  revalidatePath(PLATFORM_TEAM_PATH)
  return { ok: true, message: "Convite revogado: o link parou de valer." }
}

/** Pessoa ativa na equipe, relida do banco (e-mail para o aviso aos Donos). */
async function findActiveMember(
  userId: string
): Promise<{ ok: true; email: string; role: PlatformStaffRole } | { ok: false; error: string }> {
  const team = await listPlatformTeam()

  if (!team.ok) {
    return { ok: false, error: team.message }
  }

  const member = team.data.members.find((entry) => entry.userId === userId)

  return member
    ? { ok: true, email: member.email, role: member.role }
    : { ok: false, error: "Esta pessoa não está mais na equipe. Atualize a página." }
}

export async function changeTeamMemberRoleAction(
  userId: string,
  role: unknown
): Promise<TeamActionResult> {
  const check = await requireOwner()

  if (!check.ok) {
    return check
  }

  if (!isPlatformTeamId(userId)) {
    return INVALID_MEMBER
  }

  if (!isPlatformStaffRole(role)) {
    return { ok: false, error: "Escolha Administrador ou Somente leitura." }
  }

  const member = await findActiveMember(userId)

  if (!member.ok) {
    return member
  }

  const result = await setPlatformTeamMemberRole({ userId, role })

  if (!result.ok) {
    return result
  }

  const occurredAt = new Date().toISOString()

  after(() =>
    notifyPlatformOwnersOfTeamChange({
      kind: "role_changed",
      memberUserId: userId,
      memberEmail: member.email,
      role,
      previousRole: result.data.previousRole,
      actorEmail: check.owner.email,
      occurredAt,
    })
  )

  revalidatePath(PLATFORM_TEAM_PATH)
  return {
    ok: true,
    message: `${member.email} agora é ${PLATFORM_ROLE_LABELS[role]}. Vale a partir do próximo clique no console.`,
  }
}

export async function removeTeamMemberAction(userId: string): Promise<TeamActionResult> {
  const check = await requireOwner()

  if (!check.ok) {
    return check
  }

  if (!isPlatformTeamId(userId)) {
    return INVALID_MEMBER
  }

  const member = await findActiveMember(userId)

  if (!member.ok) {
    return member
  }

  const result = await removePlatformTeamMember(userId)

  if (!result.ok) {
    return result
  }

  const occurredAt = new Date().toISOString()

  after(() =>
    notifyPlatformOwnersOfTeamChange({
      kind: "removed",
      memberUserId: userId,
      memberEmail: member.email,
      role: result.data.role,
      actorEmail: check.owner.email,
      occurredAt,
    })
  )

  revalidatePath(PLATFORM_TEAM_PATH)
  return {
    ok: true,
    message: `${member.email} saiu da equipe. O acesso ao console acabou na hora.`,
  }
}
