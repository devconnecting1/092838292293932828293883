import "server-only"

import { z } from "zod"

import { cleanText } from "@workspace/core/email/sanitize"

import { sendNotificationEmail, type NotificationSummary } from "@/lib/email"
import { drainReminderQueue, type DrainSummary } from "@/lib/lembretes/drain"
import {
  clampLimit,
  EMPTY_SETTLEMENT,
  getQueueContext,
  logRpcError,
  logRpcException,
  readSettlement,
  splitSettlement,
  type QueueSettlement,
} from "@/lib/lembretes/queue-client"
import {
  toVisitReminder,
  visitReminderRowSchema,
  type VisitReminder,
} from "@/lib/lembretes/visit-reminders"
import { parsePushTargets, pushToTargets, type PushTargetWithId } from "@/lib/push/deliveries"
import { visitAssignedPush } from "@/lib/push/messages"

/**
 * Aviso "marcaram uma visita para você": quando outra pessoa (ex.: a assistente)
 * marca, remarca ou passa uma visita para o corretor. O gatilho do banco
 * enfileira em private.visit_assignment_notifications; a action da agenda
 * drena logo depois de salvar (after) e o job pg_cron `lembretes-de-visita`
 * chama a rota por webhook como rede de segurança. Único ponto de chamada de
 * claim_visit_assignment_notices e settle_visit_assignment_notices. Nada aqui
 * lança; logs só com contagens.
 */

const SCOPE = "lembretes/visita-marcada"

const MAX_CLAIM = 100

export type VisitAssignmentNotice = VisitReminder & {
  assignedByName: string | null
  /** Aparelhos do corretor; vazio quando o push deste aviso já saiu. */
  pushTargets: PushTargetWithId[]
}

const rowSchema = visitReminderRowSchema.extend({
  assigned_by_name: z.string().nullable(),
  push_targets: z.unknown(),
})

export async function claimVisitAssignmentNotices(limit: number): Promise<VisitAssignmentNotice[]> {
  const context = getQueueContext(SCOPE)

  if (!context) {
    return []
  }

  try {
    const { data, error } = await context.supabase.rpc("claim_visit_assignment_notices", {
      p_server_key: context.serverKey,
      p_limit: clampLimit(limit, MAX_CLAIM),
    })

    if (error) {
      logRpcError(SCOPE, "claim_visit_assignment_notices", error)
      return []
    }

    if (!Array.isArray(data)) {
      console.error(`[${SCOPE}] claim_visit_assignment_notices: resposta inesperada`)
      return []
    }

    const notices: VisitAssignmentNotice[] = []
    let discarded = 0

    for (const row of data) {
      const parsed = rowSchema.safeParse(row)
      const reminder = parsed.success ? toVisitReminder(parsed.data) : null

      if (parsed.success && reminder) {
        notices.push({
          ...reminder,
          assignedByName: cleanText(parsed.data.assigned_by_name, { maxLength: 80 }) || null,
          pushTargets: parsePushTargets(parsed.data.push_targets),
        })
      } else {
        discarded += 1
      }
    }

    if (discarded > 0) {
      console.error(`[${SCOPE}] claim: ${discarded} aviso(s) com dados inválidos descartado(s)`)
    }

    return notices
  } catch (cause) {
    logRpcException(SCOPE, "claim_visit_assignment_notices", cause)
    return []
  }
}

export async function settleVisitAssignmentNotices(input: {
  sent: readonly string[]
  failed: readonly string[]
  released: readonly string[]
}): Promise<QueueSettlement> {
  const ids = splitSettlement(input)

  if (ids.empty) {
    return EMPTY_SETTLEMENT
  }

  const context = getQueueContext(SCOPE)

  if (!context) {
    return EMPTY_SETTLEMENT
  }

  try {
    const { data, error } = await context.supabase.rpc("settle_visit_assignment_notices", {
      p_server_key: context.serverKey,
      p_sent: ids.sent,
      p_failed: ids.failed,
      p_released: ids.released,
    })

    if (error) {
      logRpcError(SCOPE, "settle_visit_assignment_notices", error)
      return EMPTY_SETTLEMENT
    }

    return readSettlement(data)
  } catch (cause) {
    logRpcException(SCOPE, "settle_visit_assignment_notices", cause)
    return EMPTY_SETTLEMENT
  }
}

/** Push (uma vez por aviso) e e-mail com o convite .ics. O e-mail decide o "enviado". */
async function sendVisitAssignmentNotice(
  notice: VisitAssignmentNotice
): Promise<NotificationSummary> {
  const push = visitAssignedPush({
    visitId: notice.visit.id,
    startsAt: notice.visit.startsAt,
    propertyCode: notice.visit.propertyCode,
    assignedByName: notice.assignedByName,
  })
  const [, email] = await Promise.all([
    push ? pushToTargets(notice.pushTargets, push) : Promise.resolve(null),
    sendNotificationEmail("visit_assigned", {
      organizationSlug: notice.organizationSlug,
      reminderId: notice.id,
      to: { email: notice.recipientEmail, name: notice.recipientName },
      brand: { name: notice.organizationName || null, primaryColor: notice.brandColor },
      assignedByName: notice.assignedByName,
      visit: notice.visit,
    }),
  ])

  return email
}

/**
 * Drena a fila com os mesmos limites dos lembretes (a Brevo Free divide 300
 * e-mails por dia entre todos os avisos da plataforma).
 */
export function drainVisitAssignmentNotices(maxEmails: number): Promise<DrainSummary> {
  return drainReminderQueue({
    claim: claimVisitAssignmentNotices,
    settle: settleVisitAssignmentNotices,
    send: sendVisitAssignmentNotice,
    maxEmails,
    batchSize: Math.min(10, Math.max(1, maxEmails)),
    maxBatches: 2,
  })
}
