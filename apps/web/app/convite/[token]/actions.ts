"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import {
  ORGANIZATION_COOKIE_NAME,
  ORGANIZATION_COOKIE_OPTIONS,
} from "@/lib/auth/organization-cookie"
import { HOME_PATH, LOGIN_PATH, TENANT_PICKER_PATH } from "@/lib/auth/routes"
import { getCurrentUser } from "@/lib/auth/session"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import {
  buildInvitationPath,
  classifyAcceptInvitationDenial,
  isInvitationToken,
} from "@/lib/configuracoes/invitations"
import { createClient } from "@/lib/supabase/server"
import {
  buildAppUrl,
  buildTenantUrl,
  isSubdomainTenancy,
  isValidTenantSlug,
} from "@/lib/tenant/urls"

const INVALID_INVITATION =
  "Este convite não é válido ou já foi usado. Peça um novo link a quem convidou você."

export type AcceptInvitationResult =
  | { ok: true; message?: string }
  | {
      ok: false
      error: string
      /** Orientação específica na tela do convite. */
      reason?: "email_not_confirmed" | "email_mismatch"
    }

function loginUrlFor(token: string) {
  const params = new URLSearchParams({ next: buildInvitationPath(token) })
  return `${LOGIN_PATH}?${params.toString()}`
}

export async function acceptInvitation(token: string): Promise<AcceptInvitationResult> {
  if (!isInvitationToken(token)) {
    return { ok: false, error: INVALID_INVITATION }
  }

  const user = await getCurrentUser()

  if (!user) {
    redirect(loginUrlFor(token))
  }

  const supabase = await createClient()
  const { data: organizationId, error } = await supabase.rpc("accept_invitation", {
    p_token: token,
  })

  if (error) {
    switch (error.code) {
      case "P0002":
        return { ok: false, error: INVALID_INVITATION }
      case "22023":
        return {
          ok: false,
          error: "Este convite expirou. Peça a quem convidou você para renová-lo.",
        }
      case "42501": {
        // Mesmo código para motivos diferentes: a distinção é pela mensagem.
        const reason = classifyAcceptInvitationDenial(error.message)

        if (reason === "email_not_confirmed") {
          return {
            ok: false,
            reason,
            error: "Confirme seu e-mail pelo link que enviamos e depois volte a este convite.",
          }
        }

        if (reason === "unauthenticated") {
          redirect(loginUrlFor(token))
        }

        if (reason === "email_mismatch") {
          return {
            ok: false,
            reason,
            error: user.email
              ? `Este convite foi enviado para outro e-mail. Você entrou como ${user.email}: saia e entre com o e-mail que recebeu o convite.`
              : "Este convite foi enviado para outro e-mail. Saia e entre com o e-mail que recebeu o convite.",
          }
        }

        return {
          ok: false,
          error:
            "Não foi possível aceitar o convite com esta conta. Confira se entrou com o e-mail que recebeu o convite.",
        }
      }
      default:
        return {
          ok: false,
          error: translateDatabaseError(
            error,
            "Não foi possível aceitar o convite agora. Tente novamente."
          ),
        }
    }
  }

  if (typeof organizationId !== "string") {
    return {
      ok: false,
      error: "O convite foi aceito, mas não recebemos a imobiliária. Abra o painel.",
    }
  }

  // Host único: a imobiliária do convite vira a escolha do cookie.
  if (!isSubdomainTenancy()) {
    const cookieStore = await cookies()
    cookieStore.set(ORGANIZATION_COOKIE_NAME, organizationId, ORGANIZATION_COOKIE_OPTIONS)

    revalidatePath("/", "layout")
    redirect(HOME_PATH)
  }

  // Agora membro, o RLS libera ler o slug: o painel fica no subdomínio dela.
  const { data: organization } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .maybeSingle()

  revalidatePath("/", "layout")

  if (organization && isValidTenantSlug(organization.slug)) {
    redirect(buildTenantUrl(organization.slug, HOME_PATH))
  }

  redirect(buildAppUrl(TENANT_PICKER_PATH))
}

/** Sai da conta atual e volta ao login já apontando para o convite. */
export async function switchAccount(token: string): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "local" })

  const cookieStore = await cookies()
  cookieStore.delete(ORGANIZATION_COOKIE_NAME)

  redirect(isInvitationToken(token) ? loginUrlFor(token) : LOGIN_PATH)
}
