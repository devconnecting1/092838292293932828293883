import "server-only"

import { z } from "zod"

import { statusAutoIncidentAlertEmail } from "@workspace/core/email/status-alert-templates"
import { selectStatusAlertRecipients } from "@workspace/core/status/automation"

import { getEmailProvider } from "@/lib/email"
import { deriveIdempotencyKey } from "@/lib/email/idempotency"
import { getPlatformOwnerEmails } from "@/lib/plataforma/admin"
import { createPlatformServerKeyClient } from "@/lib/plataforma/server-key-client"
import { getAppOrigin } from "@/lib/tenant/urls"

/**
 * Aviso por e-mail aos Donos (PLATFORM_ADMIN_EMAILS) sobre incidente
 * automático da página de status: abriu com impacto grande/crítico ou resolveu
 * sozinho. A fila e a trava (10 e-mails em 24 h no total) ficam no banco
 * (`platform_status_claim_alerts`/`platform_status_settle_alert`, chave
 * PLATFORM_SERVER_KEY, sem sessão). Nunca service_role. Logs só com contagens.
 */

/** Avisos reservados por chamada (a trava do banco limita os e-mails de verdade). */
const CLAIM_LIMIT = 5

const claimSchema = z.object({
  alerts: z.array(
    z.object({
      id: z.number().int(),
      kind: z.enum(["opened", "resolved"]),
      impact: z.enum(["none", "minor", "major", "critical"]),
      incident_id: z.string(),
      title: z.string(),
      component_keys: z.array(z.string()),
      started_at: z.string(),
      resolved_at: z.string().nullable(),
    })
  ),
  emails_used_24h: z.number().int().nonnegative(),
  emails_limit: z.number().int().positive(),
})

type ClaimedAlert = z.infer<typeof claimSchema>["alerts"][number]

export type StatusAlertsRunSummary = {
  status: "concluido" | "sem_destinatarios" | "nao_configurado" | "falhou"
  recipients: number
  claimed: number
  sent: number
  failed: number
  released: number
  emailsSent: number
  emailsUsed24h: number | null
  /** Parou no meio: e-mail sem configuração ou cota da Brevo estourada. */
  halted: boolean
}

type Outcome = { outcome: "sent" | "failed" | "released"; emails: number; halt: boolean }

async function deliver(
  alert: ClaimedAlert,
  recipients: readonly string[],
  origin: string
): Promise<Outcome> {
  let email

  try {
    email = statusAutoIncidentAlertEmail({
      origin,
      kind: alert.kind,
      title: alert.title,
      impact: alert.impact,
      componentKeys: alert.component_keys,
      startedAt: alert.started_at,
      resolvedAt: alert.resolved_at,
    })
  } catch (cause) {
    console.error(
      `[status/avisos] e-mail não montado (${cause instanceof Error ? cause.name : "erro"})`
    )
    return { outcome: "failed", emails: 0, halt: false }
  }

  const provider = getEmailProvider()
  let emails = 0

  for (const address of recipients) {
    const result = await provider.send({
      to: { email: address },
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: ["status_incidente_automatico"],
      // Mesmo aviso reenviado em até 30 min não duplica na Brevo.
      idempotencyKey: deriveIdempotencyKey("status_alert", String(alert.id), address),
      quota: { kind: "status_alert" },
    })

    if (result.ok) {
      emails += 1
      continue
    }

    if (
      result.reason === "not_configured" ||
      result.reason === "rate_limited" ||
      result.reason === "daily_quota"
    ) {
      return { outcome: emails > 0 ? "sent" : "released", emails, halt: true }
    }
  }

  return { outcome: emails > 0 ? "sent" : "failed", emails, halt: false }
}

/** Drena a fila do aviso (chamada pelo webhook do banco). Nunca lança. */
export async function runStatusAlerts(): Promise<StatusAlertsRunSummary> {
  const recipients = selectStatusAlertRecipients(getPlatformOwnerEmails())
  const summary: StatusAlertsRunSummary = {
    status: "concluido",
    recipients: recipients.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    released: 0,
    emailsSent: 0,
    emailsUsed24h: null,
    halted: false,
  }

  if (recipients.length === 0) {
    // Sem Donos na variável, nada é reservado: o aviso expira em 6 h no banco.
    return { ...summary, status: "sem_destinatarios" }
  }

  const client = createPlatformServerKeyClient()

  if (!client) {
    return { ...summary, status: "nao_configurado" }
  }

  const { supabase, serverKey } = client
  const { data, error } = await supabase.rpc("platform_status_claim_alerts", {
    p_server_key: serverKey,
    p_recipient_count: recipients.length,
    p_limit: CLAIM_LIMIT,
  })

  if (error) {
    console.error(`[status/avisos] reserva falhou (código ${error.code || "desconhecido"})`)
    return { ...summary, status: "falhou" }
  }

  const parsed = claimSchema.safeParse(data)

  if (!parsed.success) {
    console.error("[status/avisos] reserva em formato inesperado")
    return { ...summary, status: "falhou" }
  }

  summary.claimed = parsed.data.alerts.length
  summary.emailsUsed24h = parsed.data.emails_used_24h

  let origin: string | null

  try {
    origin = getAppOrigin()
  } catch {
    origin = null
  }

  for (const alert of parsed.data.alerts) {
    // Todo aviso reservado volta ao banco: sem origem ou depois de parar, sai
    // como "não tentado" (não gasta tentativa).
    const result: Outcome =
      summary.halted || !origin
        ? { outcome: "released", emails: 0, halt: summary.halted }
        : await deliver(alert, recipients, origin)

    summary.halted = summary.halted || result.halt

    const { error: settleError } = await supabase.rpc("platform_status_settle_alert", {
      p_server_key: serverKey,
      p_alert_id: alert.id,
      p_outcome: result.outcome,
      p_emails_sent: result.emails,
    })

    if (settleError) {
      console.error(
        `[status/avisos] confirmação falhou (código ${settleError.code || "desconhecido"})`
      )
    }

    summary.emailsSent += result.emails

    if (result.outcome === "sent") summary.sent += 1
    else if (result.outcome === "failed") summary.failed += 1
    else summary.released += 1
  }

  if (!origin && summary.claimed > 0) {
    console.error("[status/avisos] origem do app não configurada: avisos devolvidos à fila")
  }

  return summary
}
