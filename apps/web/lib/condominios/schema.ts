import { z } from "zod"

import { isStateCode } from "@workspace/core/br/states"
import type { Tables } from "@workspace/database/types"

import { normalizeAmenities } from "@/lib/imoveis/amenities"
import {
  formatBrlInputValue,
  formatPostalCodeInputValue,
  parseBrlInput,
  toNullableNumber,
} from "@/lib/imoveis/number"

/**
 * Formulário de condomínio (valores como texto digitado) e conversão para as
 * colunas de public.condominiums. Puro: roda no navegador e no servidor.
 * Os limites espelham os CHECKs da tabela.
 */

export const CONDOMINIUM_LIMITS = {
  name: 200,
  street: 200,
  streetNumber: 20,
  complement: 120,
  neighborhood: 120,
  city: 120,
  notes: 5000,
  amenity: 120,
  amenities: 60,
} as const

/** numeric(12, 2): até 10 dígitos inteiros. */
const MAX_AVG_CONDO_FEE = 9_999_999_999.99

function isValidFee(value: string) {
  const amount = parseBrlInput(value)
  return amount === null || (!Number.isNaN(amount) && amount >= 0)
}

function isFeeWithinLimit(value: string) {
  const amount = parseBrlInput(value)
  return amount === null || Number.isNaN(amount) || amount <= MAX_AVG_CONDO_FEE
}

// Refinamentos com retorno `boolean` explícito: evita que o TS infira um type
// predicate e mantém entrada e saída como string no react-hook-form.
export const condominiumFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do condomínio.")
    .max(CONDOMINIUM_LIMITS.name, "O nome pode ter no máximo 200 caracteres."),
  postalCode: z
    .string()
    .trim()
    .refine(
      (value): boolean => value === "" || /^\d{5}-?\d{3}$/.test(value),
      "CEP inválido: informe os 8 dígitos."
    ),
  street: z
    .string()
    .trim()
    .max(CONDOMINIUM_LIMITS.street, "A rua pode ter no máximo 200 caracteres."),
  streetNumber: z
    .string()
    .trim()
    .max(CONDOMINIUM_LIMITS.streetNumber, "O número pode ter no máximo 20 caracteres."),
  complement: z
    .string()
    .trim()
    .max(CONDOMINIUM_LIMITS.complement, "O complemento pode ter no máximo 120 caracteres."),
  neighborhood: z
    .string()
    .trim()
    .max(CONDOMINIUM_LIMITS.neighborhood, "O bairro pode ter no máximo 120 caracteres."),
  city: z
    .string()
    .trim()
    .max(CONDOMINIUM_LIMITS.city, "A cidade pode ter no máximo 120 caracteres."),
  state: z
    .string()
    .trim()
    .refine(
      (value): boolean => value === "" || isStateCode(value.toUpperCase()),
      "Selecione uma UF válida."
    ),
  amenities: z
    .array(
      z
        .string()
        .trim()
        .max(
          CONDOMINIUM_LIMITS.amenity,
          "Cada item de infraestrutura pode ter no máximo 120 caracteres."
        )
    )
    .max(CONDOMINIUM_LIMITS.amenities, "Informe no máximo 60 itens de infraestrutura."),
  avgCondoFee: z
    .string()
    .trim()
    .refine((value): boolean => isValidFee(value), "Informe um valor válido, ex.: 850,00.")
    .refine(
      (value): boolean => isFeeWithinLimit(value),
      "A taxa média pode ser no máximo R$ 9.999.999.999,99."
    ),
  notes: z
    .string()
    .trim()
    .max(CONDOMINIUM_LIMITS.notes, "As observações podem ter no máximo 5.000 caracteres."),
})

export type CondominiumFormValues = z.infer<typeof condominiumFormSchema>

export const EMPTY_CONDOMINIUM_FORM_VALUES: CondominiumFormValues = {
  name: "",
  postalCode: "",
  street: "",
  streetNumber: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  amenities: [],
  avgCondoFee: "",
  notes: "",
}

/** Colunas necessárias para abrir o formulário de edição. */
export type CondominiumFormSource = Pick<
  Tables<"condominiums">,
  | "id"
  | "name"
  | "postal_code"
  | "street"
  | "street_number"
  | "complement"
  | "neighborhood"
  | "city"
  | "state"
  | "amenities"
  | "avg_condo_fee"
  | "notes"
>

export function toCondominiumFormValues(row: CondominiumFormSource): CondominiumFormValues {
  return {
    name: row.name,
    postalCode: formatPostalCodeInputValue(row.postal_code),
    street: row.street ?? "",
    streetNumber: row.street_number ?? "",
    complement: row.complement ?? "",
    neighborhood: row.neighborhood ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    amenities: [...row.amenities],
    avgCondoFee: formatBrlInputValue(row.avg_condo_fee == null ? null : Number(row.avg_condo_fee)),
    notes: row.notes ?? "",
  }
}

/** Colunas gravadas no insert/update (organization_id e created_by ficam de fora). */
export type CondominiumPayload = {
  name: string
  postal_code: string | null
  street: string | null
  street_number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  amenities: string[]
  avg_condo_fee: number | null
  notes: string | null
}

function nullableText(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Normaliza valores já validados: CEP só dígitos, UF maiúscula, textos vazios
 * viram null, comodidades sem duplicados e taxa como número.
 */
export function toCondominiumPayload(values: CondominiumFormValues): CondominiumPayload {
  const postalCode = values.postalCode.replace(/\D/g, "")
  const state = values.state.trim().toUpperCase()

  return {
    name: values.name.trim(),
    postal_code: postalCode.length === 8 ? postalCode : null,
    street: nullableText(values.street),
    street_number: nullableText(values.streetNumber),
    complement: nullableText(values.complement),
    neighborhood: nullableText(values.neighborhood),
    city: nullableText(values.city),
    state: state.length > 0 ? state : null,
    amenities: normalizeAmenities(values.amenities),
    avg_condo_fee: toNullableNumber(parseBrlInput(values.avgCondoFee)),
    notes: nullableText(values.notes),
  }
}
