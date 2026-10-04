import "server-only"

import {
  normalizeMetaLead,
  toIngestLeadPayload,
  type MetaLeadgenEvent,
} from "@workspace/core/leads/ingest"
import type { Json } from "@workspace/database/types"

import { fetchLead } from "@/lib/integracoes/meta"
import {
  claimLeadDeliveries,
  failLeadDelivery,
  ingestExternalLead,
  readIntegrationSecret,
  type ClaimedDelivery,
} from "@/lib/integracoes/rpc"

/**
 * Segunda etapa da entrega da Meta: o webhook só recebe o ID do lead, então os
 * dados são buscados no Graph API depois de responder 200.
 *
 * Roda em dois lugares:
 * - logo depois da resposta do webhook (`after()`), que é o caminho normal;
 * - em /api/cron/lead-ingest (pg_cron a cada 5 min quando há entrega vencida,
 *   ou a rotina diária da Vercel), que é a rede de segurança para quando a
 *   Meta não responde na hora (ela desiste de reenviar em 36 h; nossa fila
 *   tenta 6 vezes com espera crescente).
 *
 * Nada aqui registra dado pessoal nem token em log: só contagens e motivos.
 */

export type DeliveryOutcome = "accepted" | "duplicate" | "rejected" | "failed" | "unknown"

async function processOne(delivery: {
  organizationId: string
  eventId: string
  pageId: string
  event?: MetaLeadgenEvent
}): Promise<DeliveryOutcome> {
  const accessToken = await readIntegrationSecret(delivery.organizationId, "meta_lead_ads")

  if (!accessToken) {
    await failLeadDelivery({
      organizationId: delivery.organizationId,
      provider: "meta_lead_ads",
      eventId: delivery.eventId,
      reason: "credencial_recusada",
      detail: "sem credencial guardada",
    })

    return "failed"
  }

  const lead = await fetchLead(delivery.eventId, accessToken)

  if (!lead.ok) {
    await failLeadDelivery({
      organizationId: delivery.organizationId,
      provider: "meta_lead_ads",
      eventId: delivery.eventId,
      reason: lead.kind,
      detail: lead.detail,
    })

    return "failed"
  }

  const event: MetaLeadgenEvent = delivery.event ?? {
    leadgenId: delivery.eventId,
    pageId: delivery.pageId,
    formId: lead.data.formId,
    adId: lead.data.adId,
    adgroupId: null,
    createdAt: null,
  }

  const normalized = normalizeMetaLead(
    {
      event,
      fieldData: lead.data.fieldData,
      createdTime: lead.data.createdTime,
      platform: lead.data.platform,
    },
    Date.now()
  )

  const payload = normalized.ok ? toIngestLeadPayload(normalized.lead) : normalized.partial

  if (!payload) {
    await failLeadDelivery({
      organizationId: delivery.organizationId,
      provider: "meta_lead_ads",
      eventId: delivery.eventId,
      reason: "payload_invalido",
      detail: "resposta do Graph API sem os campos do formulário",
    })

    return "failed"
  }

  // Quem decide aceitar, duplicar ou recusar é o banco, com o motivo.
  const outcome = await ingestExternalLead({
    organizationId: delivery.organizationId,
    provider: "meta_lead_ads",
    payload: payload as unknown as Json,
  })

  if (
    outcome.status === "accepted" ||
    outcome.status === "duplicate" ||
    outcome.status === "rejected"
  ) {
    return outcome.status
  }

  return "unknown"
}

/** Um evento recém-chegado pelo webhook (chamado dentro de `after()`). */
export async function processMetaDelivery(input: {
  organizationId: string
  event: MetaLeadgenEvent
}): Promise<DeliveryOutcome> {
  return processOne({
    organizationId: input.organizationId,
    eventId: input.event.leadgenId,
    pageId: input.event.pageId,
    event: input.event,
  })
}

export type DrainSummary = {
  claimed: number
  accepted: number
  duplicate: number
  rejected: number
  failed: number
}

/**
 * Esvazia a fila de entregas pendentes. Cada entrega é independente: uma que
 * falha não impede as outras.
 */
export async function drainPendingDeliveries(limit: number): Promise<DrainSummary> {
  const summary: DrainSummary = { claimed: 0, accepted: 0, duplicate: 0, rejected: 0, failed: 0 }
  const deliveries: ClaimedDelivery[] = await claimLeadDeliveries(limit)

  summary.claimed = deliveries.length

  for (const delivery of deliveries) {
    // Hoje só a Meta entrega em duas etapas: o Canal Pro manda o lead inteiro
    // no POST e nunca deixa entrega pendente.
    if (delivery.provider !== "meta_lead_ads") {
      continue
    }

    let outcome: DeliveryOutcome = "failed"

    try {
      outcome = await processOne({
        organizationId: delivery.organizationId,
        eventId: delivery.eventId,
        pageId: delivery.accountId,
      })
    } catch (cause) {
      console.error(
        `[integracoes/meta] entrega não processada (${cause instanceof Error ? cause.name : "erro"})`
      )
    }

    if (outcome === "accepted" || outcome === "duplicate" || outcome === "rejected") {
      summary[outcome] += 1
    } else {
      summary.failed += 1
    }
  }

  return summary
}
