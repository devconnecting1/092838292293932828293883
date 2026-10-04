import type { Role } from "@/lib/auth/roles"

/**
 * Espelho, para a interface, das políticas RLS de tasks. A garantia continua
 * sendo o banco.
 */
export const TASK_VIEW_ALL_ROLES: readonly Role[] = ["owner", "manager", "assistant", "finance"]

/** Qualquer membro ativo cria tarefas. */
export function canCreateTasks(role: Role) {
  return Boolean(role)
}

export function canViewAllTasks(role: Role) {
  return TASK_VIEW_ALL_ROLES.includes(role)
}

export function canUpdateTask(
  role: Role,
  task: { assigneeId: string | null; createdBy: string | null },
  userId: string
) {
  return (
    role === "owner" ||
    role === "manager" ||
    task.assigneeId === userId ||
    task.createdBy === userId
  )
}

export function canDeleteTask(role: Role, task: { createdBy: string | null }, userId: string) {
  return role === "owner" || role === "manager" || task.createdBy === userId
}
