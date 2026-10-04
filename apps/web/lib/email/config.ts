import "server-only"

import { cleanText, normalizeEmailAddress } from "@workspace/core/email/sanitize"

import type { EmailAddress } from "@/lib/email/types"

export const DEFAULT_SENDER_NAME = "CRM Imobiliário"

export type EmailSender = { email: string; name: string }

export type EmailConfig = {
  /** BREVO_API_KEY (API v3, começa com xkeysib-). Sem ela, modo simulado. */
  apiKey: string | null
  /** EMAIL_FROM_ADDRESS + EMAIL_FROM_NAME; null se o endereço estiver ausente ou inválido. */
  sender: EmailSender | null
  replyTo: EmailAddress | null
}

const warned = new Set<string>()

/** Avisa uma vez por processo, só com o nome da variável (nunca o valor). */
function warnOnce(key: string, message: string) {
  if (!warned.has(key)) {
    warned.add(key)
    console.warn(message)
  }
}

export function readEmailConfig(): EmailConfig {
  const apiKey = process.env.BREVO_API_KEY?.trim() || null
  const fromEmail = normalizeEmailAddress(process.env.EMAIL_FROM_ADDRESS)
  const fromName = cleanText(process.env.EMAIL_FROM_NAME, { maxLength: 70 }) || DEFAULT_SENDER_NAME
  const replyToRaw = process.env.EMAIL_REPLY_TO?.trim()
  const replyTo = replyToRaw ? normalizeEmailAddress(replyToRaw) : null

  if (apiKey?.startsWith("xsmtpsib-")) {
    warnOnce(
      "smtp-key",
      "[email] BREVO_API_KEY parece ser a chave SMTP: use a API key v3 (Brevo > SMTP & API > API Keys)"
    )
  }

  if (apiKey && !fromEmail) {
    warnOnce(
      "from",
      "[email] EMAIL_FROM_ADDRESS ausente ou inválida: envios pela Brevo desativados"
    )
  }

  if (replyToRaw && !replyTo) {
    warnOnce("reply-to", "[email] EMAIL_REPLY_TO inválida: ignorada")
  }

  return {
    apiKey,
    sender: fromEmail ? { email: fromEmail, name: fromName } : null,
    replyTo: replyTo ? { email: replyTo } : null,
  }
}
