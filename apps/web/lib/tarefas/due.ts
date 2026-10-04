import { isDateKey, isTimeKey, toDateKey, toTimeKey, zonedToIso } from "@/lib/agenda/datetime"

/**
 * Prazo de tarefa informado só com a data vence às 23:59 de Brasília e é
 * exibido sem horário. Módulo puro (servidor e navegador).
 */
export const TASK_ALL_DAY_TIME = "23:59"

/** Data ("AAAA-MM-DD") e hora ("HH:MM" ou "") de Brasília para ISO; sem data, null. */
export function dueInputToIso(dueDate: string, dueTime: string): string | null {
  if (!isDateKey(dueDate)) {
    return null
  }

  return zonedToIso(dueDate, isTimeKey(dueTime) ? dueTime : TASK_ALL_DAY_TIME)
}

/** ISO gravado no banco para os campos do formulário (hora vazia quando 23:59). */
export function dueIsoToInput(dueAt: string | null | undefined): {
  dueDate: string
  dueTime: string
} {
  if (!dueAt) {
    return { dueDate: "", dueTime: "" }
  }

  const date = new Date(dueAt)

  if (Number.isNaN(date.getTime())) {
    return { dueDate: "", dueTime: "" }
  }

  const time = toTimeKey(date)

  return {
    dueDate: toDateKey(date),
    dueTime: time === TASK_ALL_DAY_TIME ? "" : time,
  }
}
