import "server-only"

import { randomUUID } from "node:crypto"

import { cleanText, maskEmailAddress } from "@workspace/core/email/sanitize"

import { normalizeRecipient } from "@/lib/email/address"
import type { EmailProvider } from "@/lib/email/types"

/**
 * Usado quando não há BREVO_API_KEY (desenvolvimento): nada é enviado. Registra
 * só o assunto e o destinatário mascarado (nunca o corpo ou o e-mail completo).
 */
export function createSimulatedProvider(): EmailProvider {
  return {
    kind: "simulated",
    async send(message) {
      const to = normalizeRecipient(message.to)

      if (!to) {
        return { ok: false, reason: "invalid_recipient" }
      }

      console.info(
        `[email simulado] "${cleanText(message.subject, { maxLength: 150 })}" para ${maskEmailAddress(to.email)}`
      )

      return { ok: true, messageId: `simulado-${randomUUID()}` }
    },
  }
}
