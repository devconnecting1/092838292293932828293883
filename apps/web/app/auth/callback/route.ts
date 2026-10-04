import { NextResponse, type NextRequest } from "next/server"

import {
  exchangeAuthCode,
  getLinkErrorCode,
  getRequestOrigin,
  isSignUpSession,
  loginParamsForFailedExchange,
  redirectToLogin,
  resolveSignUpNext,
} from "@/lib/auth/request"
import { ONBOARDING_PATH, sanitizeRedirectPath } from "@/lib/auth/routes"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"
import { getDefaultRedirectPath } from "@/lib/tenant/server"

/**
 * Retorno dos links de e-mail no fluxo PKCE (confirmação de cadastro, link
 * mágico e recuperação de senha): troca o `code` por uma sessão.
 *
 * Esse fluxo depende do cookie com o code verifier gravado no navegador que
 * fez o pedido. Para links que funcionam em qualquer navegador, use os modelos
 * de e-mail apontando para /auth/confirm (token_hash).
 *
 * Nenhum parâmetro da URL concede acesso: a sessão só abre se o Supabase Auth
 * aceitar o code; `next` passa por sanitizeRedirectPath (caminho relativo com
 * allowlist) e o tipo do fluxo vem do `amr` do JWT emitido.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/", await getRequestOrigin()))
  }

  const { searchParams } = request.nextUrl
  const next = sanitizeRedirectPath(searchParams.get("next"), await getDefaultRedirectPath())

  const linkError = getLinkErrorCode(request)

  if (linkError) {
    return redirectToLogin({ erro: linkError, next })
  }

  const supabase = await createClient()
  const outcome = await exchangeAuthCode(supabase, searchParams, "auth/callback")

  if (!outcome.ok) {
    // `tipo=cadastro` só escolhe o texto do aviso exibido em /entrar.
    const signUpNotice = searchParams.get("tipo") === "cadastro" || next === ONBOARDING_PATH
    return redirectToLogin(loginParamsForFailedExchange(outcome.reason, next, signUpNotice))
  }

  // Cadastro sem imobiliária ainda: só o destino de convite escapa do
  // onboarding forçado (ver resolveSignUpNext). O tipo vem do JWT, não da URL.
  const finalNext = (await isSignUpSession(supabase))
    ? await resolveSignUpNext(supabase, next)
    : next

  return NextResponse.redirect(new URL(finalNext, await getRequestOrigin()))
}
