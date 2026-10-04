import { z } from "zod"

import { AI_MAX_OVERAGE_CAP_CENTS, formatBRL } from "@workspace/core/billing"

import { parseBrlInput } from "@/lib/imoveis/number"

// Schema do teto de excedente de IA, compartilhado entre o formulário (cliente)
// e a Server Action. O campo é texto mascarado em pt-BR ("1.234,56"); vazio
// significa "sem excedente" (0).

/** Texto do campo → centavos. Vazio vira 0; texto inválido vira null. */
export function parseOverageCapCents(value: string): number | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return 0
  }

  const reais = parseBrlInput(trimmed)

  if (reais === null || Number.isNaN(reais)) {
    return null
  }

  return Math.round(reais * 100)
}

export const aiOverageCapSchema = z.object({
  overageCap: z
    .string()
    .refine(
      (value) => parseOverageCapCents(value) !== null,
      "Informe um valor em reais, como 50,00."
    )
    .refine(
      (value) => {
        const cents = parseOverageCapCents(value)
        return cents === null || cents <= AI_MAX_OVERAGE_CAP_CENTS
      },
      `O teto máximo é ${formatBRL(AI_MAX_OVERAGE_CAP_CENTS)} por ciclo.`
    ),
})

export type AiOverageCapValues = z.infer<typeof aiOverageCapSchema>
