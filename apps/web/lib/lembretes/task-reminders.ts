import "server-only"

import { z } from "zod"

import { isUuid } from "@workspace/core/email/sanitize"

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
import { getVapidConfig } from "@/lib/push/config"
import { parsePushTargets, pushToTargets, type PushTargetWithId } from "@/lib/push/deliveries"
import { taskReminderPush } from "@/lib/push/messages"

/**
 * Lembrete de tarefa no celular, ~15 minutos antes do prazo. O job pg_cron
 * `lembretes-de-visita` enfileira em private.task_reminder_notifications (só
 * para quem tem aparelho ligado e o lembrete ligado em "Meu perfil") e chama a
 * rota dos lembretes por webhook. As tarefas do dia continuam no resumo das 7h.
 * Único ponto de chamada de claim_task_reminders e settle_task_reminders. Nada
 * aqui lança; logs só com contagens.
 */

const SCOPE = "lembretes/tarefa"

const MAX_CLAIM = 100

export type TaskReminder = {
  id: string
  organizationSlug: string
  taskId: string
  title: string
  dueAt: string
  pushTargets: PushTargetWithId[]
}

export type TaskReminderDrainSummary = {
  claimed: number
  sent: number
  failed: number
  released: number
}

const rowSchema = z.object({
  id: z.string(),
  organization_slug: z.string(),
  task_id: z.string(),
  task_title: z.string(),
  due_at: z.string(),
  push_targets: z.unknown(),
})

export async function claimTaskReminders(limit: number): Promise<TaskReminder[]> {
  const context = getQueueContext(SCOPE)

  if (!context) {
    return []
  }

  try {
    const { data, error } = await context.supabase.rpc("claim_task_reminders", {
      p_server_key: context.serverKey,
      p_limit: clampLimit(limit, MAX_CLAIM),
    })

    if (error) {
      logRpcError(SCOPE, "claim_task_reminders", error)
      return []
    }

    if (!Array.isArray(data)) {
      console.error(`[${SCOPE}] claim_task_reminders: resposta inesperada`)
      return []
    }

    const reminders: TaskReminder[] = []

    for (const row of data) {
      const parsed = rowSchema.safeParse(row)

      if (
        parsed.success &&
        isUuid(parsed.data.id) &&
        isUuid(parsed.data.task_id) &&
        !Number.isNaN(Date.parse(parsed.data.due_at))
      ) {
        reminders.push({
          id: parsed.data.id,
          organizationSlug: parsed.data.organization_slug,
          taskId: parsed.data.task_id,
          title: parsed.data.task_title,
          dueAt: parsed.data.due_at,
          pushTargets: parsePushTargets(parsed.data.push_targets),
        })
      }
    }

    return reminders
  } catch (cause) {
    logRpcException(SCOPE, "claim_task_reminders", cause)
    return []
  }
}

export async function settleTaskReminders(input: {
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
    const { data, error } = await context.supabase.rpc("settle_task_reminders", {
      p_server_key: context.serverKey,
      p_sent: ids.sent,
      p_failed: ids.failed,
      p_released: ids.released,
    })

    if (error) {
      logRpcError(SCOPE, "settle_task_reminders", error)
      return EMPTY_SETTLEMENT
    }

    return readSettlement(data)
  } catch (cause) {
    logRpcException(SCOPE, "settle_task_reminders", cause)
    return EMPTY_SETTLEMENT
  }
}

/**
 * Reserva e envia um lote de lembretes. Sem chaves VAPID não reserva nada (a
 * fila vence sozinha no prazo). Todo item reservado volta ao banco: entregue em
 * algum aparelho = enviado; nenhum aparelho aceitou = falhou (nova tentativa,
 * até 3).
 */
export async function drainTaskReminders(limit: number): Promise<TaskReminderDrainSummary> {
  const summary: TaskReminderDrainSummary = { claimed: 0, sent: 0, failed: 0, released: 0 }

  if (!getVapidConfig()) {
    return summary
  }

  const reminders = await claimTaskReminders(limit)
  summary.claimed = reminders.length

  if (reminders.length === 0) {
    return summary
  }

  const sent: string[] = []
  const failed: string[] = []

  try {
    for (const reminder of reminders) {
      const message = taskReminderPush(reminder)
      const result = message ? await pushToTargets(reminder.pushTargets, message) : { delivered: 0 }

      if (result.delivered > 0) {
        sent.push(reminder.id)
      } else {
        failed.push(reminder.id)
      }
    }
  } finally {
    const accounted = new Set([...sent, ...failed])
    const released = reminders.map((item) => item.id).filter((id) => !accounted.has(id))

    await settleTaskReminders({ sent, failed, released })

    summary.sent = sent.length
    summary.failed = failed.length
    summary.released = released.length
  }

  return summary
}
