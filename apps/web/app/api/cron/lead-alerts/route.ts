import { createHash, timingSafeEqual } from "node:crypto"

import { sendNotificationEmail, type NotificationSummary } from "@/lib/email"
import { claimLeadAlerts, settleLeadAlerts, type LeadAlert } from "@/lib/leads/alerts"
import { pushLeadAlerts, type LeadAlertPushSummary } from "@/lib/push/lead-alerts"
import { isValidTenantSlug } from "@/lib/tenant/urls"

/**
 * Drena a fila de avisos de lead do banco (private.lead_notifications) e envia
 * os e-mails: "você recebeu um novo lead" (assigned) e os avisos do SLA de
 * primeiro contato (prazo acabando, redistribuído, perdido).
 *
 * Com as chaves VAPID configuradas, cada lote também vira push no celular de
 * quem ligou os avisos em "Meu perfil": o push começa junto com os e-mails do
 * lote (sem esperar nem atrasar o e-mail) e sai uma vez por aviso, mesmo que o
 * e-mail volte para a fila. A resposta espera os pushes (função serverless).
 *
 * Chamada por GET (Vercel Cron, 1x/dia no plano Hobby — rede de segurança) e
 * por POST (o banco chama por webhook com pg_net assim que enfileira um aviso,
 * que é o caminho quase em tempo real). Autorização:
 * `Authorization: Bearer ${CRON_SECRET}` (comparação em tempo constante).
 * Resposta e logs só com contagens.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Destinatários por execução. A conta Brevo Free envia 300/dia e o cron de
 * assinatura já pode consumir 200; sobram 100, então 120 é o teto de segurança
 * para os avisos de lead (o webhook do banco costuma esvaziar a fila antes).
 */
const MAX_RECIPIENTS_PER_RUN = 120

/** Avisos reservados por chamada ao banco (o claim aceita até 200). */
const BATCH_SIZE = 40

/** Teto de chamadas ao banco por execução: evita laço longo em função serverless. */
const MAX_BATCHES = 5

type RunSummary = {
  batches: number
  claimed: number
  sent: number
  failed: number
  settled: number
  released: number
  invalidSlug: number
  /** Ainda havia avisos na fila quando o orçamento ou o teto de lotes acabou. */
  truncated: boolean
  /** Parou no meio: e-mail sem configuração ou cota diária estourada. */
  halted: boolean
  reasons: Record<string, number>
  /** Push no celular (zeros quando as chaves VAPID não estão configuradas). */
  push: LeadAlertPushSummary
}

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest()
}

/** Compara os hashes (mesmo tamanho) para não vazar o segredo pelo tempo de resposta. */
function isAuthorized(header: string | null, secret: string) {
  return timingSafeEqual(sha256(header ?? ""), sha256(`Bearer ${secret}`))
}

/** Minutos que faltam para estourar o prazo; null quando o banco não informou o limite. */
function minutesLeftUntil(dueAt: string | null): number | null {
  if (!dueAt) {
    return null
  }

  const due = Date.parse(dueAt)

  if (Number.isNaN(due)) {
    return null
  }

  return Math.max(0, Math.ceil((due - Date.now()) / 60_000))
}

async function sendAlert(alert: LeadAlert): Promise<NotificationSummary> {
  if (alert.kind === "assigned") {
    // O handler busca o destinatário sozinho (get_notification_recipients
    // devolve o responsável atual do lead), então não recebe endereço aqui.
    return sendNotificationEmail("new_lead", {
      organizationSlug: alert.organizationSlug,
      organizationId: alert.organizationId,
      leadId: alert.leadId,
      lead: {
        name: alert.leadName,
        source: alert.leadSource,
        interest: alert.leadInterest,
        phone: alert.leadPhone,
        receivedAt: alert.leadCreatedAt,
      },
    })
  }

  return sendNotificationEmail("lead_sla_notice", {
    organizationSlug: alert.organizationSlug,
    notice: alert.kind,
    alertId: alert.id,
    to: { email: alert.recipientEmail, name: alert.recipientName },
    lead: {
      id: alert.leadId,
      name: alert.leadName,
      source: alert.leadSource,
      interest: alert.leadInterest,
      phone: alert.leadPhone,
      receivedAt: alert.leadCreatedAt,
    },
    slaMinutes: alert.slaMinutes,
    minutesLeft: minutesLeftUntil(alert.dueAt),
    dueAt: alert.dueAt,
    assigneeName: alert.assigneeName,
  })
}

/**
 * @param pushRuns recebe o push de cada lote, iniciado antes dos e-mails; quem
 * chama espera todos antes de responder.
 */
async function drainQueue(pushRuns: Promise<LeadAlertPushSummary>[]): Promise<RunSummary> {
  const summary: RunSummary = {
    batches: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    settled: 0,
    released: 0,
    invalidSlug: 0,
    truncated: false,
    halted: false,
    reasons: {},
    push: { attempted: 0, delivered: 0, removed: 0, failed: 0 },
  }

  let budget = MAX_RECIPIENTS_PER_RUN
  // Falta de configuração ou cota diária estourada: os próximos falhariam igual.
  let halted = false

  for (let batch = 0; batch < MAX_BATCHES && budget > 0 && !halted; batch += 1) {
    const size = Math.min(BATCH_SIZE, budget)
    const alerts = await claimLeadAlerts(size)

    if (alerts.length === 0) {
      return summary
    }

    summary.batches += 1
    summary.claimed += alerts.length
    budget -= alerts.length

    // Push em paralelo aos e-mails deste lote (nunca rejeita). Slug inválido
    // fica de fora, como no e-mail.
    pushRuns.push(
      pushLeadAlerts(alerts.filter((alert) => isValidTenantSlug(alert.organizationSlug)))
    )

    const sent: string[] = []

    try {
      for (const alert of alerts) {
        if (!isValidTenantSlug(alert.organizationSlug)) {
          summary.invalidSlug += 1
          continue
        }

        const result = await sendAlert(alert)

        for (const [reason, count] of Object.entries(result.reasons)) {
          summary.reasons[reason] = (summary.reasons[reason] ?? 0) + (count ?? 0)
        }

        if (result.sent > 0) {
          sent.push(alert.id)
          continue
        }

        // daily_quota: a cota do dia acabou até para lead novo (classe 1). O push
        // deste lote já saiu; o que sobrou volta para a fila.
        if (
          result.reasons.not_configured ||
          result.reasons.rate_limited ||
          result.reasons.daily_quota
        ) {
          summary.halted = true
          halted = true
          break
        }
      }
    } finally {
      // Todo aviso reservado precisa voltar ao banco: o que não saiu como
      // enviado volta para a fila (o banco libera até 5 tentativas).
      const delivered = new Set(sent)
      const failed = alerts.map((alert) => alert.id).filter((id) => !delivered.has(id))
      const settled = await settleLeadAlerts(sent, failed)

      summary.sent += sent.length
      summary.failed += failed.length
      summary.settled += settled.sent
      summary.released += settled.released
    }

    if (alerts.length < size) {
      return summary
    }
  }

  // Saiu do laço com lote cheio: pode ter sobrado aviso na fila.
  summary.truncated = !halted

  return summary
}

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) {
    console.error("CRON_SECRET ausente")
    return reply(500, { error: "not_configured" })
  }

  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return reply(401, { error: "unauthorized" })
  }

  const pushRuns: Promise<LeadAlertPushSummary>[] = []
  const summary = await drainQueue(pushRuns)

  for (const push of await Promise.all(pushRuns)) {
    summary.push.attempted += push.attempted
    summary.push.delivered += push.delivered
    summary.push.removed += push.removed
    summary.push.failed += push.failed
  }

  if (summary.failed > 0 || summary.invalidSlug > 0 || summary.truncated || summary.halted) {
    console.error(
      `[leads/cron] ${summary.sent}/${summary.claimed} aviso(s) enviado(s), ${summary.failed} devolvido(s) à fila, ${summary.invalidSlug} com slug inválido${summary.truncated ? " (limite por execução atingido)" : ""}${summary.halted ? " (envio interrompido: configuração ou cota)" : ""}; push ${summary.push.delivered}/${summary.push.attempted}`
    )
  } else {
    console.info(
      `[leads/cron] ${summary.sent}/${summary.claimed} aviso(s) enviado(s); push ${summary.push.delivered}/${summary.push.attempted}`
    )
  }

  return reply(200, { ok: true, ...summary })
}

export async function GET(request: Request) {
  return handle(request)
}

/** O banco chama por webhook (pg_net) assim que um aviso entra na fila. */
export async function POST(request: Request) {
  return handle(request)
}
