import "server-only"

import { z } from "zod"

import { formatDisplayAddress } from "@workspace/core/email/reminders"
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
 * Lembretes de visita 2 horas antes. A fila é do banco
 * (private.visit_reminder_notifications): o job pg_cron `lembretes-de-visita`
 * enfileira a cada 5 minutos e chama a rota por webhook (pg_net) quando há
 * lembrete. Único ponto de chamada de claim_visit_reminders e
 * settle_visit_reminders. Nada aqui lança; logs só com contagens.
 */

const SCOPE = "lembretes/visita"

const MAX_CLAIM = 100

export type VisitReminder = {
  id: string
  organizationId: string
  organizationSlug: string
  organizationName: string
  brandColor: string | null
  recipientUserId: string
  recipientEmail: string
  recipientName: string | null
  visit: {
    id: string
    status: string
    startsAt: string
    endsAt: string | null
    propertyCode: string | null
    propertyTitle: string | null
    /** Já no modo de exibição do imóvel. */
    address: string | null
    meetingPoint: string | null
    clientFirstName: string | null
  }
}

/** Linha de claim_visit_reminders (o aviso de visita marcada devolve as mesmas colunas e mais algumas). */
export const visitReminderRowSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  organization_slug: z.string(),
  organization_name: z.string().nullable(),
  brand_color: z.string().nullable(),
  appointment_id: z.string(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  appointment_status: z.string(),
  meeting_point: z.string().nullable(),
  client_first_name: z.string().nullable(),
  property_code: z.string().nullable(),
  property_title: z.string().nullable(),
  address_display: z.string().nullable(),
  street: z.string().nullable(),
  street_number: z.string().nullable(),
  neighborhood: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  recipient_user_id: z.string(),
  recipient_email: z.string(),
  recipient_name: z.string().nullable(),
})

export function toVisitReminder(row: z.infer<typeof visitReminderRowSchema>): VisitReminder | null {
  const recipientEmail = normalizeEmailAddress(row.recipient_email)
  const organizationSlug = cleanText(row.organization_slug, { maxLength: 63 })

  if (
    !recipientEmail ||
    !organizationSlug ||
    !isUuid(row.id) ||
    !isUuid(row.organization_id) ||
    !isUuid(row.appointment_id) ||
    !isUuid(row.recipient_user_id) ||
    Number.isNaN(Date.parse(row.starts_at))
  ) {
    return null
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationSlug,
    organizationName: cleanText(row.organization_name, { maxLength: 80 }),
    brandColor: row.brand_color,
    recipientUserId: row.recipient_user_id,
    recipientEmail,
    recipientName: cleanText(row.recipient_name, { maxLength: 120 }) || null,
    visit: {
      id: row.appointment_id,
      status: row.appointment_status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      propertyCode: row.property_code,
      propertyTitle: row.property_title,
      address: formatDisplayAddress({
        addressDisplay: row.address_display,
        street: row.street,
        streetNumber: row.street_number,
        neighborhood: row.neighborhood,
        city: row.city,
        state: row.state,
      }),
      meetingPoint: row.meeting_point,
      clientFirstName: row.client_first_name,
    },
  }
}

/** Reserva os lembretes pendentes. Todo id devolvido precisa voltar no settle. */
export async function claimVisitReminders(limit: number): Promise<VisitReminder[]> {
  const context = getQueueContext(SCOPE)

  if (!context) {
    return []
  }

  try {
    const { data, error } = await context.supabase.rpc("claim_visit_reminders", {
      p_server_key: context.serverKey,
      p_limit: clampLimit(limit, MAX_CLAIM),
    })

    if (error) {
      logRpcError(SCOPE, "claim_visit_reminders", error)
      return []
    }

    if (!Array.isArray(data)) {
      console.error(`[${SCOPE}] claim_visit_reminders: resposta inesperada`)
      return []
    }

    const reminders: VisitReminder[] = []
    let discarded = 0

    for (const row of data) {
      const parsed = visitReminderRowSchema.safeParse(row)
      const reminder = parsed.success ? toVisitReminder(parsed.data) : null

      if (reminder) {
        reminders.push(reminder)
      } else {
        discarded += 1
      }
    }

    if (discarded > 0) {
      console.error(`[${SCOPE}] claim: ${discarded} lembrete(s) com dados inválidos descartado(s)`)
    }

    return reminders
  } catch (cause) {
    logRpcException(SCOPE, "claim_visit_reminders", cause)
    return []
  }
}

export async function settleVisitReminders(input: {
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
    const { data, error } = await context.supabase.rpc("settle_visit_reminders", {
      p_server_key: context.serverKey,
      p_sent: ids.sent,
      p_failed: ids.failed,
      p_released: ids.released,
    })

    if (error) {
      logRpcError(SCOPE, "settle_visit_reminders", error)
      return EMPTY_SETTLEMENT
    }

    return readSettlement(data)
  } catch (cause) {
    logRpcException(SCOPE, "settle_visit_reminders", cause)
    return EMPTY_SETTLEMENT
  }
}
