"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"

import { isPlatformAdminEmail } from "@workspace/core/caixa/platform-admins"
import {
  buildPlatformTeamInvitationPath,
  isPlatformTeamInvitationToken,
  PLATFORM_TEAM_ERROR_MESSAGES,
  PLATFORM_TEAM_PATH,
  type PlatformTeamErrorCode,
} from "@workspace/core/platform/staff"

import { ORGANIZATION_COOKIE_NAME } from "@/lib/auth/organization-cookie"
import { LOGIN_PATH, PLATFORM_ADMIN_PATH_PREFIX } from "@/lib/auth/routes"
import {
  acceptPlatformTeamInvitation,
  notifyPlatformOwnersOfTeamChange,
} from "@/lib/plataforma/equipe"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

export type AcceptTeamInvitationResult = {
  ok: false
  error: string
  code?: PlatformTeamErrorCode | null
}

function loginUrlFor(token: string) {
  const next = isPlatformTeamInvitationToken(token)
    ? buildPlatformTeamInvitationPath(token)
    : PLATFORM_ADMIN_PATH_PREFIX
  return `${LOGIN_PATH}?${new URLSearchParams({ next }).toString()}`
}

/**
 * Aceite do convite para a equipe da plataforma. Só vale com clique (nunca
 * automático): a identidade vem de `auth.getUser()` (consulta o Auth) e o banco
 * confere de novo que o e-mail da conta é o convidado e está confirmado, que o
 * token vale e não foi usado nem revogado. Em caso de sucesso, os Donos recebem
 * um aviso e a pessoa vai para o console.
 */
export async function acceptTeamInvitationAction(
  token: string
): Promise<AcceptTeamInvitationResult> {
  if (!isPlatformTeamInvitationToken(token)) {
    return {
      ok: false,
      code: "convite_invalido",
      error: PLATFORM_TEAM_ERROR_MESSAGES.convite_invalido,
    }
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, error: "O Supabase ainda não foi configurado neste ambiente." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  const user = data?.user

  if (error || !user?.email) {
    redirect(loginUrlFor(token))
  }

  if (!user.email_confirmed_at) {
    return {
      ok: false,
      code: "email_nao_confirmado",
      error: PLATFORM_TEAM_ERROR_MESSAGES.email_nao_confirmado,
    }
  }

  if (isPlatformAdminEmail(user.email, process.env.PLATFORM_ADMIN_EMAILS)) {
    return {
      ok: false,
      error:
        "Sua conta já é Dona da plataforma pela configuração do servidor: não precisa de convite.",
    }
  }

  const result = await acceptPlatformTeamInvitation(token, user.id)

  if (!result.ok) {
    return { ok: false, code: result.code, error: result.error }
  }

  const occurredAt = new Date().toISOString()
  const { email, role } = result.data

  after(() =>
    notifyPlatformOwnersOfTeamChange({
      kind: "joined",
      memberUserId: user.id,
      memberEmail: email,
      role,
      occurredAt,
    })
  )

  revalidatePath(PLATFORM_TEAM_PATH)
  redirect(PLATFORM_ADMIN_PATH_PREFIX)
}

/** Sai da conta atual e volta ao login já apontando para o convite. */
export async function switchAccountForTeamInvitation(token: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient()
    await supabase.auth.signOut({ scope: "local" })
  }

  const cookieStore = await cookies()
  cookieStore.delete(ORGANIZATION_COOKIE_NAME)

  redirect(loginUrlFor(token))
}
