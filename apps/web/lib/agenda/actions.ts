"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"

import type { TablesUpdate } from "@workspace/database/types"

import { zonedToIso } from "@/lib/agenda/datetime"
import { formatVisitMoment } from "@/lib/agenda/labels"
import {
  canDeleteAppointments,
  canScheduleAppointments,
  canScheduleForOthers,
  canUpdateAppointment,
} from "@/lib/agenda/permissions"
import {
  appointmentIdSchema,
  appointmentStatusUpdateSchema,
  saveAppointmentSchema,
  type AppointmentStatus,
  type AppointmentStatusUpdateInput,
  type SaveAppointmentInput,
} from "@/lib/agenda/schemas"
import { requireMembership } from "@/lib/auth/session"
import {
  INVALID_FIELDS_MESSAGE,
  toFieldErrors,
  type ActionResult,
  type ActionResultWithData,
} from "@/lib/clientes/action-result"
import { permissionDeniedMessage, translateDatabaseError } from "@/lib/clientes/db-errors"
import { drainVisitAssignmentNotices } from "@/lib/lembretes/visit-assignments"
import { createClient } from "@/lib/supabase/server"

type ServerClient = Awaited<ReturnType<typeof createClient>>

const ACTIVITY_BODY_MAX_LENGTH = 10000
const HISTORY_NOT_UPDATED = "O histórico do cliente não foi atualizado."
const APPOINTMENT_NOT_FOUND = "Visita não encontrada. Ela pode ter sido removida."

/** E-mails de "visita marcada para você" enviados logo depois de salvar (o resto vai pelo job). */
const ASSIGNMENT_NOTICE_EMAILS_NOW = 5

/**
 * Quem marcou não é o corretor da visita: o banco já enfileirou o aviso
 * (gatilho em appointments); envia push e e-mail depois da resposta.
 */
function notifyBrokerAfterSave(brokerId: string | null | undefined, userId: string) {
  if (!brokerId || brokerId === userId) return

  after(async () => {
    await drainVisitAssignmentNotices(ASSIGNMENT_NOTICE_EMAILS_NOW)
  })
}

const STATUS_SUCCESS_MESSAGES: Record<AppointmentStatus, string> = {
  scheduled: "Visita reaberta como agendada.",
  confirmed: "Visita confirmada.",
  done: "Retorno da visita registrado.",
  no_show: "Visita marcada como não comparecimento.",
  canceled: "Visita cancelada.",
}

function revalidateAgenda({
  clientIds = [],
  propertyIds = [],
}: {
  clientIds?: (string | null | undefined)[]
  propertyIds?: (string | null | undefined)[]
}) {
  revalidatePath("/agenda")
  revalidatePath("/painel")

  for (const clientId of new Set(clientIds)) {
    if (clientId) revalidatePath(`/clientes/${clientId}`)
  }

  for (const propertyId of new Set(propertyIds)) {
    if (propertyId) revalidatePath(`/imoveis/${propertyId}`)
  }
}

/** "IMV-000123 Título" (formato do histórico do cliente). */
function propertyInline(property: { code: string; title: string } | null | undefined) {
  return property ? `${property.code} ${property.title}` : null
}

function joinParts(parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ")
}

/**
 * Registra a visita na linha do tempo do cliente. Falha aqui não desfaz a
 * visita: quem chama avisa que o histórico não foi atualizado.
 */
async function insertVisitActivity(
  supabase: ServerClient,
  activity: {
    organizationId: string
    clientId: string
    propertyId: string | null
    body: string
  }
) {
  const { error } = await supabase.from("activities").insert({
    organization_id: activity.organizationId,
    client_id: activity.clientId,
    property_id: activity.propertyId,
    type: "visit",
    body: activity.body.slice(0, ACTIVITY_BODY_MAX_LENGTH),
  })

  return !error
}

/** O cliente precisa existir e ser visível para quem agenda (RLS de clients). */
async function ensureClientAccessible(
  supabase: ServerClient,
  organizationId: string,
  clientId: string
) {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", clientId)
    .maybeSingle()

  return !error && Boolean(data)
}

export async function saveAppointment(
  values: SaveAppointmentInput
): Promise<ActionResultWithData<{ id: string }>> {
  const parsed = saveAppointmentSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: toFieldErrors(parsed.error),
    }
  }

  const input = parsed.data
  const isEdit = Boolean(input.id)
  const action = isEdit ? "editar esta visita" : "agendar visitas"
  const { user, membership } = await requireMembership()
  const { organizationId, role } = membership

  if (!canScheduleAppointments(role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  if (!input.property) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: { property: "Selecione o imóvel da visita." },
    }
  }

  const supabase = await createClient()
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id, code, title")
    .eq("organization_id", organizationId)
    .eq("id", input.property.id)
    .maybeSingle()

  if (propertyError) {
    return { ok: false, error: translateDatabaseError(propertyError, action) }
  }

  if (!property) {
    return {
      ok: false,
      error: "Imóvel não encontrado. Ele pode ter sido removido.",
      fieldErrors: { property: "Imóvel não encontrado." },
    }
  }

  const clientId = input.client?.id ?? null
  const startsAt = zonedToIso(input.date, input.startTime)
  const endsAt = zonedToIso(input.date, input.endTime)
  const meetingPoint = input.meetingPoint || null

  // ---------------------------------------------------------------------------
  // Nova visita
  // ---------------------------------------------------------------------------
  if (!input.id) {
    if (clientId && !(await ensureClientAccessible(supabase, organizationId, clientId))) {
      return {
        ok: false,
        error: "Cliente não encontrado ou sem acesso.",
        fieldErrors: { client: "Cliente não encontrado ou sem acesso." },
      }
    }

    // Corretor e captador só agendam para si (espelha o RLS).
    const brokerId = canScheduleForOthers(role) ? input.brokerId : user.id
    const { data: created, error } = await supabase
      .from("appointments")
      .insert({
        organization_id: organizationId,
        property_id: property.id,
        client_id: clientId,
        broker_id: brokerId,
        starts_at: startsAt,
        ends_at: endsAt,
        meeting_point: meetingPoint,
      })
      .select("id")
      .single()

    if (error) {
      return {
        ok: false,
        error: translateDatabaseError(error, "agendar esta visita"),
      }
    }

    let historyUpdated = true

    if (clientId) {
      historyUpdated = await insertVisitActivity(supabase, {
        organizationId,
        clientId,
        propertyId: property.id,
        body: joinParts([
          `Visita agendada para ${formatVisitMoment(startsAt)}`,
          propertyInline(property),
        ]),
      })
    }

    revalidateAgenda({ clientIds: [clientId], propertyIds: [property.id] })
    notifyBrokerAfterSave(brokerId, user.id)

    return {
      ok: true,
      data: { id: created.id },
      message: historyUpdated ? "Visita agendada." : `Visita agendada. ${HISTORY_NOT_UPDATED}`,
    }
  }

  // ---------------------------------------------------------------------------
  // Edição
  // ---------------------------------------------------------------------------
  const { data: existing, error: existingError } = await supabase
    .from("appointments")
    .select("id, broker_id, created_by, client_id, property_id")
    .eq("organization_id", organizationId)
    .eq("id", input.id)
    .maybeSingle()

  if (existingError) {
    return { ok: false, error: translateDatabaseError(existingError, action) }
  }

  if (!existing) {
    return { ok: false, error: APPOINTMENT_NOT_FOUND }
  }

  if (
    !canUpdateAppointment(
      role,
      { brokerId: existing.broker_id, createdBy: existing.created_by },
      user.id
    )
  ) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  if (
    clientId &&
    clientId !== existing.client_id &&
    !(await ensureClientAccessible(supabase, organizationId, clientId))
  ) {
    return {
      ok: false,
      error: "Cliente não encontrado ou sem acesso.",
      fieldErrors: { client: "Cliente não encontrado ou sem acesso." },
    }
  }

  const changes: TablesUpdate<"appointments"> = {
    property_id: property.id,
    client_id: clientId,
    starts_at: startsAt,
    ends_at: endsAt,
    meeting_point: meetingPoint,
  }

  // Só a gestão troca o corretor; corretor/captador mantém o atual.
  if (canScheduleForOthers(role)) {
    changes.broker_id = input.brokerId
  }

  const { data: updated, error: updateError } = await supabase
    .from("appointments")
    .update(changes)
    .eq("organization_id", organizationId)
    .eq("id", existing.id)
    .select("id")

  if (updateError) {
    return { ok: false, error: translateDatabaseError(updateError, action) }
  }

  // UPDATE bloqueado pelo RLS não dá erro: volta sem linhas.
  if (!updated || updated.length === 0) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  revalidateAgenda({
    clientIds: [existing.client_id, clientId],
    propertyIds: [existing.property_id, property.id],
  })
  notifyBrokerAfterSave(changes.broker_id ?? existing.broker_id, user.id)

  return { ok: true, data: { id: existing.id }, message: "Visita atualizada." }
}

export async function updateAppointmentStatus(
  values: AppointmentStatusUpdateInput
): Promise<ActionResult> {
  const parsed = appointmentStatusUpdateSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? INVALID_FIELDS_MESSAGE,
    }
  }

  const { id, status, rating, feedback } = parsed.data
  const action = "alterar esta visita"
  const { user, membership } = await requireMembership()
  const { organizationId, role } = membership
  const supabase = await createClient()

  const { data: existing, error: existingError } = await supabase
    .from("appointments")
    .select(
      "id, status, starts_at, broker_id, created_by, client_id, property_id, property:properties!appointments_property_fkey(code, title)"
    )
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle()

  if (existingError) {
    return { ok: false, error: translateDatabaseError(existingError, action) }
  }

  if (!existing) {
    return { ok: false, error: APPOINTMENT_NOT_FOUND }
  }

  if (
    !canUpdateAppointment(
      role,
      { brokerId: existing.broker_id, createdBy: existing.created_by },
      user.id
    )
  ) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const isDone = status === "done"
  const cleanFeedback = feedback ? feedback : null

  // Nota e retorno só fazem sentido para visita realizada: saindo de "done", limpa.
  const { data: updated, error: updateError } = await supabase
    .from("appointments")
    .update({
      status,
      rating: isDone ? (rating ?? null) : null,
      feedback: isDone ? cleanFeedback : null,
    })
    .eq("organization_id", organizationId)
    .eq("id", existing.id)
    .select("id")

  if (updateError) {
    return { ok: false, error: translateDatabaseError(updateError, action) }
  }

  if (!updated || updated.length === 0) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  let historyUpdated = true
  const statusChanged = existing.status !== status

  if (existing.client_id && statusChanged) {
    const property = Array.isArray(existing.property) ? existing.property[0] : existing.property
    const moment = formatVisitMoment(existing.starts_at)
    const body =
      status === "done"
        ? joinParts(["Visita realizada", rating ? `nota ${rating}/5` : null, cleanFeedback])
        : status === "no_show"
          ? joinParts([`Cliente não compareceu à visita de ${moment}`, propertyInline(property)])
          : status === "canceled"
            ? joinParts([`Visita de ${moment} cancelada`, propertyInline(property)])
            : null

    if (body) {
      historyUpdated = await insertVisitActivity(supabase, {
        organizationId,
        clientId: existing.client_id,
        propertyId: existing.property_id,
        body,
      })
    }
  }

  revalidateAgenda({
    clientIds: [existing.client_id],
    propertyIds: [existing.property_id],
  })

  const message = STATUS_SUCCESS_MESSAGES[status]

  return {
    ok: true,
    message: historyUpdated ? message : `${message} ${HISTORY_NOT_UPDATED}`,
  }
}

export async function deleteAppointment(id: string): Promise<ActionResult> {
  const parsed = appointmentIdSchema.safeParse(id)

  if (!parsed.success) {
    return { ok: false, error: "Visita inválida." }
  }

  const action = "excluir visitas"
  const { membership } = await requireMembership()
  const { organizationId, role } = membership

  if (!canDeleteAppointments(role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createClient()
  const { data: existing, error: existingError } = await supabase
    .from("appointments")
    .select("id, client_id, property_id")
    .eq("organization_id", organizationId)
    .eq("id", parsed.data)
    .maybeSingle()

  if (existingError) {
    return { ok: false, error: translateDatabaseError(existingError, action) }
  }

  if (!existing) {
    return { ok: false, error: APPOINTMENT_NOT_FOUND }
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("appointments")
    .delete()
    .eq("organization_id", organizationId)
    .eq("id", existing.id)
    .select("id")

  if (deleteError) {
    return { ok: false, error: translateDatabaseError(deleteError, action) }
  }

  // DELETE bloqueado pelo RLS não dá erro: volta sem linhas.
  if (!deleted || deleted.length === 0) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  revalidateAgenda({
    clientIds: [existing.client_id],
    propertyIds: [existing.property_id],
  })

  return { ok: true, message: "Visita excluída." }
}
