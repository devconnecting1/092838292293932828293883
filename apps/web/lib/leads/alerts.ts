import "server-only"

import { createClient } from "@supabase/supabase-js"
import { z } from "zod"

import { cleanText, isUuid, normalizeEmailAddress } from "@workspace/core/email/sanitize"
import { LEAD_SLA_NOTICE_KINDS } from "@workspace/core/email/templates"

import { getNotificationRecipients } from "@/lib/email/recipients"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Fila de avisos de lead do rodízio e do SLA de primeiro contato
 * (private.lead_notifications). Único ponto de chamada de
 * claim_lead_notifications, settle_lead_notifications e
 * claim_lead_notification_pushes (push no celular, ver lib/push/lead-alerts.ts):
 * RPCs sem sessão, com a chave publishable + NOTIFICATION_SERVER_KEY (segredo
 * notification_server_key do Vault). Nunca service_role.
 *
 * Nada aqui lança: em falha devolve lista vazia ou zeros e registra só o código
 * do erro. Os logs nunca levam e-mail, telefone ou nome — só códigos e contagens.
 */

/**
 * Tipos que o app sabe enviar: o aviso de lead novo e os modelos de SLA do
 * pacote de e-mail (inclusive `sla_breached`, o aviso à gestão de prazo
 * estourado sem redistribuição). Se a fila do banco (check de
 * private.lead_notifications) ganhar um tipo sem modelo em
 * LEAD_SLA_NOTICE_KINDS, o claim o descarta e registra só a contagem.
 */
export const LEAD_ALERT_KINDS = ["assigned", ...LEAD_SLA_NOTICE_KINDS] as const

export type LeadAlertKind = (typeof LEAD_ALERT_KINDS)[number]

export type LeadAlert = {
  /** Id do aviso na fila: entra na chave de idempotência e volta no settle. */
  id: string
  kind: LeadAlertKind
  organizationId: string
  organizationSlug: string
  leadId: string
  leadName: string
  leadSource: string | null
  leadInterest: string | null
  /** Cru: quem mascara é o template do e-mail. */
  leadPhone: string | null
  leadCreatedAt: string | null
  dueAt: string | null
  /** Prazo de primeiro contato da imobiliária; 0 quando o banco não informou. */
  slaMinutes: number
  recipientEmail: string
  recipientName: string | null
  /**
   * `sla_breached`: nome de quem continua com o lead, para o e-mail da gestão.
   * `null` nos outros tipos ou quando não deu para saber com segurança.
   */
  assigneeName: string | null
}

const SUPPORTED_KINDS: ReadonlySet<string> = new Set(LEAD_ALERT_KINDS)

/** Linha com `kind` preenchido que o app ainda não sabe enviar. */
function isUnsupportedKind(row: unknown) {
  if (typeof row !== "object" || row === null || !("kind" in row)) {
    return false
  }

  const kind = (row as { kind: unknown }).kind

  return typeof kind === "string" && kind !== "" && !SUPPORTED_KINDS.has(kind)
}

/** O banco recorta em 200 por chamada; o mesmo teto aqui evita pedir mais do que vem. */
const MAX_CLAIM = 200

const rowSchema = z.object({
  id: z.string(),
  kind: z.enum(LEAD_ALERT_KINDS),
  organization_id: z.string(),
  organization_slug: z.string(),
  lead_id: z.string(),
  lead_name: z.string(),
  lead_source: z.string().nullable(),
  lead_interest: z.string().nullable(),
  lead_phone: z.string().nullable(),
  lead_created_at: z.string().nullable(),
  due_at: z.string().nullable(),
  sla_minutes: z.number().nullable(),
  recipient_email: z.string(),
  recipient_name: z.string().nullable(),
})

const settledSchema = z.object({
  sent: z.number(),
  released: z.number(),
})

export type LeadAlertSettlement = { sent: number; released: number }

/** Cliente sem sessão: a autorização é a NOTIFICATION_SERVER_KEY dentro da RPC. */
function createNotificationClient(url: string, publishableKey: string) {
  // Sem o tipo Database de propósito: as RPCs entram em @workspace/database/types
  // na próxima regeneração; o retorno é validado com zod.
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function toAlert(row: z.infer<typeof rowSchema>): LeadAlert | null {
  if (!isUuid(row.id) || !isUuid(row.organization_id) || !isUuid(row.lead_id)) {
    return null
  }

  const recipientEmail = normalizeEmailAddress(row.recipient_email)
  const organizationSlug = cleanText(row.organization_slug, { maxLength: 63 })

  if (!recipientEmail || !organizationSlug) {
    return null
  }

  const slaMinutes =
    row.sla_minutes !== null && Number.isFinite(row.sla_minutes) ? Math.floor(row.sla_minutes) : 0

  return {
    id: row.id,
    kind: row.kind,
    organizationId: row.organization_id,
    organizationSlug,
    leadId: row.lead_id,
    leadName: cleanText(row.lead_name, { maxLength: 120 }) || "Novo contato",
    leadSource: cleanText(row.lead_source, { maxLength: 60 }) || null,
    leadInterest: cleanText(row.lead_interest, { maxLength: 60 }) || null,
    leadPhone: cleanText(row.lead_phone, { maxLength: 40 }) || null,
    leadCreatedAt: row.lead_created_at,
    dueAt: row.due_at,
    slaMinutes,
    recipientEmail,
    recipientName: cleanText(row.recipient_name, { maxLength: 120 }) || null,
    assigneeName: null,
  }
}

/**
 * Nome do responsável atual do lead para os avisos `sla_breached`.
 *
 * A fila não traz esse nome; quem traz é get_notification_recipients (tipo
 * new_lead), que devolve o responsável ativo do lead ou, sem ele, dono e
 * gerentes. Como o `sla_breached` nunca vai para o próprio responsável, só vale
 * como nome uma resposta com UMA pessoa diferente do destinatário; qualquer outra
 * fica sem nome, e o modelo do e-mail diz "o corretor responsável".
 *
 * Uma consulta por lead (vários gestores recebem o mesmo aviso). O e-mail que a
 * RPC devolve só serve para essa comparação e não sai daqui.
 */
async function withAssigneeNames(alerts: LeadAlert[]): Promise<LeadAlert[]> {
  const breached = alerts.filter((alert) => alert.kind === "sla_breached")

  if (breached.length === 0) {
    return alerts
  }

  const assigneeByLead = new Map<string, Promise<{ email: string; name: string } | null>>()

  for (const alert of breached) {
    if (assigneeByLead.has(alert.leadId)) continue

    assigneeByLead.set(
      alert.leadId,
      getNotificationRecipients({
        kind: "new_lead",
        subjectId: alert.leadId,
        organizationId: alert.organizationId,
      })
        .then((recipients) => {
          const [only] = recipients
          const name = cleanText(only?.fullName, { maxLength: 60 })
          return recipients.length === 1 && only && name ? { email: only.email, name } : null
        })
        .catch(() => null)
    )
  }

  return Promise.all(
    alerts.map(async (alert) => {
      const assignee = alert.kind === "sla_breached" ? await assigneeByLead.get(alert.leadId) : null

      return assignee && assignee.email !== alert.recipientEmail
        ? { ...alert, assigneeName: assignee.name }
        : alert
    })
  )
}

/**
 * Reserva os avisos pendentes (marca claimed_at e incrementa attempts). Todo id
 * devolvido precisa voltar em settleLeadAlerts, senão fica preso por 15 min.
 */
export async function claimLeadAlerts(limit: number): Promise<LeadAlert[]> {
  const serverKey = process.env.NOTIFICATION_SERVER_KEY?.trim()

  if (!serverKey) {
    console.error("NOTIFICATION_SERVER_KEY ausente")
    return []
  }

  const size = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), MAX_CLAIM) : 1
  const env = getSupabaseEnv()

  if (!env) {
    console.error("[leads/alerts] claim: Supabase não configurado")
    return []
  }

  try {
    const supabase = createNotificationClient(env.url, env.publishableKey)
    const { data, error } = await supabase.rpc("claim_lead_notifications", {
      p_server_key: serverKey,
      p_limit: size,
    })

    if (error) {
      console.error(
        `[leads/alerts] claim_lead_notifications falhou (código ${error.code || "desconhecido"})`
      )
      return []
    }

    if (!Array.isArray(data)) {
      console.error("[leads/alerts] claim_lead_notifications: resposta inesperada")
      return []
    }

    const alerts: LeadAlert[] = []
    let discarded = 0
    let unsupported = 0

    for (const row of data) {
      const parsed = rowSchema.safeParse(row)
      const alert = parsed.success ? toAlert(parsed.data) : null

      if (!alert) {
        if (isUnsupportedKind(row)) {
          unsupported += 1
        } else {
          discarded += 1
        }
        continue
      }

      alerts.push(alert)
    }

    if (discarded > 0) {
      console.error(`[leads/alerts] claim: ${discarded} aviso(s) com dados inválidos descartado(s)`)
    }

    if (unsupported > 0) {
      console.error(
        `[leads/alerts] claim: ${unsupported} aviso(s) de tipo ainda sem modelo de e-mail descartado(s)`
      )
    }

    return await withAssigneeNames(alerts)
  } catch (cause) {
    console.error(
      `[leads/alerts] claim_lead_notifications falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return []
  }
}

const pushTargetSchema = z.object({
  notification_id: z.string(),
  subscription_id: z.string(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth_secret: z.string(),
})

/** Aparelho que recebe o push de um aviso da fila. Endpoint e chaves nunca vão para log. */
export type LeadAlertPushTarget = {
  alertId: string
  subscriptionId: string
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Reserva o push dos avisos (UMA vez por aviso: o banco grava push_sent_at) e
 * devolve os aparelhos de cada destinatário com membership ativa. Aviso que já
 * teve o push reservado não volta, então o e-mail devolvido à fila e tentado de
 * novo não repete o push. Chame logo depois do claim, sem esperar o e-mail.
 */
export async function reserveLeadAlertPushes(
  alertIds: readonly string[]
): Promise<LeadAlertPushTarget[]> {
  const ids = [...new Set(alertIds.filter((id) => isUuid(id)))].slice(0, MAX_CLAIM)

  if (ids.length === 0) {
    return []
  }

  const serverKey = process.env.NOTIFICATION_SERVER_KEY?.trim()
  const env = getSupabaseEnv()

  if (!serverKey || !env) {
    return []
  }

  try {
    const supabase = createNotificationClient(env.url, env.publishableKey)
    const { data, error } = await supabase.rpc("claim_lead_notification_pushes", {
      p_server_key: serverKey,
      p_notification_ids: ids,
    })

    if (error) {
      console.error(
        `[leads/alerts] claim_lead_notification_pushes falhou (código ${error.code || "desconhecido"})`
      )
      return []
    }

    if (!Array.isArray(data)) {
      console.error("[leads/alerts] claim_lead_notification_pushes: resposta inesperada")
      return []
    }

    const targets: LeadAlertPushTarget[] = []

    for (const row of data) {
      const parsed = pushTargetSchema.safeParse(row)

      if (parsed.success && isUuid(parsed.data.subscription_id)) {
        targets.push({
          alertId: parsed.data.notification_id,
          subscriptionId: parsed.data.subscription_id,
          endpoint: parsed.data.endpoint,
          p256dh: parsed.data.p256dh,
          auth: parsed.data.auth_secret,
        })
      }
    }

    return targets
  } catch (cause) {
    console.error(
      `[leads/alerts] claim_lead_notification_pushes falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return []
  }
}

/**
 * Confirma os enviados e devolve os que falharam para a fila (até 5 tentativas).
 * Chame sempre depois de tentar enviar, mesmo quando nada foi enviado.
 */
export async function settleLeadAlerts(
  sentIds: readonly string[],
  failedIds: readonly string[]
): Promise<LeadAlertSettlement> {
  const empty: LeadAlertSettlement = { sent: 0, released: 0 }
  const sent = [...new Set(sentIds.filter((id) => isUuid(id)))]
  const failed = [...new Set(failedIds.filter((id) => isUuid(id) && !sent.includes(id)))]

  if (sent.length === 0 && failed.length === 0) {
    return empty
  }

  const serverKey = process.env.NOTIFICATION_SERVER_KEY?.trim()

  if (!serverKey) {
    console.error("NOTIFICATION_SERVER_KEY ausente")
    return empty
  }

  const env = getSupabaseEnv()

  if (!env) {
    console.error("[leads/alerts] settle: Supabase não configurado")
    return empty
  }

  try {
    const supabase = createNotificationClient(env.url, env.publishableKey)
    const { data, error } = await supabase.rpc("settle_lead_notifications", {
      p_server_key: serverKey,
      p_sent: sent,
      p_failed: failed,
    })

    if (error) {
      console.error(
        `[leads/alerts] settle_lead_notifications falhou (código ${error.code || "desconhecido"})`
      )
      return empty
    }

    const parsed = settledSchema.safeParse(data)

    if (!parsed.success) {
      console.error("[leads/alerts] settle_lead_notifications: resposta inesperada")
      return empty
    }

    return { sent: parsed.data.sent, released: parsed.data.released }
  } catch (cause) {
    console.error(
      `[leads/alerts] settle_lead_notifications falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return empty
  }
}
