import type { Enums } from "@workspace/database/types"

/** Tarefa pronta para a lista de /tarefas (serializável para Client Components). */
export type TaskListItem = {
  id: string
  title: string
  description: string | null
  dueAt: string | null
  priority: Enums<"task_priority">
  status: Enums<"task_status">
  completedAt: string | null
  createdAt: string
  assigneeId: string | null
  createdBy: string | null
  /** Aberta com prazo antes de "agora" (calculado no servidor). */
  isOverdue: boolean
  clientId: string | null
  /** null quando não há cliente ou o RLS não deixa ver o cliente. */
  client: { id: string; name: string } | null
  propertyId: string | null
  property: { id: string; code: string; title: string } | null
}

export type TaskGroupKey = "overdue" | "today" | "upcoming" | "noDue" | "done"

export type TaskGroups = Record<TaskGroupKey, TaskListItem[]>
