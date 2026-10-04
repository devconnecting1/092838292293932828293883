"use server"

import { revalidatePath } from "next/cache"

import { normalizePhoneBr } from "@workspace/core/br/documents"

import { translateAuthError } from "@/lib/auth/errors"
import { requireUser } from "@/lib/auth/session"
import type { FormActionResult } from "@/lib/configuracoes/action-context"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import {
  changePasswordSchema,
  getFieldErrors,
  profileSchema,
  type ChangePasswordValues,
  type ProfileValues,
} from "@/lib/configuracoes/schemas"
import { createClient } from "@/lib/supabase/server"

export async function updateProfile(
  values: ProfileValues
): Promise<FormActionResult<keyof ProfileValues>> {
  const parsed = profileSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: getFieldErrors<keyof ProfileValues>(parsed.error),
    }
  }

  const user = await requireUser()
  const data = parsed.data
  const supabase = await createClient()
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      full_name: data.fullName,
      phone: data.phone ? normalizePhoneBr(data.phone) : null,
      avatar_url: data.avatarUrl || null,
      creci_number: data.creciNumber || null,
      creci_state: data.creciState || null,
      creci_valid_until: data.creciValidUntil || null,
    })
    .eq("id", user.id)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!updated?.length) {
    return {
      ok: false,
      error: "Não encontramos seu perfil. Saia e entre novamente.",
    }
  }

  // Nome e foto aparecem no menu do usuário em todas as páginas.
  revalidatePath("/", "layout")

  return { ok: true, message: "Perfil atualizado." }
}

export async function changePassword(
  values: ChangePasswordValues
): Promise<FormActionResult<keyof ChangePasswordValues>> {
  const parsed = changePasswordSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: getFieldErrors<keyof ChangePasswordValues>(parsed.error),
    }
  }

  const user = await requireUser()

  if (!user.email) {
    return {
      ok: false,
      error: "Sua conta não tem e-mail cadastrado para confirmar a senha.",
    }
  }

  const supabase = await createClient()

  // Confirma a senha atual antes de trocar (protege sessões esquecidas abertas).
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  })

  if (verifyError) {
    if (verifyError.code === "invalid_credentials") {
      return {
        ok: false,
        error: "Senha atual incorreta.",
        fieldErrors: { currentPassword: "Senha atual incorreta." },
      }
    }

    return { ok: false, error: translateAuthError(verifyError) }
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  })

  if (error) {
    return {
      ok: false,
      error: translateAuthError(error),
      fieldErrors:
        error.code === "weak_password" || error.code === "same_password"
          ? { password: translateAuthError(error) }
          : undefined,
    }
  }

  return { ok: true, message: "Senha alterada." }
}
