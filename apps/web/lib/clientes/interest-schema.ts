import { z } from "zod"

import {
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_VALUES,
  type PropertyType,
} from "@workspace/core/properties/enums"
import type { Tables, TablesUpdate } from "@workspace/database/types"

import { formatCurrency } from "@/lib/format"
import { maskMoneyInput, parseMoneyInput } from "@/lib/clientes/format"

const MAX_PRICE = 999_999_999_999
const MAX_ROOMS = 50

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === "string" && (PROPERTY_TYPE_VALUES as readonly string[]).includes(value)
}

function parseRooms(value: string) {
  const trimmed = value.trim()

  if (!trimmed) return null
  if (!/^\d{1,3}$/.test(trimmed)) return undefined

  const rooms = Number(trimmed)
  return rooms <= MAX_ROOMS ? rooms : undefined
}

/** Perfil de busca do cliente (client_interests). Strings na entrada, como o form. */
export const interestFormSchema = z
  .object({
    purpose: z.enum(["sale", "rent", "sale_rent"]),
    types: z.array(z.string()).max(PROPERTY_TYPE_VALUES.length),
    neighborhoods: z
      .array(z.string().trim().min(1).max(120, "Cada bairro pode ter no máximo 120 caracteres."))
      .max(30, "Informe no máximo 30 bairros."),
    city: z.string().trim().max(120, "A cidade pode ter no máximo 120 caracteres."),
    minPrice: z.string(),
    maxPrice: z.string(),
    minBedrooms: z.string(),
    minParking: z.string(),
    notes: z.string().trim().max(5000, "As observações podem ter no máximo 5.000 caracteres."),
    active: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.types.some((type) => !isPropertyType(type))) {
      ctx.addIssue({
        code: "custom",
        path: ["types"],
        message: "Tipo de imóvel inválido.",
      })
    }

    const minPrice = parseMoneyInput(values.minPrice)
    const maxPrice = parseMoneyInput(values.maxPrice)

    if (minPrice !== null && minPrice > MAX_PRICE) {
      ctx.addIssue({
        code: "custom",
        path: ["minPrice"],
        message: "Valor alto demais.",
      })
    }

    if (maxPrice !== null && maxPrice > MAX_PRICE) {
      ctx.addIssue({
        code: "custom",
        path: ["maxPrice"],
        message: "Valor alto demais.",
      })
    }

    if (minPrice !== null && maxPrice !== null && maxPrice < minPrice) {
      ctx.addIssue({
        code: "custom",
        path: ["maxPrice"],
        message: "O valor máximo precisa ser maior ou igual ao mínimo.",
      })
    }

    for (const field of ["minBedrooms", "minParking"] as const) {
      if (parseRooms(values[field]) === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `Informe um número de 0 a ${MAX_ROOMS}.`,
        })
      }
    }
  })

export type InterestFormValues = z.infer<typeof interestFormSchema>

export const EMPTY_INTEREST_FORM_VALUES: InterestFormValues = {
  purpose: "sale",
  types: [],
  neighborhoods: [],
  city: "",
  minPrice: "",
  maxPrice: "",
  minBedrooms: "",
  minParking: "",
  notes: "",
  active: true,
}

export function interestRowToFormValues(interest: Tables<"client_interests">): InterestFormValues {
  return {
    purpose: interest.purpose,
    types: interest.types,
    neighborhoods: interest.neighborhoods,
    city: interest.city ?? "",
    minPrice:
      interest.min_price === null ? "" : maskMoneyInput(String(Math.round(interest.min_price))),
    maxPrice:
      interest.max_price === null ? "" : maskMoneyInput(String(Math.round(interest.max_price))),
    minBedrooms: interest.min_bedrooms === null ? "" : String(interest.min_bedrooms),
    minParking: interest.min_parking === null ? "" : String(interest.min_parking),
    notes: interest.notes ?? "",
    active: interest.active,
  }
}

/** Valores já validados para as colunas de client_interests. */
export function toInterestRow(values: InterestFormValues) {
  const city = values.city.trim()
  const notes = values.notes.trim()

  return {
    purpose: values.purpose,
    types: values.types.filter(isPropertyType),
    neighborhoods: values.neighborhoods.map((item) => item.trim()).filter(Boolean),
    city: city || null,
    min_price: parseMoneyInput(values.minPrice),
    max_price: parseMoneyInput(values.maxPrice),
    min_bedrooms: parseRooms(values.minBedrooms) ?? null,
    min_parking: parseRooms(values.minParking) ?? null,
    notes: notes || null,
    active: values.active,
  } satisfies TablesUpdate<"client_interests">
}

// -----------------------------------------------------------------------------
// Resumos para exibição
// -----------------------------------------------------------------------------

export function describeInterestTypes(types: readonly string[]) {
  const labels = types.filter(isPropertyType).map((type) => PROPERTY_TYPE_LABELS[type])
  return labels.length > 0 ? labels.join(", ") : "Qualquer tipo"
}

export function describeInterestPriceRange(min: number | null, max: number | null) {
  if (min !== null && max !== null) return `${formatCurrency(min)} a ${formatCurrency(max)}`
  if (min !== null) return `A partir de ${formatCurrency(min)}`
  if (max !== null) return `Até ${formatCurrency(max)}`
  return "Qualquer valor"
}

export function describeInterestPurpose(purpose: Tables<"client_interests">["purpose"]) {
  return LISTING_PURPOSE_LABELS[purpose]
}
