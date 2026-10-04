import { sendNotificationEmail } from "@/lib/email"
import { checkCronAuthorization, cronReply } from "@/lib/lembretes/cron-auth"
import { drainReminderQueue, logDrainSummary } from "@/lib/lembretes/drain"
import { drainTaskReminders } from "@/lib/lembretes/task-reminders"
import { drainVisitAssignmentNotices } from "@/lib/lembretes/visit-assignments"
import {
  claimVisitReminders,
  settleVisitReminders,
  type VisitReminder,
} from "@/lib/lembretes/visit-reminders"

/**
 * Lembrete de visita por e-mail, 2 horas antes, para o corretor da visita, com
 * o convite .ics (RFC 5545) em anexo. A mesma chamada drena o aviso "marcaram
 * uma visita para você" (e-mail + push) e o lembrete de tarefa no celular
 * (15 min antes), que usam o mesmo job e o mesmo webhook.
 *
 * O cron da Vercel no plano Hobby só roda 1x/dia, então quem agenda é o banco:
 * o job pg_cron `lembretes-de-visita` (a cada 5 min) enfileira em
 * private.visit_reminder_notifications e, havendo lembrete, faz POST aqui por
 * pg_net. Isso depende de dois segredos no Vault do Supabase:
 *   - visit_reminders_webhook_url: https://<host>/api/cron/daily-digest/visit-reminders
 *   - visit_reminders_webhook_secret: o mesmo valor de CRON_SECRET
 * Sem eles a fila enche e nada sai (GET manual com o segredo também drena).
 *
 * Autorização: `Authorization: Bearer ${CRON_SECRET}`. Resposta e logs só com
 * contagens.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Por chamada: o webhook volta em 5 min se sobrar lembrete. */
const MAX_EMAILS_PER_RUN = 40

const BATCH_SIZE = 20

const MAX_BATCHES = 2

/** Avisos de visita marcada por chamada (a action da agenda já drena na hora). */
const MAX_ASSIGNMENT_EMAILS_PER_RUN = 20

/** Lembretes de tarefa por chamada (só push: não gasta a cota de e-mail). */
const MAX_TASK_REMINDERS_PER_RUN = 50

function send(item: VisitReminder) {
  return sendNotificationEmail("visit_reminder", {
    organizationSlug: item.organizationSlug,
    reminderId: item.id,
    to: { email: item.recipientEmail, name: item.recipientName },
    brand: { name: item.organizationName || null, primaryColor: item.brandColor },
    visit: item.visit,
  })
}

async function handle(request: Request) {
  const denied = checkCronAuthorization(request)

  if (denied) {
    return denied
  }

  const summary = await drainReminderQueue({
    claim: claimVisitReminders,
    settle: settleVisitReminders,
    send,
    maxEmails: MAX_EMAILS_PER_RUN,
    batchSize: BATCH_SIZE,
    maxBatches: MAX_BATCHES,
  })

  logDrainSummary("lembretes/visita", summary)

  const assignments = await drainVisitAssignmentNotices(MAX_ASSIGNMENT_EMAILS_PER_RUN)

  if (assignments.claimed > 0) {
    logDrainSummary("lembretes/visita-marcada", assignments)
  }

  const tasks = await drainTaskReminders(MAX_TASK_REMINDERS_PER_RUN)

  if (tasks.claimed > 0) {
    console.info(
      `[lembretes/tarefa] ${tasks.sent}/${tasks.claimed} lembrete(s) entregue(s), ${tasks.failed} sem entrega, ${tasks.released} para a próxima execução`
    )
  }

  return cronReply(200, {
    ok: true,
    ...summary,
    assignments: { claimed: assignments.claimed, sent: assignments.sent },
    tasks: { claimed: tasks.claimed, sent: tasks.sent },
  })
}

export async function GET(request: Request) {
  return handle(request)
}

/** O banco chama por webhook (pg_net) quando há lembrete na fila. */
export async function POST(request: Request) {
  return handle(request)
}
