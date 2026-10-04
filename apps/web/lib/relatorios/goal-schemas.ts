import { z } from "zod"

import {
  GOAL_METRICS,
  isGoalAmountMetric,
  isMonthKey,
  type GoalMetric,
  type GoalValues,
} from "@workspace/core/reports/sales-goals"

import { amountToBrlInput, parseBrlInput } from "@/lib/propostas/money"

/**
 * Formulário da meta do mês. Os campos são texto (quantidade com dígitos,
 * valor com a máscara de reais); vazio = sem meta naquele indicador. Sem
 * nenhum indicador preenchido, o banco apaga a meta.
 */

/** Teto das quantidades: cabe em `integer` com folga e pega erro de digitação. */
export const GOAL_COUNT_MAX = 100_000
const GOAL_AMOUNT_MAX = 999_999_999_999.99

const countField = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{1,6}$/.test(value), "Use só números inteiros.")
  .refine(
    (value) => value === "" || Number(value) <= GOAL_COUNT_MAX,
    `A meta pode ser de no máximo ${GOAL_COUNT_MAX.toLocaleString("pt-BR")}.`
  )

const amountField = z
  .string()
  .refine((value) => (parseBrlInput(value) ?? 0) <= GOAL_AMOUNT_MAX, "Valor alto demais.")

export const goalFormSchema = z.object({
  leadsAnswered: countField,
  visits: countField,
  proposals: countField,
  salesCount: countField,
  salesAmount: amountField,
  rentalsCount: countField,
  rentalsAmount: amountField,
})

export type GoalFormValues = z.infer<typeof goalFormSchema>

export const saveGoalSchema = z.object({
  month: z.string().refine(isMonthKey, "Mês inválido."),
  kind: z.enum(["team", "broker"], "Meta inválida."),
  targetId: z.guid("Meta inválida."),
  values: goalFormSchema,
})

export type SaveGoalInput = z.infer<typeof saveGoalSchema>

/** Texto do formulário → número (ou null quando vazio). */
export function goalFormToNumbers(values: GoalFormValues): GoalValues<number | null> {
  return Object.fromEntries(
    GOAL_METRICS.map((metric: GoalMetric) => {
      const raw = values[metric]

      if (isGoalAmountMetric(metric)) {
        return [metric, parseBrlInput(raw)]
      }

      const trimmed = raw.trim()
      return [metric, trimmed === "" ? null : Number(trimmed)]
    })
  ) as GoalValues<number | null>
}

/** Meta gravada → texto do formulário. */
export function goalNumbersToForm(goal: GoalValues<number | null>): GoalFormValues {
  return Object.fromEntries(
    GOAL_METRICS.map((metric: GoalMetric) => {
      const value = goal[metric]

      if (value === null) return [metric, ""]
      return [metric, isGoalAmountMetric(metric) ? amountToBrlInput(value) : String(value)]
    })
  ) as GoalFormValues
}
