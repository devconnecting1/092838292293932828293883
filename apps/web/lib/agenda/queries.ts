import "server-only"

import { getDayRange, getMonthRange, toDateKey } from "@/lib/agenda/datetime"
import type { AppointmentStatus } from "@/lib/agenda/schemas"
import type { AgendaAppointment } from "@/lib/agenda/types"
import { createClient } from "@/lib/supabase/server"

export type { AgendaAppointment }

export type AgendaData = {
  dayAppointments: AgendaAppointment[]
  pending: AgendaAppointment[]
  pendingTotal: number
  /** Dias do mês com visitas (exceto canceladas). */
  visitDays: string[]
  /** Dias do mês com visitas passadas sem retorno. */
  overdueDays: string[]
  failed: boolean
}

export const PENDING_LIMIT = 10

const OPEN_STATUSES = ["scheduled", "confirmed"] as const satisfies readonly AppointmentStatus[]

// FKs compostas (organization_id, property_id|client_id): o embed precisa do nome da constraint.
const APPOINTMENT_SELECT =
  "id, status, starts_at, ends_at, meeting_point, feedback, rating, broker_id, created_by, property_id, client_id, property:properties!appointments_property_fkey(id, code, title, neighborhood), client:clients!appointments_client_fkey(id, name)"

export function isOverdueAppointment(status: AppointmentStatus, startsAt: string, now: Date) {
  return (
    (status === "scheduled" || status === "confirmed") &&
    new Date(startsAt).getTime() < now.getTime()
  )
}

function single<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

type AppointmentRow = {
  id: string
  status: AppointmentStatus
  starts_at: string
  ends_at: string | null
  meeting_point: string | null
  feedback: string | null
  rating: number | null
  broker_id: string | null
  created_by: string | null
  property_id: string | null
  client_id: string | null
  property:
    | { id: string; code: string; title: string; neighborhood: string | null }
    | { id: string; code: string; title: string; neighborhood: string | null }[]
    | null
  client: { id: string; name: string } | { id: string; name: string }[] | null
}

function toAgendaAppointment(row: AppointmentRow, now: Date): AgendaAppointment {
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dateKey: toDateKey(row.starts_at),
    meetingPoint: row.meeting_point,
    feedback: row.feedback,
    rating: row.rating,
    brokerId: row.broker_id,
    createdBy: row.created_by,
    propertyId: row.property_id,
    clientId: row.client_id,
    property: single(row.property),
    client: single(row.client),
    overdue: isOverdueAppointment(row.status, row.starts_at, now),
  }
}

/**
 * Dados da agenda: marcações do mês, visitas do dia e pendentes de retorno.
 * `brokerId` null = toda a equipe (o RLS ainda limita o que cada papel vê).
 */
export async function getAgendaData({
  organizationId,
  brokerId,
  day,
  month,
  now,
}: {
  organizationId: string
  brokerId: string | null
  day: string
  month: string
  now: Date
}): Promise<AgendaData> {
  const supabase = await createClient()
  const dayRange = getDayRange(day)
  const monthRange = getMonthRange(month)
  const nowIso = now.toISOString()

  let monthQuery = supabase
    .from("appointments")
    .select("status, starts_at")
    .eq("organization_id", organizationId)
    .gte("starts_at", monthRange.start)
    .lt("starts_at", monthRange.end)
    .neq("status", "canceled")

  let dayQuery = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT)
    .eq("organization_id", organizationId)
    .gte("starts_at", dayRange.start)
    .lt("starts_at", dayRange.end)
    .order("starts_at", { ascending: true })

  let pendingQuery = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT, { count: "exact" })
    .eq("organization_id", organizationId)
    .in("status", OPEN_STATUSES)
    .lt("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(PENDING_LIMIT)

  if (brokerId) {
    monthQuery = monthQuery.eq("broker_id", brokerId)
    dayQuery = dayQuery.eq("broker_id", brokerId)
    pendingQuery = pendingQuery.eq("broker_id", brokerId)
  }

  const [monthResult, dayResult, pendingResult] = await Promise.all([
    monthQuery,
    dayQuery,
    pendingQuery,
  ])

  const visitDays = new Set<string>()
  const overdueDays = new Set<string>()

  for (const row of monthResult.data ?? []) {
    const dateKey = toDateKey(row.starts_at)
    visitDays.add(dateKey)

    if (isOverdueAppointment(row.status, row.starts_at, now)) {
      overdueDays.add(dateKey)
    }
  }

  const pending = (pendingResult.data ?? []).map((row) => toAgendaAppointment(row, now))

  return {
    dayAppointments: (dayResult.data ?? []).map((row) => toAgendaAppointment(row, now)),
    pending,
    pendingTotal: pendingResult.count ?? pending.length,
    visitDays: [...visitDays],
    overdueDays: [...overdueDays],
    failed: Boolean(monthResult.error || dayResult.error || pendingResult.error),
  }
}
