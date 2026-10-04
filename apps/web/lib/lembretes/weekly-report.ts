import "server-only"

import { z } from "zod"

import type { WeeklyReportEmailParams } from "@workspace/core/email/agenda-templates"
import { cleanText, isUuid, normalizeEmailAddress } from "@workspace/core/email/sanitize"

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

/**
 * Relatório semanal ao gestor (segunda 07h). Único ponto de chamada de
 * claim_weekly_reports e settle_weekly_reports. Os números chegam prontos do
 * banco — saem de report_broker_performance e report_broker_visits, as mesmas
 * funções da tela /relatorios — e aqui só mudam de nome de campo: nada é
 * recalculado no app. Nada aqui lança.
 */

const SCOPE = "lembretes/semanal"

const MAX_CLAIM = 200

export type WeeklyReport = {
  id: string
  organizationId: string
  organizationSlug: string
  organizationName: string
  brandColor: string | null
  recipientUserId: string
  recipientEmail: string
  recipientName: string | null
  report: Omit<WeeklyReportEmailParams, "origin" | "brand" | "recipientName">
}

/** numeric do Postgres pode chegar como número ou texto. */
const numeric = z.union([z.number(), z.string()]).transform((value) => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
})
const counter = numeric.catch(0)

const totalsSchema = z.object({
  brokers_with_activity: counter,
  leads_received: counter,
  leads_answered: counter,
  leads_in_sla: counter,
  leads_won: counter,
  leads_lost: counter,
  visits_scheduled: counter,
  visits_done: counter,
  visits_no_show: counter,
  proposals_made: counter,
  proposals_closed: counter,
  proposals_closed_amount: counter,
})

const brokerSchema = z.object({
  name: z.string().nullable().catch(null),
  active: z.boolean().nullable().catch(null),
  leads_received: counter,
  first_response_median_minutes: numeric.nullable().catch(null),
  visits_done: counter,
  visits_scheduled: counter,
  proposals_made: counter,
  proposals_closed: counter,
  leads_won: counter,
})

const reportSchema = z.object({
  totals: totalsSchema,
  brokers: z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = brokerSchema.safeParse(item)
        return parsed.success ? [parsed.data] : []
      })
    ),
})

const rowSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  organization_slug: z.string(),
  organization_name: z.string().nullable(),
  brand_color: z.string().nullable(),
  week_start: z.string(),
  week_end: z.string(),
  recipient_user_id: z.string(),
  recipient_email: z.string(),
  recipient_name: z.string().nullable(),
  report: z.unknown(),
})

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function toReport(row: z.infer<typeof rowSchema>): WeeklyReport | null {
  const report = reportSchema.safeParse(row.report)
  const recipientEmail = normalizeEmailAddress(row.recipient_email)
  const organizationSlug = cleanText(row.organization_slug, { maxLength: 63 })

  if (
    !report.success ||
    !recipientEmail ||
    !organizationSlug ||
    !isUuid(row.id) ||
    !isUuid(row.organization_id) ||
    !isUuid(row.recipient_user_id) ||
    !DATE_KEY.test(row.week_start) ||
    !DATE_KEY.test(row.week_end)
  ) {
    return null
  }

  const { totals, brokers } = report.data

  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationSlug,
    organizationName: cleanText(row.organization_name, { maxLength: 80 }),
    brandColor: row.brand_color,
    recipientUserId: row.recipient_user_id,
    recipientEmail,
    recipientName: cleanText(row.recipient_name, { maxLength: 120 }) || null,
    report: {
      weekStart: row.week_start,
      weekEnd: row.week_end,
      totals: {
        brokersWithActivity: totals.brokers_with_activity,
        leadsReceived: totals.leads_received,
        leadsAnswered: totals.leads_answered,
        leadsInSla: totals.leads_in_sla,
        leadsWon: totals.leads_won,
        leadsLost: totals.leads_lost,
        visitsScheduled: totals.visits_scheduled,
        visitsDone: totals.visits_done,
        visitsNoShow: totals.visits_no_show,
        proposalsMade: totals.proposals_made,
        proposalsClosed: totals.proposals_closed,
        proposalsClosedAmount: totals.proposals_closed_amount,
      },
      brokers: brokers.map((broker) => ({
        name: broker.name ?? "Membro sem nome",
        active: broker.active,
        leadsReceived: broker.leads_received,
        firstResponseMedianMinutes: broker.first_response_median_minutes,
        visitsDone: broker.visits_done,
        visitsScheduled: broker.visits_scheduled,
        proposalsMade: broker.proposals_made,
        proposalsClosed: broker.proposals_closed,
        leadsWon: broker.leads_won,
      })),
    },
  }
}

/** Reserva os relatórios da semana anterior. Todo id devolvido precisa voltar no settle. */
export async function claimWeeklyReports(limit: number): Promise<WeeklyReport[]> {
  const context = getQueueContext(SCOPE)

  if (!context) {
    return []
  }

  try {
    const { data, error } = await context.supabase.rpc("claim_weekly_reports", {
      p_server_key: context.serverKey,
      p_limit: clampLimit(limit, MAX_CLAIM),
    })

    if (error) {
      logRpcError(SCOPE, "claim_weekly_reports", error)
      return []
    }

    if (!Array.isArray(data)) {
      console.error(`[${SCOPE}] claim_weekly_reports: resposta inesperada`)
      return []
    }

    const reports: WeeklyReport[] = []
    let discarded = 0

    for (const row of data) {
      const parsed = rowSchema.safeParse(row)
      const report = parsed.success ? toReport(parsed.data) : null

      if (report) {
        reports.push(report)
      } else {
        discarded += 1
      }
    }

    if (discarded > 0) {
      console.error(`[${SCOPE}] claim: ${discarded} relatório(s) com dados inválidos descartado(s)`)
    }

    return reports
  } catch (cause) {
    logRpcException(SCOPE, "claim_weekly_reports", cause)
    return []
  }
}

export async function settleWeeklyReports(input: {
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
    const { data, error } = await context.supabase.rpc("settle_weekly_reports", {
      p_server_key: context.serverKey,
      p_sent: ids.sent,
      p_failed: ids.failed,
      p_released: ids.released,
    })

    if (error) {
      logRpcError(SCOPE, "settle_weekly_reports", error)
      return EMPTY_SETTLEMENT
    }

    return readSettlement(data)
  } catch (cause) {
    logRpcException(SCOPE, "settle_weekly_reports", cause)
    return EMPTY_SETTLEMENT
  }
}
