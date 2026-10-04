import "server-only"

import { createBrevoProvider } from "@/lib/email/brevo"
import { readEmailConfig } from "@/lib/email/config"
import { withEmailQuota } from "@/lib/email/quota"
import { createSimulatedProvider } from "@/lib/email/simulated"
import type { EmailProvider } from "@/lib/email/types"

let warnedSimulatedInProduction = false

/**
 * Brevo quando BREVO_API_KEY existe; senão o provedor simulado (não envia nada).
 * O envio real passa pela cota diária com prioridade (lib/email/quota.ts).
 */
export function getEmailProvider(): EmailProvider {
  const config = readEmailConfig()

  if (!config.apiKey) {
    if (process.env.NODE_ENV === "production" && !warnedSimulatedInProduction) {
      warnedSimulatedInProduction = true
      console.warn("[email] BREVO_API_KEY ausente: e-mails em modo simulado (nada é enviado)")
    }

    return createSimulatedProvider()
  }

  return withEmailQuota(
    createBrevoProvider({
      apiKey: config.apiKey,
      sender: config.sender,
      replyTo: config.replyTo,
    })
  )
}
