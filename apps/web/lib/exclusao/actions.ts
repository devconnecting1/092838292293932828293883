"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { ORGANIZATION_COOKIE_NAME } from "@/lib/auth/organization-cookie"
import { LOGIN_PATH } from "@/lib/auth/routes"
import { requireMembership, requireUser } from "@/lib/auth/session"
import { translateDatabaseError, type DatabaseErrorLike } from "@/lib/clientes/db-errors"
import { sendOrganizationDeletionNotice } from "@/lib/exclusao/email"
import { formatDeletionDate } from "@/lib/exclusao/constants"
import { createClient } from "@/lib/supabase/server"

const confirmationSchema = z.string().trim().min(1).max(320)

const scheduleResultSchema = z.object({
  execute_after: z.string(),
  organization_slug: z.string(),
  organization_name: z.string(),
  brand_color: z.string().nullable(),
  owner_emails: z.array(z.string()),
})

const OWNER_ONLY = "Só o dono da imobiliária pode excluir a imobiliária."

/** As funções da exclusão já escrevem as mensagens em pt-BR, sem dado pessoal de terceiros. */
function translateDeletionError(error: DatabaseErrorLike, action: string) {
  if (error.code === "42501") {
    return OWNER_ONLY
  }

  if (
    error.code === "22023" ||
    error.code === "55000" ||
    error.hint === "assinatura_ativa" ||
    error.hint === "unico_dono"
  ) {
    return error.message
  }

  return translateDatabaseError(error, action)
}

/** Agenda a exclusão da imobiliária atual para daqui a 30 dias (só o dono). */
export async function scheduleOrganizationDeletion(confirmation: string): Promise<ActionResult> {
  const typed = confirmationSchema.safeParse(confirmation)

  if (!typed.success) {
    return { ok: false, error: "Digite o nome ou o link da imobiliária para confirmar." }
  }

  const { membership } = await requireMembership()

  if (membership.role !== "owner") {
    return { ok: false, error: OWNER_ONLY }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("schedule_organization_deletion", {
    p_organization_id: membership.organizationId,
    p_confirmation: typed.data,
  })

  if (error) {
    return { ok: false, error: translateDeletionError(error, "excluir a imobiliária") }
  }

  const parsed = scheduleResultSchema.safeParse(data)

  if (parsed.success) {
    const result = parsed.data
    after(() =>
      sendOrganizationDeletionNotice("scheduled", {
        organizationId: membership.organizationId,
        organizationSlug: result.organization_slug,
        organizationName: result.organization_name,
        brandColor: result.brand_color,
        executeAfter: result.execute_after,
        recipients: result.owner_emails,
      })
    )
  }

  revalidatePath("/", "layout")

  return {
    ok: true,
    message: parsed.success
      ? `Exclusão agendada para ${formatDeletionDate(parsed.data.execute_after)}. A conta ficou em modo leitura.`
      : "Exclusão agendada. A conta ficou em modo leitura.",
  }
}

/** Cancela a exclusão agendada (só o dono): a escrita volta na hora. */
export async function cancelOrganizationDeletion(): Promise<ActionResult> {
  const { membership } = await requireMembership()

  if (membership.role !== "owner") {
    return { ok: false, error: "Só o dono da imobiliária pode cancelar a exclusão." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_organization_deletion", {
    p_organization_id: membership.organizationId,
  })

  if (error) {
    return { ok: false, error: translateDeletionError(error, "cancelar a exclusão") }
  }

  revalidatePath("/", "layout")

  return { ok: true, message: "Exclusão cancelada. A imobiliária voltou ao normal." }
}

/**
 * Exclui a própria conta: o banco anonimiza o perfil e desativa todos os
 * acessos; aqui as sessões de todos os aparelhos são encerradas
 * (signOut global — supabase.com/docs/guides/auth/signout) e a pessoa volta
 * para a tela de entrada.
 */
export async function deleteMyAccount(confirmation: string): Promise<ActionResult> {
  const typed = confirmationSchema.safeParse(confirmation)

  if (!typed.success) {
    return { ok: false, error: "Digite o seu e-mail de acesso para confirmar." }
  }

  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_my_account", { p_confirmation: typed.data })

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "Entre de novo para excluir a sua conta."
          : translateDeletionError(error, "excluir a sua conta"),
    }
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" })

  if (signOutError) {
    // A conta já foi excluída (sem acesso a nenhuma imobiliária); o token atual
    // vence sozinho. Só o código no log.
    console.error(`[exclusao] signOut global falhou (código ${signOutError.code ?? "vazio"})`)
  }

  const cookieStore = await cookies()
  cookieStore.delete(ORGANIZATION_COOKIE_NAME)

  redirect(LOGIN_PATH)
}
