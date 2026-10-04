import "server-only"

import type { Enums } from "@workspace/database/types"

import { getDayRange, toDateKey } from "@/lib/agenda/datetime"
import { createClient } from "@/lib/supabase/server"
import type { TaskGroups, TaskListItem } from "@/lib/tarefas/types"

/** Teto de tarefas abertas carregadas de uma vez (proteção da página). */
const OPEN_TASKS_LIMIT = 500
/** Concluídas exibidas: as mais recentes por completed_at. */
export const DONE_TASKS_LIMIT = 30

const PRIORITY_RANK: Record<Enums<"task_priority">, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export type TaskListFilters = {
  assigneeId: string | null
  priority: Enums<"task_priority"> | null
}

export type TaskListResult = { ok: true; groups: TaskGroups } | { ok: false }

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

function dueTime(item: TaskListItem) {
  return item.dueAt ? Date.parse(item.dueAt) : Number.POSITIVE_INFINITY
}

/** Prazo mais cedo primeiro; em empate, prioridade alta; depois a mais antiga. */
function compareByDue(a: TaskListItem, b: TaskListItem) {
  const aDue = dueTime(a)
  const bDue = dueTime(b)

  if (aDue !== bDue) {
    return aDue < bDue ? -1 : 1
  }

  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]

  if (byPriority !== 0) {
    return byPriority
  }

  return a.createdAt.localeCompare(b.createdAt)
}

/**
 * Tarefas visíveis ao usuário (o RLS decide quais), agrupadas por prazo.
 * "Agora" e o fim do dia são calculados no servidor, no fuso de Brasília.
 * Canceladas não entram.
 */
export async function listTaskGroups(
  organizationId: string,
  filters: TaskListFilters
): Promise<TaskListResult> {
  const supabase = await createClient()
  const now = new Date()
  const nowMs = now.getTime()
  const endOfTodayMs = Date.parse(getDayRange(toDateKey(now)).end)

  let openQuery = supabase
    .from("tasks")
    .select(
      "id, title, description, due_at, priority, status, completed_at, created_at, assignee_id, created_by, client_id, property_id, client:clients!tasks_client_fkey(id, name), property:properties!tasks_property_fkey(id, code, title)"
    )
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(OPEN_TASKS_LIMIT)

  let doneQuery = supabase
    .from("tasks")
    .select(
      "id, title, description, due_at, priority, status, completed_at, created_at, assignee_id, created_by, client_id, property_id, client:clients!tasks_client_fkey(id, name), property:properties!tasks_property_fkey(id, code, title)"
    )
    .eq("organization_id", organizationId)
    .eq("status", "done")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(DONE_TASKS_LIMIT)

  if (filters.assigneeId) {
    openQuery = openQuery.eq("assignee_id", filters.assigneeId)
    doneQuery = doneQuery.eq("assignee_id", filters.assigneeId)
  }

  if (filters.priority) {
    openQuery = openQuery.eq("priority", filters.priority)
    doneQuery = doneQuery.eq("priority", filters.priority)
  }

  const [open, done] = await Promise.all([openQuery, doneQuery])

  if (open.error || done.error) {
    return { ok: false }
  }

  type Row = (typeof open.data)[number]

  const toItem = (row: Row): TaskListItem => {
    const client = pickOne(row.client)
    const property = pickOne(row.property)

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      dueAt: row.due_at,
      priority: row.priority,
      status: row.status,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      assigneeId: row.assignee_id,
      createdBy: row.created_by,
      isOverdue: row.status === "open" && row.due_at !== null && Date.parse(row.due_at) < nowMs,
      clientId: row.client_id,
      client: client ? { id: client.id, name: client.name } : null,
      propertyId: row.property_id,
      property: property ? { id: property.id, code: property.code, title: property.title } : null,
    }
  }

  const groups: TaskGroups = {
    overdue: [],
    today: [],
    upcoming: [],
    noDue: [],
    done: [],
  }

  for (const item of open.data.map(toItem)) {
    if (!item.dueAt) {
      groups.noDue.push(item)
    } else if (item.isOverdue) {
      groups.overdue.push(item)
    } else if (Date.parse(item.dueAt) < endOfTodayMs) {
      groups.today.push(item)
    } else {
      groups.upcoming.push(item)
    }
  }

  groups.overdue.sort(compareByDue)
  groups.today.sort(compareByDue)
  groups.upcoming.sort(compareByDue)
  groups.noDue.sort(compareByDue)
  groups.done = done.data.map(toItem)

  return { ok: true, groups }
}
