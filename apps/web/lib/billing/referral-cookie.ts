import { REFERRAL_COOKIE_MAX_AGE_DAYS, REFERRAL_COOKIE_NAME } from "@workspace/core/billing"

import { getSessionCookieOptions } from "@/lib/supabase/cookie-options"

export { REFERRAL_COOKIE_NAME }

const DAY_SECONDS = 24 * 60 * 60

/**
 * Cookie `ref` do link de indicação: só o código (sem dado pessoal), httpOnly,
 * SameSite=Lax, Secure em produção. Usa o mesmo Domain dos cookies de sessão
 * (raiz compartilhada em produção) para o link funcionar em qualquer host; quem
 * apaga precisa passar o mesmo host.
 */
export function getReferralCookieOptions(host: string | null | undefined) {
  const domain = getSessionCookieOptions(host)?.domain

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: REFERRAL_COOKIE_MAX_AGE_DAYS * DAY_SECONDS,
    ...(domain ? { domain } : {}),
  }
}
