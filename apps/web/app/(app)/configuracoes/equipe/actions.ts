"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"

import type { AppRole } from "@workspace/core/properties/enums"

import type { ActionResult } from "@/lib/auth/action-result"
import { TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { getActionMembership } from "@/lib/configuracoes/action-context"
import { PERMISSION_DENIED_MESSAGE, translateDatabaseError } from "@/lib/configuracoes/errors"
import { getInvitationExpiry } from "@/lib/configuracoes/invitations"
import { canManageRole } from "@/lib/configuracoes/roles"
import {
  getFieldErrors,
  invitationIdSchema,
  invitationSchema,
  membershipIdSchema,
  roleSchema,
  type InvitationValues,
} from "@/lib/configuracoes/schemas"
import { sendNotificationEmail } from "@/lib/email"
import { createClient } from "@/lib/supabase/server"
import { buildInvitationUrl } from "@/lib/tenant/urls"

const PAGE_PATH = "/configuracoes/equipe"

export type CreatedInvitation = {
  id: string
  email: string
  role: AppRole
  expiresAt: string
  url: string
}

export type CreateInvitationResult =
  | { ok: true; message: string; invitation: CreatedInvitation }
  | {
      ok: false
      error: string
      fieldErrors?: Partial<Record<keyof InvitationValues, string>>
    }

export async function createInvitation(values: InvitationValues): Promise<CreateInvitationResult> {
  const parsed = invitationSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: getFieldErrors<keyof InvitationValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const { membership } = auth.context
  const email = parsed.data.email.toLowerCase()
  const { role } = parsed.data

  if (!canManageRole(membership.role, role)) {
    return {
      ok: false,
      error: PERMISSION_DENIED_MESSAGE,
      fieldErrors: { role: "Seu papel não permite convidar para este papel." },
    }
  }

  const supabase = await createClient()

  // Quem já está ativo na equipe não precisa de convite.
  const { data: profiles } = await supabase.from("profiles").select("id").eq("email", email)
  const profileIds = (profiles ?? []).map((profile) => profile.id)

  if (profileIds.length > 0) {
    const { data: activeMembers } = await supabase
      .from("memberships")
      .select("id")
      .eq("organization_id", membership.organizationId)
      .eq("active", true)
      .in("user_id", profileIds)
      .limit(1)

    if (activeMembers?.length) {
      return {
        ok: false,
        error: "Esta pessoa já faz parte da equipe.",
        fieldErrors: { email: "Esta pessoa já faz parte da equipe." },
      }
    }
  }

  const { data: invitation, error } = await supabase
    .from("invitations")
    .insert({ organization_id: membership.organizationId, email, role })
    .select("id, email, role, token, expires_at")
    .single()

  if (error || !invitation) {
    if (error?.code === "23505") {
      const message =
        "Já existe um convite pendente para este e-mail. Renove ou revogue o convite na lista."
      return { ok: false, error: message, fieldErrors: { email: message } }
    }

    return {
      ok: false,
      error: error
        ? translateDatabaseError(error, "Não foi possível criar o convite agora.")
        : "Não foi possível criar o convite agora.",
    }
  }

  // Link no endereço da imobiliária que convida (lib/tenant/urls).
  const invitationUrl = buildInvitationUrl(membership.organization.slug, invitation.token)

  after(() =>
    sendNotificationEmail("team_invitation", {
      organizationSlug: membership.organization.slug,
      invitationId: invitation.id,
      to: invitation.email,
      organizationName: membership.organization.name,
      inviterName: auth.context.user.fullName,
      role: invitation.role,
      invitationUrl,
      expiresAt: invitation.expires_at,
    })
  )

  revalidatePath(PAGE_PATH)

  return {
    ok: true,
    message: "Convite criado. Envie o link para a pessoa.",
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expires_at,
      url: invitationUrl,
    },
  }
}

type TargetMembership = { id: string; user_id: string; role: AppRole }

async function loadManageableMembership(membershipId: string) {
  const parsedId = membershipIdSchema.safeParse(membershipId)

  if (!parsedId.success) {
    return { ok: false as const, error: "Membro inválido." }
  }

  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data: target, error } = await supabase
    .from("memberships")
    .select("id, user_id, role")
    .eq("id", parsedId.data)
    .eq("organization_id", auth.context.membership.organizationId)
    .maybeSingle<TargetMembership>()

  if (error) {
    return { ok: false as const, error: translateDatabaseError(error) }
  }

  if (!target) {
    return {
      ok: false as const,
      error: "Este membro não foi encontrado na imobiliária.",
    }
  }

  if (target.user_id === auth.context.user.id) {
    return {
      ok: false as const,
      error: "Você não pode alterar o próprio acesso. Peça a outro dono da imobiliária.",
    }
  }

  if (!canManageRole(auth.context.membership.role, target.role)) {
    return { ok: false as const, error: PERMISSION_DENIED_MESSAGE }
  }

  return {
    ok: true as const,
    supabase,
    target,
    actorRole: auth.context.membership.role,
  }
}

export async function updateMemberRole(membershipId: string, role: AppRole): Promise<ActionResult> {
  const parsedRole = roleSchema.safeParse(role)

  if (!parsedRole.success) {
    return { ok: false, error: "Selecione um papel válido." }
  }

  const loaded = await loadManageableMembership(membershipId)

  if (!loaded.ok) {
    return loaded
  }

  if (!canManageRole(loaded.actorRole, parsedRole.data)) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  if (loaded.target.role === parsedRole.data) {
    return { ok: true }
  }

  const { data: updated, error } = await loaded.supabase
    .from("memberships")
    .update({ role: parsedRole.data })
    .eq("id", loaded.target.id)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!updated?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return { ok: true, message: "Papel atualizado." }
}

export async function setMemberActive(
  membershipId: string,
  active: boolean
): Promise<ActionResult> {
  if (typeof active !== "boolean") {
    return { ok: false, error: "Ação inválida." }
  }

  const loaded = await loadManageableMembership(membershipId)

  if (!loaded.ok) {
    return loaded
  }

  const { data: updated, error } = await loaded.supabase
    .from("memberships")
    .update({ active })
    .eq("id", loaded.target.id)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!updated?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return {
    ok: true,
    message: active ? "Acesso reativado." : "Acesso desativado.",
  }
}

type TargetInvitation = {
  id: string
  role: AppRole
  accepted_at: string | null
}

async function loadManageableInvitation(invitationId: string) {
  const parsedId = invitationIdSchema.safeParse(invitationId)

  if (!parsedId.success) {
    return { ok: false as const, error: "Convite inválido." }
  }

  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data: invitation, error } = await supabase
    .from("invitations")
    .select("id, role, accepted_at")
    .eq("id", parsedId.data)
    .eq("organization_id", auth.context.membership.organizationId)
    .maybeSingle<TargetInvitation>()

  if (error) {
    return { ok: false as const, error: translateDatabaseError(error) }
  }

  if (!invitation) {
    return { ok: false as const, error: "Este convite não foi encontrado." }
  }

  if (invitation.accepted_at) {
    return { ok: false as const, error: "Este convite já foi aceito." }
  }

  if (!canManageRole(auth.context.membership.role, invitation.role)) {
    return { ok: false as const, error: PERMISSION_DENIED_MESSAGE }
  }

  return { ok: true as const, supabase, invitation }
}

/** Renova por mais 7 dias. O link continua o mesmo (o token não é editável pelo app). */
export async function renewInvitation(invitationId: string): Promise<ActionResult> {
  const loaded = await loadManageableInvitation(invitationId)

  if (!loaded.ok) {
    return loaded
  }

  const { data: updated, error } = await loaded.supabase
    .from("invitations")
    .update({ expires_at: getInvitationExpiry().toISOString() })
    .eq("id", loaded.invitation.id)
    .is("accepted_at", null)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!updated?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return {
    ok: true,
    message: "Convite renovado por mais 7 dias. O link continua o mesmo.",
  }
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const loaded = await loadManageableInvitation(invitationId)

  if (!loaded.ok) {
    return loaded
  }

  const { data: deleted, error } = await loaded.supabase
    .from("invitations")
    .delete()
    .eq("id", loaded.invitation.id)
    .is("accepted_at", null)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!deleted?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return { ok: true, message: "Convite revogado. O link deixou de funcionar." }
}
