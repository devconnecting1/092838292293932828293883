import { sendNotificationEmail } from "@/lib/email"
import { checkCronAuthorization, cronReply } from "@/lib/lembretes/cron-auth"
import {
  claimDailyDigests,
  settleDailyDigests,
  type DailyDigest,
} from "@/lib/lembretes/daily-digest"
import { drainReminderQueue, logDrainSummary } from "@/lib/lembretes/drain"

/**
 * Resumo diário por e-mail (Vercel Cron `0 10 * * *` = 07h de Brasília; no
 * plano Hobby o disparo acontece em algum momento dentro da hora, até 07h59).
 * Para cada pessoa ativa com o resumo ligado em "Meu perfil": tarefas de hoje e
 * atrasadas, visitas do dia (endereço no modo de exibição do imóvel), leads sem
 * contato há mais de 3 dias e clientes da carteira que fazem aniversário hoje.
 * Só sai quando há conteúdo, e o controle do banco
 * (private.daily_digest_deliveries) impede o segundo envio no mesmo dia.
 *
 * Autorização: `Authorization: Bearer ${CRON_SECRET}`. Resposta e logs só com
 * contagens.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * E-mails por execução. A conta Brevo Free envia 300/dia e divide a cota com os
 * avisos de assinatura, de lead, de autorização e os lembretes de visita; quem
 * passar daqui fica sem resumo hoje e vai para o começo da fila amanhã.
 */
const MAX_EMAILS_PER_RUN = 80

const BATCH_SIZE = 20

const MAX_BATCHES = 5

function send(item: DailyDigest) {
  return sendNotificationEmail("daily_digest", {
    organizationSlug: item.organizationSlug,
    deliveryId: item.id,
    to: { email: item.recipientEmail, name: item.recipientName },
    brand: { name: item.organizationName || null, primaryColor: item.brandColor },
    digest: item.digest,
  })
}

export async function GET(request: Request) {
  const denied = checkCronAuthorization(request)

  if (denied) {
    return denied
  }

  const summary = await drainReminderQueue({
    claim: claimDailyDigests,
    settle: settleDailyDigests,
    send,
    maxEmails: MAX_EMAILS_PER_RUN,
    batchSize: BATCH_SIZE,
    maxBatches: MAX_BATCHES,
  })

  logDrainSummary("lembretes/resumo", summary)

  return cronReply(200, { ok: true, ...summary })
}
