"use server"

import { revalidatePath } from "next/cache"

import { requireMembership } from "@/lib/auth/session"
import {
  INVALID_FIELDS_MESSAGE,
  toFieldErrors,
  type ActionResult,
  type ActionResultWithData,
} from "@/lib/clientes/action-result"
import { permissionDeniedMessage, translateDatabaseError } from "@/lib/clientes/db-errors"
import { createClient } from "@/lib/supabase/server"
import { dueInputToIso } from "@/lib/tarefas/due"
import { canCreateTasks, canDeleteTask, canUpdateTask } from "@/lib/tarefas/permissions"
import { taskFormSchema, taskIdSchema, type TaskFormValues } from "@/lib/tarefas/schemas"

const TASK_NOT_FOUND_MESSAGE = "Tarefa não encontrada. Ela pode ter sido removida."

type TaskLinks = { client_id: string | null; property_id: string | null }

/** Revalida a lista, o painel e as fichas de cliente/imóvel ligadas (antes e depois). */
function revalidateTaskPaths(...links: TaskLinks[]) {
  revalidatePath("/tarefas")
  revalidatePath("/painel")

  const clientIds = new Set<string>()
  const propertyIds = new Set<string>()

  for (const link of links) {
    if (link.client_id) clientIds.add(link.client_id)
    if (link.property_id) propertyIds.add(link.property_id)
  }

  for (const clientId of clientIds) {
    revalidatePath(`/clientes/${clientId}`)
  }

  for (const propertyId of propertyIds) {
    revalidatePath(`/imoveis/${propertyId}`)
  }
}

/** Cria (values.id = null) ou atualiza uma tarefa. */
export async function saveTask(
  values: TaskFormValues
): Promise<ActionResultWithData<{ id: string }>> {
  const parsed = taskFormSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: toFieldErrors(parsed.error),
    }
  }

  const { user, membership } = await requireMembership()
  const data = parsed.data
  const supabase = await createClient()

  const columns = {
    title: data.title,
    description: data.description || null,
    due_at: dueInputToIso(data.dueDate, data.dueTime),
    priority: data.priority,
    client_id: data.client?.id ?? null,
    property_id: data.property?.id ?? null,
  }

  if (!data.id) {
    if (!canCreateTasks(membership.role)) {
      return { ok: false, error: permissionDeniedMessage("criar tarefas") }
    }

    // created_by não é enviado: o banco o define como auth.uid() (trigger) e bloqueia troca.
    const { data: created, error } = await supabase
      .from("tasks")
      .insert({
        organization_id: membership.organizationId,
        assignee_id: data.assigneeId,
        ...columns,
      })
      .select("id")
      .single()

    if (error) {
      return {
        ok: false,
        error: translateDatabaseError(error, "criar esta tarefa"),
      }
    }

    revalidateTaskPaths(columns)
    return { ok: true, data: { id: created.id }, message: "Tarefa criada." }
  }

  const { data: current, error: currentError } = await supabase
    .from("tasks")
    .select("id, assignee_id, created_by, client_id, property_id")
    .eq("id", data.id)
    .eq("organization_id", membership.organizationId)
    .maybeSingle()

  if (currentError) {
    return {
      ok: false,
      error: translateDatabaseError(currentError, "editar esta tarefa"),
    }
  }

  if (!current) {
    return { ok: false, error: TASK_NOT_FOUND_MESSAGE }
  }

  if (
    !canUpdateTask(
      membership.role,
      { assigneeId: current.assignee_id, createdBy: current.created_by },
      user.id
    )
  ) {
    return { ok: false, error: permissionDeniedMessage("editar esta tarefa") }
  }

  // A política de UPDATE de tasks não confere o acesso ao cliente (a de INSERT
  // confere): ao trocar o cliente, exija que ele seja visível para o usuário.
  if (columns.client_id && columns.client_id !== current.client_id) {
    const { data: visibleClient } = await supabase
      .from("clients")
      .select("id")
      .eq("id", columns.client_id)
      .eq("organization_id", membership.organizationId)
      .maybeSingle()

    if (!visibleClient) {
      return {
        ok: false,
        error: permissionDeniedMessage("vincular este cliente à tarefa"),
      }
    }
  }

  const { data: updated, error } = await supabase
    .from("tasks")
    .update({
      ...columns,
      // O trigger tasks_validate_members roda sempre que a coluna vai no UPDATE:
      // só enviar quando muda evita barrar a edição de tarefa de ex-membro.
      ...(data.assigneeId !== current.assignee_id ? { assignee_id: data.assigneeId } : {}),
    })
    .eq("id", current.id)
    .eq("organization_id", membership.organizationId)
    .select("id")

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "editar esta tarefa"),
    }
  }

  // UPDATE barrado pelo RLS não dá erro: volta sem linhas.
  if (updated.length === 0) {
    return { ok: false, error: permissionDeniedMessage("editar esta tarefa") }
  }

  revalidateTaskPaths(current, columns)
  return { ok: true, data: { id: current.id }, message: "Tarefa atualizada." }
}

/** Conclui (done = true) ou reabre a tarefa. O trigger cuida de completed_at. */
export async function setTaskStatus(id: string, done: boolean): Promise<ActionResult> {
  const parsedId = taskIdSchema.safeParse(id)

  if (!parsedId.success || typeof done !== "boolean") {
    return { ok: false, error: "Tarefa inválida." }
  }

  const { membership } = await requireMembership()
  const supabase = await createClient()
  const action = done ? "concluir esta tarefa" : "reabrir esta tarefa"

  const { data, error } = await supabase
    .from("tasks")
    .update({ status: done ? "done" : "open" })
    .eq("id", parsedId.data)
    .eq("organization_id", membership.organizationId)
    .select("id, client_id, property_id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  if (data.length === 0) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  revalidateTaskPaths(...data)
  return { ok: true, message: done ? "Tarefa concluída." : "Tarefa reaberta." }
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const parsedId = taskIdSchema.safeParse(id)

  if (!parsedId.success) {
    return { ok: false, error: "Tarefa inválida." }
  }

  const { user, membership } = await requireMembership()
  const supabase = await createClient()

  const { data: current, error: currentError } = await supabase
    .from("tasks")
    .select("id, created_by")
    .eq("id", parsedId.data)
    .eq("organization_id", membership.organizationId)
    .maybeSingle()

  if (currentError) {
    return {
      ok: false,
      error: translateDatabaseError(currentError, "excluir esta tarefa"),
    }
  }

  if (!current) {
    return { ok: false, error: TASK_NOT_FOUND_MESSAGE }
  }

  if (!canDeleteTask(membership.role, { createdBy: current.created_by }, user.id)) {
    return { ok: false, error: permissionDeniedMessage("excluir esta tarefa") }
  }

  const { data, error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", current.id)
    .eq("organization_id", membership.organizationId)
    .select("id, client_id, property_id")

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "excluir esta tarefa"),
    }
  }

  // DELETE barrado pelo RLS não dá erro: volta sem linhas.
  if (data.length === 0) {
    return { ok: false, error: permissionDeniedMessage("excluir esta tarefa") }
  }

  revalidateTaskPaths(...data)
  return { ok: true, message: "Tarefa excluída." }
}
