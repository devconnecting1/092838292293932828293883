import "server-only"

import { isSupabaseConfigured } from "@/lib/supabase/env"
import { createClient } from "@/lib/supabase/server"

/**
 * Janela em que uma sessão aberta pelo link de recuperação pode definir uma
 * nova senha sem informar a atual. Fora dela, a troca é feita em /perfil.
 */
export const RECOVERY_WINDOW_SECONDS = 15 * 60

export const RECOVERY_LINK_REQUIRED_MESSAGE =
  "Abra o link de recuperação mais recente para definir uma nova senha."

/**
 * Métodos do claim `amr` que o Supabase Auth grava quando a sessão nasce de um
 * link de recuperação:
 * - "recovery": resetPasswordForEmail no fluxo PKCE (/auth/callback). A troca
 *   do code usa o método guardado no flow state do pedido de recuperação.
 * - "otp": verifyOtp({ token_hash, type: "recovery" }) (/auth/confirmar). O
 *   servidor grava "otp" em toda verificação por token_hash, inclusive a de
 *   link mágico, que também prova a posse do e-mail.
 * Fonte: supabase/auth internal/api/verify.go (verifyPost emite models.OTP),
 * internal/api/token.go (PKCE usa flowState.AuthenticationMethod) e
 * internal/models/factor.go (IsRecovery: OTP, MagicLink e Recovery).
 */
const RECOVERY_AMR_METHODS: ReadonlySet<string> = new Set(["recovery", "otp"])

/** Tolerância de relógio entre o Supabase Auth e este servidor. */
const CLOCK_SKEW_SECONDS = 60

/**
 * Se o `amr` do JWT tem um método de recuperação usado nos últimos 15 minutos.
 * O formato RFC 8176 (lista de strings) não traz horário e é recusado.
 */
export function hasRecentRecoveryAuthentication(
  amr: unknown,
  nowSeconds: number = Math.floor(Date.now() / 1000)
) {
  if (!Array.isArray(amr)) {
    return false
  }

  return amr.some((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) {
      return false
    }

    const { method, timestamp } = entry as {
      method?: unknown
      timestamp?: unknown
    }

    return (
      typeof method === "string" &&
      RECOVERY_AMR_METHODS.has(method) &&
      typeof timestamp === "number" &&
      timestamp <= nowSeconds + CLOCK_SKEW_SECONDS &&
      nowSeconds - timestamp <= RECOVERY_WINDOW_SECONDS
    )
  })
}

export type RecoverySessionState =
  { status: "recovery"; email: string | null } | { status: "signed-in" } | { status: "anonymous" }

/** Situação da sessão atual em relação à redefinição de senha (JWT validado). */
export async function getRecoverySessionState(): Promise<RecoverySessionState> {
  if (!isSupabaseConfigured()) {
    return { status: "anonymous" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims

  if (error || !claims?.sub) {
    return { status: "anonymous" }
  }

  if (!hasRecentRecoveryAuthentication(claims.amr)) {
    return { status: "signed-in" }
  }

  const email = typeof claims.email === "string" && claims.email ? claims.email : null

  return { status: "recovery", email }
}
