import "server-only"

import { isUuid } from "@workspace/core/email/sanitize"

import { reserveLeadAlertPushes, type LeadAlert } from "@/lib/leads/alerts"
import { getVapidConfig } from "@/lib/push/config"
import { settlePushDeliveries } from "@/lib/push/deliveries"
import { leadAlertPush, shouldPushLeadAlert } from "@/lib/push/messages"
import { mapWithConcurrency, sendWebPush } from "@/lib/push/send"

/**
 * Push no celular dos avisos de lead (lead novo, prazo acabando, redistribuído,
 * prazo estourado). Roda em paralelo ao envio dos e-mails do mesmo lote, sem
 * atrasá-los, e nunca lança: em falha devolve contagens.
 *
 * Um push por aviso: claim_lead_notification_pushes grava a reserva antes do
 * envio. Falha temporária no serviço de push não é repetida (o e-mail continua
 * sendo o aviso garantido). Inscrição expirada (404/410) é removida.
 */

export type LeadAlertPushSummary = {
  /** Envios tentados (um por aviso e aparelho). */
  attempted: number
  delivered: number
  removed: number
  failed: number
}

const EMPTY_SUMMARY: LeadAlertPushSummary = { attempted: 0, delivered: 0, removed: 0, failed: 0 }

/** Envios simultâneos ao serviço de push por lote. */
const CONCURRENCY = 6

export async function pushLeadAlerts(alerts: readonly LeadAlert[]): Promise<LeadAlertPushSummary> {
  const vapid = getVapidConfig()

  if (!vapid || alerts.length === 0) {
    return EMPTY_SUMMARY
  }

  try {
    const now = Date.now()
    const byId = new Map(
      alerts.filter((alert) => shouldPushLeadAlert(alert, now)).map((alert) => [alert.id, alert])
    )
    const targets = await reserveLeadAlertPushes([...byId.keys()])

    if (targets.length === 0) {
      return EMPTY_SUMMARY
    }

    const results = await mapWithConcurrency(targets, CONCURRENCY, async (target) => {
      const alert = byId.get(target.alertId)

      if (!alert) {
        return {
          subscriptionId: target.subscriptionId,
          status: "failed" as const,
          statusCode: null,
        }
      }

      const { payload, options } = leadAlertPush(alert, now)
      const result = await sendWebPush(target, payload, options, vapid)

      return { subscriptionId: target.subscriptionId, ...result }
    })

    // O mesmo aparelho pode receber mais de um aviso no lote: contagem por envio,
    // conjuntos por aparelho.
    const delivered = new Set<string>()
    const gone = new Set<string>()
    const failures: Record<string, number> = {}
    let deliveredCount = 0
    let failedCount = 0

    for (const result of results) {
      if (result.status === "delivered") {
        deliveredCount += 1
        delivered.add(result.subscriptionId)
      } else if (result.status === "gone") {
        gone.add(result.subscriptionId)
      } else {
        failedCount += 1
        const code = String(result.statusCode ?? "rede")
        failures[code] = (failures[code] ?? 0) + 1
      }
    }

    const settled = await settlePushDeliveries(
      [...delivered].filter((id) => isUuid(id) && !gone.has(id)),
      [...gone].filter((id) => isUuid(id))
    )

    if (failedCount > 0) {
      console.error(
        `[push] ${failedCount} push(es) de aviso de lead não entregue(s) (${Object.entries(failures)
          .map(([code, count]) => `${code}: ${count}`)
          .join(", ")})`
      )
    }

    return {
      attempted: results.length,
      delivered: deliveredCount,
      removed: settled.removed,
      failed: failedCount,
    }
  } catch (cause) {
    console.error(
      `[push] avisos de lead falharam (${cause instanceof Error ? cause.name : "erro"})`
    )
    return EMPTY_SUMMARY
  }
}
