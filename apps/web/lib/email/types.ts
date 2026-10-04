import "server-only"

import type { EmailFailureReason } from "@workspace/core/email/delivery"

export type { EmailFailureReason }

export type EmailAddress = {
  email: string
  name?: string | null
}

/** Anexo pequeno (ex.: convite .ics). A Brevo aceita a extensão .ics. */
export type EmailAttachment = {
  /** Nome com extensão, ex.: "visita-imv-000123.ics". */
  name: string
  /** Conteúdo em texto (UTF-8); o provedor converte para base64. */
  content: string
}

export type EmailMessage = {
  to: EmailAddress
  subject: string
  html: string
  text: string
  /** Sem ele, usa EMAIL_REPLY_TO (se houver). */
  replyTo?: EmailAddress | null
  /** Aparecem nos relatórios da Brevo (normalizadas: [a-z0-9_-]). */
  tags?: readonly string[]
  /** UUID; repetir o mesmo valor em até 30 min não duplica o envio. Sem ele, um novo por chamada. */
  idempotencyKey?: string
  attachments?: readonly EmailAttachment[]
  /**
   * Para a cota diária (lib/email/quota.ts): tipo do aviso (define a prioridade)
   * e a imobiliária, para o cartão "Avisos não enviados hoje". Sem ele, conta
   * como "other" (classe 4).
   */
  quota?: EmailQuotaTag
}

export type EmailQuotaTag = {
  kind: string
  organizationSlug?: string | null
}

export type EmailSendResult =
  /** messageId é null quando a Brevo não devolve um (ex.: envio repetido já aceito). */
  { ok: true; messageId: string | null } | { ok: false; reason: EmailFailureReason }

export interface EmailProvider {
  readonly kind: "brevo" | "simulated"
  /** Nunca lança: falhas voltam como { ok: false, reason }. */
  send(message: EmailMessage): Promise<EmailSendResult>
}
