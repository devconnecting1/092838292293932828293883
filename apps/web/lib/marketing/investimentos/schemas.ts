import { z } from "zod"

import {
  isMonthKey,
  MARKETING_CAMPAIGN_MAX_LENGTH,
  MARKETING_INVESTMENT_MAX_CENTS,
  MARKETING_NOTES_MAX_LENGTH,
} from "@workspace/core/reports/marketing-investments"

import { parseBrlCents } from "@/lib/comissoes/money"
import { LEAD_SOURCES } from "@/lib/leads/constants"
import type { LeadSource } from "@/lib/leads/db-types"

// Schema do formulário (cliente) revalidado na Server Action. O valor chega
// mascarado ("1.234,56") e a action converte para centavos com parseBrlCents.

export const investmentSchema = z.object({
  /** Vazio = lançamento novo. */
  id: z.union([z.literal(""), z.guid("Lançamento inválido.")]),
  month: z.string().refine(isMonthKey, "Escolha o mês."),
  source: z.enum(LEAD_SOURCES as unknown as [LeadSource, ...LeadSource[]], {
    error: "Escolha o canal.",
  }),
  campaign: z
    .string()
    .trim()
    .max(
      MARKETING_CAMPAIGN_MAX_LENGTH,
      `Use no máximo ${MARKETING_CAMPAIGN_MAX_LENGTH} caracteres.`
    ),
  amount: z
    .string()
    .trim()
    .refine((value) => parseBrlCents(value) !== null, "Informe o valor investido.")
    .refine(
      (value) => (parseBrlCents(value) ?? 0) <= MARKETING_INVESTMENT_MAX_CENTS,
      "Valor acima do permitido."
    ),
  notes: z
    .string()
    .trim()
    .max(MARKETING_NOTES_MAX_LENGTH, `Use no máximo ${MARKETING_NOTES_MAX_LENGTH} caracteres.`),
})

export type InvestmentValues = z.infer<typeof investmentSchema>

export const investmentIdSchema = z.guid("Lançamento inválido.")
