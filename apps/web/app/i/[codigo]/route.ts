import { NextResponse, type NextRequest } from "next/server"

import { normalizeReferralCode } from "@workspace/core/billing"

import { SIGN_UP_PATH } from "@/lib/auth/routes"
import { getReferralCookieOptions, REFERRAL_COOKIE_NAME } from "@/lib/billing/referral-cookie"
import { buildAppUrl } from "@/lib/tenant/urls"

/**
 * Link público de indicação (/i/{código}). Valida só o formato, grava o cookie
 * `ref` e leva ao cadastro. A resposta é a mesma para código existente,
 * inexistente ou inválido (não revela nada). First-touch: um cookie `ref`
 * válido já presente não é substituído. A atribuição acontece ao criar a
 * imobiliária (onboarding), com as checagens antifraude do banco.
 */

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, context: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await context.params
  const code = normalizeReferralCode(codigo)
  const response = NextResponse.redirect(buildAppUrl(SIGN_UP_PATH), 307)

  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  response.headers.set("X-Robots-Tag", "noindex, nofollow")

  const existing = normalizeReferralCode(request.cookies.get(REFERRAL_COOKIE_NAME)?.value)

  if (code && !existing) {
    response.cookies.set(
      REFERRAL_COOKIE_NAME,
      code,
      getReferralCookieOptions(request.headers.get("host"))
    )
  }

  return response
}
