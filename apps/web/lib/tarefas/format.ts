import { formatDateKey, toDateKey, toTimeKey } from "@/lib/agenda/datetime"
import { TASK_ALL_DAY_TIME } from "@/lib/tarefas/due"

/**
 * Prazo da tarefa em pt-BR, no fuso de Brasília: "—" sem prazo,
 * "15/09/2026" quando vence às 23:59 (prazo sem hora) ou "15/09/2026 às 14:30".
 */
export function formatTaskDue(dueAt: string | null): string {
  if (!dueAt) {
    return "—"
  }

  const date = new Date(dueAt)

  if (Number.isNaN(date.getTime())) {
    return "—"
  }

  const dateLabel = formatDateKey(toDateKey(date))
  const time = toTimeKey(date)

  return time === TASK_ALL_DAY_TIME ? dateLabel : `${dateLabel} às ${time}`
}
