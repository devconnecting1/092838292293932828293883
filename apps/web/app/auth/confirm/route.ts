import { NextResponse, type NextRequest } from "next/server"

import { defaultNextForEmailOtp, isEmailOtpType, isTokenHash } from "@/lib/auth/email-otp"
import {
  exchangeAuthCode,
  getLinkErrorCode,
  getRequestOrigin,
  loginParamsForFailedExchange,
  redirectToLogin,
} from "@/lib/auth/request"
import { CONFIRM_LINK_PATH, ONBOARDING_PATH, sanitizeRedirectPath } from "@/lib/auth/routes"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"
import { getDefaultRedirectPath } from "@/lib/tenant/server"

/**
 * Links de e-mail com `token_hash`, no formato
 * {{ .RedirectTo }} ou {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...&next=...
 *
 * O GET não consome o token: filtros antivírus e pré-visualizações de e-mail
 * abrem links sozinhos, e um link plantado por terceiros abriria a sessão de
 * outra pessoa neste navegador (login forçado). O GET só leva à página
 * /auth/confirmar, e o verifyOtp roda no POST feito pelo botão "Continuar".
 */
export async function GET(request: NextRequest) {
  const origin = await getRequestOrigin()

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/", origin))
  }

  const { searchParams } = request.nextUrl
  const defaultNext = await getDefaultRedirectPath()

  const linkError = getLinkErrorCode(request)

  if (linkError) {
    return redirectToLogin({
      erro: linkError,
      next: sanitizeRedirectPath(searchParams.get("next"), defaultNext),
    })
  }

  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type")

  // Formato validado por type guards; o token só é conferido no POST (verifyOtp).
  if (isTokenHash(tokenHash) && isEmailOtpType(type)) {
    const next = sanitizeRedirectPath(searchParams.get("next"), defaultNextForEmailOtp(type))
    const url = new URL(CONFIRM_LINK_PATH, origin)

    url.searchParams.set("token_hash", tokenHash)
    url.searchParams.set("type", type)
    url.searchParams.set("next", next)

    return NextResponse.redirect(url)
  }

  // Compatibilidade com links no formato PKCE (?code=). A troca exige o code
  // verifier gravado neste navegador, então não serve para login forçado.
  const next = sanitizeRedirectPath(searchParams.get("next"), defaultNext)
  const supabase = await createClient()
  const outcome = await exchangeAuthCode(supabase, searchParams, "auth/confirm")

  if (!outcome.ok) {
    return redirectToLogin(
      loginParamsForFailedExchange(outcome.reason, next, next === ONBOARDING_PATH)
    )
  }

  return NextResponse.redirect(new URL(next, origin))
}
