import { z } from "zod"

import type { Enums } from "@workspace/database/types"

import { isTaskPriority } from "@/lib/tarefas/schemas"

/** Valor de ?responsavel= para "minhas tarefas". */
export const TASK_ASSIGNEE_ME = "eu"

export type TaskFilterParams = {
  /** "eu", uuid de membro ou null (todas as tarefas visíveis). */
  responsavel: string | null
  prioridade: Enums<"task_priority"> | null
}

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/** Valida os filtros da URL de /tarefas; valores inválidos são ignorados. */
export function parseTaskFilters(params: SearchParams): TaskFilterParams {
  const responsavelParam = firstValue(params.responsavel)?.trim()
  const prioridadeParam = firstValue(params.prioridade)

  const responsavel =
    responsavelParam === TASK_ASSIGNEE_ME || z.guid().safeParse(responsavelParam).success
      ? (responsavelParam ?? null)
      : null

  return {
    responsavel,
    prioridade: isTaskPriority(prioridadeParam) ? prioridadeParam : null,
  }
}
