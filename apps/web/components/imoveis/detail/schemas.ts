import { z } from "zod"

import { isUuid } from "@/lib/imoveis/ids"
import { todayInSaoPaulo } from "@/lib/imoveis/mappers"

/**
 * Validação compartilhada entre os formulários da ficha (navegador) e as
 * Server Actions de proprietários e autorizações (servidor).
 */

/** Percentual digitado em pt-BR ("50", "33,33"). null = vazio; NaN = inválido. */
export function parsePercentInput(value: string): number | null {
  const trimmed = value.trim().replace(/\s|%/g, "")
  if (!trimmed) return null
  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(trimmed)) return Number.NaN
  return Number(trimmed.replace(",", "."))
}

export function formatPercentInput(value: number | null | undefined) {
  return value == null ? "" : String(value).replace(".", ",")
}

function percentField({
  min,
  minInclusive,
  label,
}: {
  min: number
  minInclusive: boolean
  label: string
}) {
  return z.string().superRefine((value, ctx) => {
    const parsed = parsePercentInput(value)
    if (parsed === null) return
    if (Number.isNaN(parsed)) {
      ctx.addIssue({
        code: "custom",
        message: "Use um número com até 2 casas decimais (ex.: 50 ou 33,33).",
      })
    } else if ((minInclusive ? parsed < min : parsed <= min) || parsed > 100) {
      ctx.addIssue({ code: "custom", message: label })
    }
  })
}

const sharePercentField = percentField({
  min: 0,
  minInclusive: false,
  label: "A participação precisa ser maior que 0% e no máximo 100%.",
})

const commissionPercentField = percentField({
  min: 0,
  minInclusive: true,
  label: "A comissão precisa estar entre 0% e 100%.",
})

// ---------------------------------------------------------------------------
// Proprietários
// ---------------------------------------------------------------------------

const ownerClientOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
})

export const addOwnerFormSchema = z.object({
  // Retorno `boolean` explícito: sem isso o type guard estreitaria o tipo do campo.
  client: ownerClientOptionSchema
    .nullable()
    .refine((value): boolean => value !== null, "Selecione o cliente."),
  sharePercent: sharePercentField,
})

export type AddOwnerFormValues = z.infer<typeof addOwnerFormSchema>

export const ownerShareFormSchema = z.object({
  sharePercent: sharePercentField,
})

export type OwnerShareFormValues = z.infer<typeof ownerShareFormSchema>

export const addOwnerInputSchema = z.object({
  clientId: z.string().refine((value): boolean => isUuid(value), "Selecione um cliente válido."),
  sharePercent: sharePercentField,
})

export type AddOwnerInput = z.infer<typeof addOwnerInputSchema>

// ---------------------------------------------------------------------------
// Autorizações
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^(\d{4})-\d{2}-\d{2}$/

export function isDateInput(value: string) {
  const match = DATE_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  if (year < 1900 || year > 2200) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export const authorizationFormSchema = z
  .object({
    ownerClientId: z
      .string()
      .refine((value): boolean => isUuid(value), "Selecione o proprietário."),
    exclusive: z.boolean(),
    startsOn: z
      .string()
      .refine((value): boolean => isDateInput(value), "Informe a data de início."),
    endsOn: z
      .string()
      .refine((value): boolean => value === "" || isDateInput(value), "Data final inválida."),
    commissionPercent: commissionPercentField,
    signedOn: z
      .string()
      .refine(
        (value): boolean => value === "" || isDateInput(value),
        "Data de assinatura inválida."
      ),
  })
  .superRefine((values, ctx) => {
    if (
      values.endsOn &&
      isDateInput(values.endsOn) &&
      isDateInput(values.startsOn) &&
      values.endsOn < values.startsOn
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "A data final não pode ser anterior à data de início.",
      })
    }

    if (values.signedOn && isDateInput(values.signedOn) && values.signedOn > todayInSaoPaulo()) {
      ctx.addIssue({
        code: "custom",
        path: ["signedOn"],
        message: "A data de assinatura não pode estar no futuro.",
      })
    }
  })

export type AuthorizationFormValues = z.infer<typeof authorizationFormSchema>
