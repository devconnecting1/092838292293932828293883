import { z } from "zod"

import type { Enums } from "@workspace/database/types"

import { isDateKey, isTimeKey } from "@/lib/agenda/datetime"

export const TASK_TITLE_MAX_LENGTH = 200
export const TASK_DESCRIPTION_MAX_LENGTH = 5000

export const TASK_PRIORITIES = [
  "low",
  "medium",
  "high",
] as const satisfies readonly Enums<"task_priority">[]

export function isTaskPriority(value: unknown): value is Enums<"task_priority"> {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value)
}

/** Opção de combobox (cliente ou imóvel); o servidor só usa o id. */
const entityOptionSchema = z.object({
  id: z.guid("Seleção inválida."),
  label: z.string(),
  description: z.string().nullable(),
})

export const taskFormSchema = z
  .object({
    /** null = nova tarefa. */
    id: z.guid("Tarefa inválida.").nullable(),
    title: z
      .string()
      .trim()
      .min(1, "Informe o título da tarefa.")
      .max(TASK_TITLE_MAX_LENGTH, "O título pode ter no máximo 200 caracteres."),
    description: z
      .string()
      .trim()
      .max(TASK_DESCRIPTION_MAX_LENGTH, "A descrição pode ter no máximo 5.000 caracteres."),
    assigneeId: z.guid("Selecione o responsável."),
    /** "AAAA-MM-DD" (Brasília) ou "" sem prazo. */
    dueDate: z.string().refine((value) => value === "" || isDateKey(value), "Data inválida."),
    /** "HH:MM" (Brasília) ou "" = fim do dia (23:59). */
    dueTime: z
      .string()
      .refine((value) => value === "" || isTimeKey(value), "Hora inválida. Use o formato HH:MM."),
    priority: z.enum(TASK_PRIORITIES, "Escolha a prioridade."),
    client: entityOptionSchema.nullable(),
    property: entityOptionSchema.nullable(),
  })
  .superRefine((values, ctx) => {
    if (values.dueTime && !values.dueDate) {
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Informe a data do prazo para usar um horário.",
      })
    }
  })

export type TaskFormValues = z.infer<typeof taskFormSchema>

export const taskIdSchema = z.guid("Tarefa inválida.")
