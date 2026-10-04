"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { visitFollowUpTitle } from "@workspace/core/email/reminders"

import { formatDateKey, isDateKey, toDateKey } from "@/lib/agenda/datetime"
import { formatVisitMoment } from "@/lib/agenda/labels"
import { requireMembership } from "@/lib/auth/session"
import type { ActionResultWithData } from "@/lib/clientes/action-result"
import { permissionDeniedMessage, translateDatabaseError } from "@/lib/clientes/db-errors"
import { createClient } from "@/lib/supabase/server"
import { dueInputToIso } from "@/lib/tarefas/due"
import { canCreateTasks } from "@/lib/tarefas/permissions"
import { TASK_DESCRIPTION_MAX_LENGTH } from "@/lib/tarefas/schemas"

const followUpSchema = z.object({
  appointmentId: z.guid("Visita inválida."),
  dueDate: z.string().refine(isDateKey, "Escolha a data do retorno."),
})

export type VisitFollowUpInput = z.infer<typeof followUpSchema>

function single<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

/**
 * Cria a tarefa de retorno de uma visita realizada (oferecida no diálogo
 * "Marcar como realizada", com o próximo dia útil já sugerido). A tarefa fica
 * com o corretor da visita, ligada ao imóvel e ao cliente (quando quem cria
 * enxerga o cliente), vence no fim do dia escolhido e não duplica se o mesmo
 * retorno já estiver aberto.
 */
export async function createVisitFollowUpTask(
  values: VisitFollowUpInput
): Promise<ActionResultWithData<{ id: string }>> {
  const parsed = followUpSchema.safeParse(values)

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." }
  }

  const { appointmentId, dueDate } = parsed.data
  const action = "criar a tarefa de retorno"
  const { user, membership } = await requireMembership()
  const { organizationId, role } = membership

  if (!canCreateTasks(role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  if (dueDate < toDateKey(new Date())) {
    return { ok: false, error: "A data do retorno não pode ficar no passado." }
  }

  const supabase = await createClient()
  const { data: visit, error: visitError } = await supabase
    .from("appointments")
    .select(
      "id, status, starts_at, broker_id, client_id, property_id, rating, feedback, property:properties!appointments_property_fkey(code, title), client:clients!appointments_client_fkey(id, name)"
    )
    .eq("organization_id", organizationId)
    .eq("id", appointmentId)
    .maybeSingle()

  if (visitError) {
    return { ok: false, error: translateDatabaseError(visitError, action) }
  }

  if (!visit) {
    return { ok: false, error: "Visita não encontrada. Ela pode ter sido removida." }
  }

  if (visit.status !== "done") {
    return { ok: false, error: "Registre a visita como realizada antes de criar o retorno." }
  }

  const property = single(visit.property)
  // Cliente escondido pelo RLS: a tarefa sai sem o vínculo (o INSERT exigiria acesso).
  const client = single(visit.client)
  const title = visitFollowUpTitle({ clientName: client?.name, propertyCode: property?.code })
  const dueAt = dueInputToIso(dueDate, "")
  const assigneeId = visit.broker_id ?? user.id

  if (!dueAt) {
    return { ok: false, error: "Escolha a data do retorno." }
  }

  // Duplo clique ou diálogo reaberto: o mesmo retorno aberto não é criado de novo.
  const { data: existing } = await supabase
    .from("tasks")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .eq("title", title)
    .eq("due_at", dueAt)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return {
      ok: true,
      data: { id: existing.id },
      message: `A tarefa de retorno para ${formatDateKey(dueDate)} já estava criada.`,
    }
  }

  const description = [
    `Visita de ${formatVisitMoment(visit.starts_at)}`,
    property ? `Imóvel: ${property.code} ${property.title}` : null,
    visit.rating ? `Nota do cliente: ${visit.rating}/5` : null,
    visit.feedback ? `Retorno: ${visit.feedback}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, TASK_DESCRIPTION_MAX_LENGTH)

  // created_by vem do banco (trigger); o responsável é o corretor da visita.
  const { data: created, error } = await supabase
    .from("tasks")
    .insert({
      organization_id: organizationId,
      title,
      description,
      assignee_id: assigneeId,
      due_at: dueAt,
      priority: "high",
      client_id: client?.id ?? null,
      property_id: visit.property_id,
    })
    .select("id")
    .single()

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  revalidatePath("/tarefas")
  revalidatePath("/painel")
  revalidatePath("/agenda")

  if (client?.id) {
    revalidatePath(`/clientes/${client.id}`)
  }

  if (visit.property_id) {
    revalidatePath(`/imoveis/${visit.property_id}`)
  }

  return {
    ok: true,
    data: { id: created.id },
    message: `Tarefa de retorno criada para ${formatDateKey(dueDate)}.`,
  }
}
