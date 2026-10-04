import "server-only"

import { parsePlatformAdminEmails } from "@workspace/core/caixa/platform-admins"
import { decideCaixaUploadReminder } from "@workspace/core/caixa/upload-reminder"
import { caixaUploadReminderEmail } from "@workspace/core/email/caixa-templates"
import { toSaoPauloDateKey } from "@workspace/core/email/reminders"

import { readCaixaCatalogState } from "@/lib/caixa/ingest"
import { getEmailProvider } from "@/lib/email"
import { deriveIdempotencyKey } from "@/lib/email/idempotency"
import { getAppOrigin } from "@/lib/tenant/urls"

/**
 * Lembrete diário à equipe da plataforma para enviar a lista da Caixa.
 *
 * Sai para cada e-mail de PLATFORM_ADMIN_EMAILS quando a última carga
 * (`sincronizado_em`) tem mais de 24 horas. Sem nenhuma carga anterior, não
 * envia. Não faz nenhuma requisição ao site da Caixa: só lê o estado no banco
 * (chave do servidor) e manda o e-mail pela infraestrutura existente (Brevo, ou
 * simulado sem BREVO_API_KEY).
 */

export type CaixaReminderSummary = {
  status:
    | "enviado"
    | "em_dia"
    | "sem_carga_anterior"
    | "sem_destinatarios"
    | "estado_indisponivel"
    | "falhou"
  recipients: number
  sent: number
  failed: number
  ageHours?: number
}

/** Poucos destinatários (a própria equipe); teto defensivo contra lista errada. */
const MAX_RECIPIENTS = 20

export async function runCaixaUploadReminder(now = new Date()): Promise<CaixaReminderSummary> {
  const recipients = [...parsePlatformAdminEmails(process.env.PLATFORM_ADMIN_EMAILS)].slice(
    0,
    MAX_RECIPIENTS
  )

  if (recipients.length === 0) {
    return { status: "sem_destinatarios", recipients: 0, sent: 0, failed: 0 }
  }

  const loaded = await readCaixaCatalogState()

  if (!loaded.ok) {
    return { status: "estado_indisponivel", recipients: recipients.length, sent: 0, failed: 0 }
  }

  const { state } = loaded
  const decision = decideCaixaUploadReminder(state.syncedAt, now)

  if (!decision.send || !state.syncedAt) {
    return {
      status: decision.send ? "sem_carga_anterior" : decision.reason,
      recipients: recipients.length,
      sent: 0,
      failed: 0,
    }
  }

  let email

  try {
    email = caixaUploadReminderEmail({
      origin: getAppOrigin(),
      syncedAt: state.syncedAt,
      generatedOn: state.generatedOn,
      totalActive: state.totalActive,
      ageHours: decision.ageHours,
    })
  } catch (cause) {
    console.error(
      `[caixa/lembrete] e-mail não montado (${cause instanceof Error ? cause.name : "erro"})`
    )
    return { status: "falhou", recipients: recipients.length, sent: 0, failed: recipients.length }
  }

  const provider = getEmailProvider()
  const day = toSaoPauloDateKey(now) ?? now.toISOString().slice(0, 10)
  let sent = 0
  let failed = 0

  for (const address of recipients) {
    const result = await provider.send({
      to: { email: address },
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: ["caixa_lembrete_envio"],
      quota: { kind: "caixa_reminder" },
      // Uma vez por pessoa por dia, mesmo que a rotina rode de novo.
      idempotencyKey: deriveIdempotencyKey("caixa_upload_reminder", day, address),
    })

    if (result.ok) {
      sent += 1
    } else {
      failed += 1
    }
  }

  return {
    status: sent > 0 ? "enviado" : "falhou",
    recipients: recipients.length,
    sent,
    failed,
    ageHours: decision.ageHours,
  }
}
