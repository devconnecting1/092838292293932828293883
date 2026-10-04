import { z } from "zod"

import {
  PROPOSAL_DEADLINE_MAX_LENGTH,
  PROPOSAL_EXCHANGE_MAX_LENGTH,
  PROPOSAL_ROUND_KIND_VALUES,
  type ProposalRoundKind,
} from "@workspace/core/proposals/rounds"

import { parseBrlInput } from "@/lib/propostas/money"

const MAX_AMOUNT = 999_999_999_999.99

function isGuid(value: string) {
  return z.guid().safeParse(value).success
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

export const PROPOSAL_PURPOSES = ["sale", "rent"] as const

const amountSchema = z
  .string()
  .refine((value) => (parseBrlInput(value) ?? 0) > 0, "Informe o valor da proposta.")
  .refine((value) => (parseBrlInput(value) ?? 0) <= MAX_AMOUNT, "Valor alto demais.")

const paymentTermsSchema = z
  .string()
  .trim()
  .max(5000, "A forma de pagamento pode ter no máximo 5.000 caracteres.")

const conditionsSchema = z
  .string()
  .trim()
  .max(5000, "As condições podem ter no máximo 5.000 caracteres.")

const validUntilSchema = z
  .string()
  .refine((value) => value === "" || isIsoDate(value), "Data inválida.")

/**
 * Data prevista de fechamento (opcional): dia civil dentro do intervalo que o
 * banco aceita (`proposals_expected_close_date_check`). Base da aba Previsão.
 */
const expectedCloseDateSchema = z
  .string()
  .refine((value) => value === "" || isIsoDate(value), "Data inválida.")
  .refine(
    (value) => value === "" || (value >= "2000-01-01" && value <= "2100-12-31"),
    "Escolha uma data prevista entre 2000 e 2100."
  )

/** Valor opcional em reais (sinal, financiamento): vazio ou de 0 até o máximo. */
const optionalMoneySchema = z
  .string()
  .refine((value) => (parseBrlInput(value) ?? 0) <= MAX_AMOUNT, "Valor alto demais.")

const exchangeSchema = z
  .string()
  .trim()
  .max(
    PROPOSAL_EXCHANGE_MAX_LENGTH,
    `A permuta pode ter no máximo ${PROPOSAL_EXCHANGE_MAX_LENGTH} caracteres.`
  )

const deadlineSchema = z
  .string()
  .trim()
  .max(
    PROPOSAL_DEADLINE_MAX_LENGTH,
    `O prazo pode ter no máximo ${PROPOSAL_DEADLINE_MAX_LENGTH} caracteres.`
  )

export const proposalFormSchema = z.object({
  propertyId: z.string().refine(isGuid, "Selecione o imóvel."),
  clientId: z.string().refine(isGuid, "Selecione o cliente."),
  brokerId: z.string().refine((value) => value === "" || isGuid(value), "Corretor inválido."),
  purpose: z.enum(PROPOSAL_PURPOSES, "Selecione a finalidade."),
  amount: amountSchema,
  paymentTerms: paymentTermsSchema,
  conditions: conditionsSchema,
  validUntil: validUntilSchema,
  // Opcional também no tipo: quem monta a edição sem ler a coluna não apaga a
  // data já gravada (a action só grava quando o campo veio).
  expectedCloseDate: expectedCloseDateSchema.optional(),
  // Condições da proposta inicial (sinal, financiamento, permuta e prazo). Só no
  // cadastro: depois, valores e condições mudam por rodada da negociação.
  downPayment: optionalMoneySchema.optional(),
  financingAmount: optionalMoneySchema.optional(),
  exchangeDescription: exchangeSchema.optional(),
  paymentDeadline: deadlineSchema.optional(),
})

export type ProposalFormValues = z.infer<typeof proposalFormSchema>

export const proposalIdSchema = z.guid("Proposta inválida.")

/** Nova rodada da negociação: valor e todas as condições vigentes. */
export const proposalRoundSchema = z.object({
  kind: z.enum(
    PROPOSAL_ROUND_KIND_VALUES as [ProposalRoundKind, ...ProposalRoundKind[]],
    "Escolha quem fez a proposta desta rodada."
  ),
  amount: amountSchema,
  downPayment: optionalMoneySchema,
  financingAmount: optionalMoneySchema,
  exchangeDescription: exchangeSchema,
  paymentDeadline: deadlineSchema,
  paymentTerms: paymentTermsSchema,
  conditions: conditionsSchema,
  validUntil: validUntilSchema,
})

export type ProposalRoundValues = z.infer<typeof proposalRoundSchema>
