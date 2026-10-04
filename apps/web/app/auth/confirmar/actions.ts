"use server"

import { redirect } from "next/navigation"

import { defaultNextForEmailOtp, isEmailOtpType, isTokenHash } from "@/lib/auth/email-otp"
import { buildLoginPath, resolveSignUpNext } from "@/lib/auth/request"
import { sanitizeRedirectPath } from "@/lib/auth/routes"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

/**
 * Consome o `token_hash` do link de e-mail. Só roda no POST do botão
 * "Continuar" de /auth/confirmar (Server Actions conferem a origem do POST),
 * nunca num GET disparado sem interação.
 */
export async function confirmEmailLink(formData: FormData): Promise<void> {
  if (!isSupabaseConfigured()) {
    redirect("/")
  }

  const tokenHash = formData.get("token_hash")
  const type = formData.get("type")
  const rawNext = formData.get("next")

  if (!isTokenHash(tokenHash) || !isEmailOtpType(type)) {
    redirect(buildLoginPath({ erro: "link-invalido" }))
  }

  const next = sanitizeRedirectPath(
    typeof rawNext === "string" ? rawNext : null,
    defaultNextForEmailOtp(type)
  )

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  })

  if (error) {
    // Só o código do erro: nada de e-mail ou token no log.
    console.warn(`[auth/confirmar] verifyOtp falhou: ${error.code ?? error.name}`)

    redirect(
      buildLoginPath({
        erro: error.code === "otp_expired" ? "link-expirado" : "link-invalido",
        next,
      })
    )
  }

  // Cadastro sem imobiliária ainda: só o destino de convite escapa do
  // onboarding forçado (ver resolveSignUpNext).
  const finalNext = type === "signup" ? await resolveSignUpNext(supabase, next) : next

  redirect(finalNext)
}
