import "server-only"

import type { NotificationSummary } from "@/lib/email"
import type { QueueSettlement } from "@/lib/lembretes/queue-client"
import { isValidTenantSlug } from "@/lib/tenant/urls"

/**
 * Laço comum das filas de lembretes: reserva em lotes, envia um e-mail por item
 * e devolve TODO item reservado ao banco (enviado, falhou ou nem tentado).
 * Para quando a fila esvazia, quando o orçamento de e-mails da execução acaba
 * ou quando a Brevo diz que falta configuração ou cota (os próximos falhariam).
 */

export type DrainSummary = {
  batches: number
  claimed: number
  sent: number
  failed: number
  released: number
  invalidSlug: number
  /** Orçamento ou teto de lotes atingido com lote cheio: pode ter sobrado item. */
  truncated: boolean
  /** Parou por configuração ausente ou cota diária estourada (do provedor ou da plataforma). */
  halted: boolean
  reasons: Record<string, number>
}

export type DrainOptions<T extends { id: string; organizationSlug: string }> = {
  claim: (limit: number) => Promise<T[]>
  settle: (input: {
    sent: readonly string[]
    failed: readonly string[]
    released: readonly string[]
  }) => Promise<QueueSettlement>
  send: (item: T) => Promise<NotificationSummary>
  /** E-mails por execução (a Brevo Free divide 300/dia entre todos os avisos). */
  maxEmails: number
  batchSize: number
  maxBatches: number
}

export async function drainReminderQueue<T extends { id: string; organizationSlug: string }>(
  options: DrainOptions<T>
): Promise<DrainSummary> {
  const summary: DrainSummary = {
    batches: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    released: 0,
    invalidSlug: 0,
    truncated: false,
    halted: false,
    reasons: {},
  }

  let budget = Math.max(0, Math.floor(options.maxEmails))

  for (let batch = 0; batch < options.maxBatches && budget > 0 && !summary.halted; batch += 1) {
    const size = Math.min(options.batchSize, budget)
    const items = await options.claim(size)

    if (items.length === 0) {
      return summary
    }

    summary.batches += 1
    summary.claimed += items.length
    budget -= items.length

    const sent: string[] = []
    const failed: string[] = []
    const released: string[] = []

    try {
      for (const item of items) {
        if (summary.halted) {
          released.push(item.id)
          continue
        }

        if (!isValidTenantSlug(item.organizationSlug)) {
          summary.invalidSlug += 1
          failed.push(item.id)
          continue
        }

        const result = await options.send(item)

        for (const [reason, count] of Object.entries(result.reasons)) {
          summary.reasons[reason] = (summary.reasons[reason] ?? 0) + (count ?? 0)
        }

        if (result.sent > 0) {
          sent.push(item.id)
          continue
        }

        // Cota diária da plataforma acabou para esta classe: nem tentou. Volta
        // sem gastar tentativa (sai na próxima execução ou na repescagem) e o
        // banco já marcou o aviso como não enviado.
        if (result.reasons.daily_quota) {
          released.push(item.id)
          summary.halted = true
          continue
        }

        failed.push(item.id)

        if (result.reasons.not_configured || result.reasons.rate_limited) {
          summary.halted = true
        }
      }
    } finally {
      const accounted = new Set([...sent, ...failed, ...released])
      const leftovers = items.map((item) => item.id).filter((id) => !accounted.has(id))

      await options.settle({ sent, failed, released: [...released, ...leftovers] })

      summary.sent += sent.length
      summary.failed += failed.length
      summary.released += released.length + leftovers.length
    }

    if (items.length < size) {
      return summary
    }
  }

  summary.truncated = !summary.halted && summary.claimed > 0

  return summary
}

/** Linha de log só com contagens (nunca e-mail, nome ou conteúdo). */
export function logDrainSummary(scope: string, summary: DrainSummary) {
  const line = `[${scope}] ${summary.sent}/${summary.claimed} e-mail(s) enviado(s), ${summary.failed} com falha, ${summary.released} para a próxima execução`

  if (summary.failed > 0 || summary.invalidSlug > 0 || summary.truncated || summary.halted) {
    console.error(
      `${line}${summary.invalidSlug ? `, ${summary.invalidSlug} com slug inválido` : ""}${summary.truncated ? " (limite por execução atingido)" : ""}${summary.halted ? " (envio interrompido: configuração ou cota)" : ""}`
    )
  } else {
    console.info(line)
  }
}
