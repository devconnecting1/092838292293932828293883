import "server-only"

import { z } from "zod"

import type { DailyDigestEmailParams } from "@workspace/core/email/agenda-templates"
import { DAILY_DIGEST_STALE_LEAD_DAYS, formatDisplayAddress } from "@workspace/core/email/reminders"
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
 * Resumo diário por e-mail (07h de Brasília). Único ponto de chamada de
 * claim_daily_digests e settle_daily_digests. O banco reserva um resumo por
 * imobiliária, pessoa e dia (private.daily_digest_deliveries) e só devolve quem
 * tem conteúdo; aqui o JSON vira os parâmetros do modelo, com o endereço já no
 * modo de exibição do imóvel. Nada aqui lança.
 */

const SCOPE = "lembretes/resumo"

/** O banco recorta em 100 por chamada. */
const MAX_CLAIM = 100

export type DailyDigest = {
  /** Id da reserva: volta no settle e entra na chave de idempotência. */
  id: string
  organizationId: string
  organizationSlug: string
  organizationName: string
  brandColor: string | null
  recipientUserId: string
  recipientEmail: string
  recipientName: string | null
  digest: Omit<DailyDigestEmailParams, "origin" | "brand" | "recipientName">
}

const text = z.string().nullable().optional()
const total = z.coerce.number().int().nonnegative().catch(0)

const taskSchema = z.object({ id: z.string(), title: z.string(), due_at: text })

const visitSchema = z.object({
  id: z.string(),
  starts_at: z.string(),
  ends_at: text,
  status: text,
  meeting_point: text,
  client_first_name: text,
  property: z
    .object({
      id: z.string(),
      code: text,
      title: text,
      address_display: text,
      street: text,
      street_number: text,
      neighborhood: text,
      city: text,
      state: text,
    })
    .nullable()
    .optional(),
})

const leadSchema = z.object({
  id: z.string(),
  name: z.string(),
  stage: text,
  last_contact_at: text,
})

const birthdaySchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().int().nullable().optional(),
})

/** Lista tolerante: item malformado é descartado, o resto segue. */
function listOf<T extends z.ZodType>(schema: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = schema.safeParse(item)
        return parsed.success ? [parsed.data as z.infer<T>] : []
      })
    )
}

const contentSchema = z.object({
  stale_days: z.coerce.number().int().positive().catch(DAILY_DIGEST_STALE_LEAD_DAYS),
  tasks_overdue_total: total,
  tasks_overdue: listOf(taskSchema),
  tasks_today_total: total,
  tasks_today: listOf(taskSchema),
  visits_total: total,
  visits: listOf(visitSchema),
  stale_leads_total: total,
  stale_leads: listOf(leadSchema),
  birthdays_total: total,
  birthdays: listOf(birthdaySchema),
})

const rowSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  organization_slug: z.string(),
  organization_name: z.string().nullable(),
  brand_color: z.string().nullable(),
  digest_date: z.string(),
  recipient_user_id: z.string(),
  recipient_email: z.string(),
  recipient_name: z.string().nullable(),
  content: z.unknown(),
})

function toDigest(row: z.infer<typeof rowSchema>): DailyDigest | null {
  const content = contentSchema.safeParse(row.content)
  const recipientEmail = normalizeEmailAddress(row.recipient_email)
  const organizationSlug = cleanText(row.organization_slug, { maxLength: 63 })

  if (
    !content.success ||
    !recipientEmail ||
    !organizationSlug ||
    !isUuid(row.id) ||
    !isUuid(row.organization_id) ||
    !isUuid(row.recipient_user_id) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.digest_date)
  ) {
    return null
  }

  const data = content.data

  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationSlug,
    organizationName: cleanText(row.organization_name, { maxLength: 80 }),
    brandColor: row.brand_color,
    recipientUserId: row.recipient_user_id,
    recipientEmail,
    recipientName: cleanText(row.recipient_name, { maxLength: 120 }) || null,
    digest: {
      date: row.digest_date,
      tasksOverdue: {
        total: data.tasks_overdue_total,
        items: data.tasks_overdue.map((task) => ({
          id: task.id,
          title: task.title,
          dueAt: task.due_at,
        })),
      },
      tasksToday: {
        total: data.tasks_today_total,
        items: data.tasks_today.map((task) => ({
          id: task.id,
          title: task.title,
          dueAt: task.due_at,
        })),
      },
      visits: {
        total: data.visits_total,
        items: data.visits.map((visit) => ({
          id: visit.id,
          startsAt: visit.starts_at,
          endsAt: visit.ends_at,
          propertyCode: visit.property?.code,
          propertyTitle: visit.property?.title,
          address: visit.property
            ? formatDisplayAddress({
                addressDisplay: visit.property.address_display,
                street: visit.property.street,
                streetNumber: visit.property.street_number,
                neighborhood: visit.property.neighborhood,
                city: visit.property.city,
                state: visit.property.state,
              })
            : null,
          meetingPoint: visit.meeting_point,
          clientFirstName: visit.client_first_name,
        })),
      },
      staleLeads: {
        total: data.stale_leads_total,
        days: data.stale_days,
        items: data.stale_leads.map((lead) => ({
          id: lead.id,
          name: lead.name,
          stage: lead.stage,
          lastContactAt: lead.last_contact_at,
        })),
      },
      birthdays: {
        total: data.birthdays_total,
        items: data.birthdays.map((birthday) => ({
          id: birthday.id,
          name: birthday.name,
          age: birthday.age,
        })),
      },
    },
  }
}

/**
 * Reserva os resumos de hoje (marca claimed_at e soma uma tentativa). Todo id
 * devolvido precisa voltar em settleDailyDigests, senão fica preso por 15 min.
 */
export async function claimDailyDigests(limit: number): Promise<DailyDigest[]> {
  const context = getQueueContext(SCOPE)

  if (!context) {
    return []
  }

  try {
    const { data, error } = await context.supabase.rpc("claim_daily_digests", {
      p_server_key: context.serverKey,
      p_limit: clampLimit(limit, MAX_CLAIM),
      p_stale_days: DAILY_DIGEST_STALE_LEAD_DAYS,
    })

    if (error) {
      logRpcError(SCOPE, "claim_daily_digests", error)
      return []
    }

    if (!Array.isArray(data)) {
      console.error(`[${SCOPE}] claim_daily_digests: resposta inesperada`)
      return []
    }

    const digests: DailyDigest[] = []
    let discarded = 0

    for (const row of data) {
      const parsed = rowSchema.safeParse(row)
      const digest = parsed.success ? toDigest(parsed.data) : null

      if (digest) {
        digests.push(digest)
      } else {
        discarded += 1
      }
    }

    if (discarded > 0) {
      console.error(`[${SCOPE}] claim: ${discarded} resumo(s) com dados inválidos descartado(s)`)
    }

    return digests
  } catch (cause) {
    logRpcException(SCOPE, "claim_daily_digests", cause)
    return []
  }
}

/** Confirma enviados, devolve falhas (conta tentativa) e não tentados (não conta). */
export async function settleDailyDigests(input: {
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
    const { data, error } = await context.supabase.rpc("settle_daily_digests", {
      p_server_key: context.serverKey,
      p_sent: ids.sent,
      p_failed: ids.failed,
      p_released: ids.released,
    })

    if (error) {
      logRpcError(SCOPE, "settle_daily_digests", error)
      return EMPTY_SETTLEMENT
    }

    return readSettlement(data)
  } catch (cause) {
    logRpcException(SCOPE, "settle_daily_digests", cause)
    return EMPTY_SETTLEMENT
  }
}
