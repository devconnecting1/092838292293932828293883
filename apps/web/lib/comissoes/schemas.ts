import { z } from "zod"

import {
  COMMISSION_BASES,
  COMMISSION_PURPOSES,
  describeSplitImbalance,
  type CommissionBasis,
  type CommissionPurpose,
  type CommissionSplit,
} from "@workspace/core/comissoes"

// Schemas compartilhados entre os formulários (cliente) e as Server Actions.
// Percentuais são números (até 3 casas); dinheiro é string mascarada que a
// action converte para CENTAVOS inteiros com parseBrlCents.

const percentField = z
  .number({ error: "Informe um percentual." })
  .min(0, "O percentual não pode ser negativo.")
  .max(100, "O percentual não pode passar de 100%.")
  .refine(
    (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6,
    "Use no máximo três casas decimais."
  )

const purposeField = z.enum(
  COMMISSION_PURPOSES as unknown as [CommissionPurpose, ...CommissionPurpose[]]
)
const basisField = z.enum(COMMISSION_BASES as unknown as [CommissionBasis, ...CommissionBasis[]])

export const commissionRuleSchema = z
  .object({
    purpose: purposeField,
    basis: basisField,
    /** Usado quando `basis` é "percent". */
    percent: percentField,
    /** Usado quando `basis` é "fixed". Valor mascarado em reais. */
    fixedAmount: z.string().trim(),
    capturerPercent: percentField,
    sellerPercent: percentField,
    managerPercent: percentField,
    agencyPercent: percentField,
    partnerPercent: percentField,
    note: z.string().trim().max(500, "A observação pode ter no máximo 500 caracteres."),
  })
  .refine((values) => values.basis !== "fixed" || values.fixedAmount.replace(/\D/g, "") !== "", {
    message: "Informe o valor fixo da comissão.",
    path: ["fixedAmount"],
  })
  // A divisão precisa fechar 100%. O banco tem a mesma regra
  // (commission_rules_split_closes): aqui é só para o erro chegar antes.
  .refine((values) => describeSplitImbalance(toSplit(values)) === null, {
    message: "A divisão precisa somar exatamente 100%.",
    path: ["agencyPercent"],
  })

export type CommissionRuleValues = z.infer<typeof commissionRuleSchema>

/** Percentuais do formulário no formato do core. */
export function toSplit(values: {
  capturerPercent: number
  sellerPercent: number
  managerPercent: number
  agencyPercent: number
  partnerPercent: number
}): CommissionSplit {
  return {
    capturer: values.capturerPercent,
    seller: values.sellerPercent,
    manager: values.managerPercent,
    agency: values.agencyPercent,
    partner: values.partnerPercent,
  }
}

export const commissionSettingsSchema = z.object({
  /** Vazio = a fatia de gerência fica com a imobiliária. */
  managerUserId: z.string().trim(),
  discountApprovalEnabled: z.boolean(),
  maxDiscountPercent: percentField,
})

export type CommissionSettingsValues = z.infer<typeof commissionSettingsSchema>

export const payShareSchema = z.object({
  shareId: z.guid("Parte inválida."),
  /** Data do pagamento (yyyy-mm-dd). Vazio = hoje. */
  paidOn: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), "Data inválida."),
  note: z.string().trim().max(500, "A observação pode ter no máximo 500 caracteres."),
})

export type PayShareValues = z.infer<typeof payShareSchema>

export const discountRequestSchema = z.object({
  proposalId: z.guid("Proposta inválida."),
  reason: z.string().trim().max(1000, "A justificativa pode ter no máximo 1000 caracteres."),
})

export type DiscountRequestValues = z.infer<typeof discountRequestSchema>

export const discountReviewSchema = z.object({
  requestId: z.guid("Pedido inválido."),
  approve: z.boolean(),
  note: z.string().trim().max(1000, "A observação pode ter no máximo 1000 caracteres."),
})

export type DiscountReviewValues = z.infer<typeof discountReviewSchema>

export const commissionPartnerSchema = z.object({
  commissionId: z.guid("Comissão inválida."),
  /** Vazio remove o parceiro e devolve o valor para a imobiliária. */
  partnerName: z.string().trim().max(160, "O nome pode ter no máximo 160 caracteres."),
  percent: percentField,
})

export type CommissionPartnerValues = z.infer<typeof commissionPartnerSchema>
