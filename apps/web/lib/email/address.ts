import "server-only"

import { cleanText, normalizeEmailAddress } from "@workspace/core/email/sanitize"

import type { EmailAddress } from "@/lib/email/types"

/** Endereço validado (minúsculas) e nome limpo, ou null se o e-mail for inválido. */
export function normalizeRecipient(
  address: EmailAddress | null | undefined
): { email: string; name?: string } | null {
  const email = normalizeEmailAddress(address?.email)

  if (!email) {
    return null
  }

  const name = cleanText(address?.name, { maxLength: 70 })
  return name ? { email, name } : { email }
}
