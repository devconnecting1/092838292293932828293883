import type { EmailOtpType } from "@supabase/supabase-js"

import { HOME_PATH, ONBOARDING_PATH, RESET_PASSWORD_PATH } from "@/lib/auth/routes"

// Links de e-mail no formato {{ .SiteURL }}/auth/confirm?token_hash=...&type=...&next=...

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]

export function isEmailOtpType(value: unknown): value is EmailOtpType {
  return typeof value === "string" && (EMAIL_OTP_TYPES as readonly string[]).includes(value)
}

/** O Supabase gera o token_hash em hexadecimal (com prefixo "pkce_" no PKCE). */
export function isTokenHash(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value)
}

/** Destino padrão depois de confirmar o link, quando não há `next` válido. */
export function defaultNextForEmailOtp(type: EmailOtpType) {
  if (type === "recovery") return RESET_PASSWORD_PATH
  if (type === "signup") return ONBOARDING_PATH
  return HOME_PATH
}
