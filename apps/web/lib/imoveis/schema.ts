import { z } from "zod"

import { isStateCode } from "@workspace/core/br/states"
import { requiredPrices, requiresLotArea } from "@workspace/core/properties/enums"
import type { Tables } from "@workspace/database/types"

import { normalizeAmenities } from "@/lib/imoveis/amenities"
import {
  ADDRESS_DISPLAYS,
  DESCRIPTION_MAX_LENGTH,
  LISTING_PURPOSES,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  PROPERTY_USAGES,
  TITLE_MAX_LENGTH,
  isHttpsUrl,
  isYoutubeUrl,
} from "@/lib/imoveis/constants"
import { isUuid } from "@/lib/imoveis/ids"
import {
  parseBrlInput,
  parseCoordinateInput,
  parseDecimalInput,
  parseIntegerInput,
  toNullableNumber,
} from "@/lib/imoveis/number"

/**
 * Formulário de imóvel. Os campos numéricos ficam como texto (máscara pt-BR)
 * e só viram número em formValuesToColumns. A validação aqui é de FORMATO;
 * os requisitos para sair do rascunho ficam em getStatusRequirementIssues,
 * espelhando os CHECKs do banco.
 */

const MAX_MONEY = 999_999_999_999.99

/** Mesmo limite do CHECK properties_external_code_format. */
export const EXTERNAL_CODE_MAX_LENGTH = 60

/** Mesmo limite do CHECK properties_registry_number_format. */
export const REGISTRY_NUMBER_MAX_LENGTH = 40

function text(max: number, label: string) {
  return z.string().trim().max(max, `${label} pode ter no máximo ${max} caracteres.`)
}

function optionalId(message: string) {
  return z.string().refine((value) => value === "" || isUuid(value), message)
}

function money(label: string, { positive }: { positive: boolean }) {
  return z.string().superRefine((value, ctx) => {
    const parsed = parseBrlInput(value)
    if (parsed === null) return
    if (Number.isNaN(parsed)) {
      ctx.addIssue({ code: "custom", message: `${label}: valor inválido.` })
    } else if (positive ? parsed <= 0 : parsed < 0) {
      ctx.addIssue({
        code: "custom",
        message: positive
          ? `${label} precisa ser maior que zero.`
          : `${label} não pode ser negativo.`,
      })
    } else if (parsed > MAX_MONEY) {
      ctx.addIssue({ code: "custom", message: `${label}: valor alto demais.` })
    }
  })
}

function area(label: string) {
  return z.string().superRefine((value, ctx) => {
    const parsed = parseDecimalInput(value)
    if (parsed === null) return
    if (Number.isNaN(parsed)) {
      ctx.addIssue({
        code: "custom",
        message: `${label}: use números, com até 2 casas decimais.`,
      })
    } else if (parsed <= 0) {
      ctx.addIssue({
        code: "custom",
        message: `${label} precisa ser maior que zero.`,
      })
    } else if (parsed > 999_999_999) {
      ctx.addIssue({ code: "custom", message: `${label}: valor alto demais.` })
    }
  })
}

function integer(label: string, min: number, max: number) {
  return z.string().superRefine((value, ctx) => {
    const parsed = parseIntegerInput(value, min < 0)
    if (parsed === null) return
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
      ctx.addIssue({
        code: "custom",
        message: `${label}: informe um número inteiro entre ${min} e ${max}.`,
      })
    }
  })
}

function coordinate(label: string, limit: number) {
  return z.string().superRefine((value, ctx) => {
    const parsed = parseCoordinateInput(value)
    if (parsed === null) return
    if (Number.isNaN(parsed) || parsed < -limit || parsed > limit) {
      ctx.addIssue({
        code: "custom",
        message: `${label}: informe um valor entre -${limit} e ${limit} (ex.: -22.9068).`,
      })
    }
  })
}

export const propertyFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Informe o título do anúncio.")
      .max(TITLE_MAX_LENGTH, `O título pode ter no máximo ${TITLE_MAX_LENGTH} caracteres.`),
    description: z
      .string()
      .max(
        DESCRIPTION_MAX_LENGTH,
        `A descrição pode ter no máximo ${DESCRIPTION_MAX_LENGTH} caracteres.`
      ),
    purpose: z.enum(LISTING_PURPOSES, { error: "Selecione a finalidade." }),
    usage: z.enum(PROPERTY_USAGES, { error: "Selecione o uso." }),
    type: z.enum(PROPERTY_TYPES, { error: "Selecione o tipo de imóvel." }),
    condominiumId: optionalId("Condomínio inválido."),
    capturedBy: optionalId("Captador inválido."),
    brokerId: optionalId("Corretor inválido."),
    // Código do imóvel no sistema anterior (vem da importação; a busca acha por ele).
    externalCode: text(EXTERNAL_CODE_MAX_LENGTH, "O código no sistema anterior"),
    // Número da matrícula no cartório de registro de imóveis (dossiê).
    registryNumber: text(REGISTRY_NUMBER_MAX_LENGTH, "O número da matrícula"),

    salePrice: money("O preço de venda", { positive: true }),
    rentPrice: money("O preço de locação", { positive: true }),
    condoFee: money("O condomínio", { positive: false }),
    iptuYearly: money("O IPTU", { positive: false }),

    postalCode: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || /^\d{5}-?\d{3}$/.test(value),
        "CEP inválido. Use o formato 00000-000."
      ),
    street: text(200, "A rua"),
    streetNumber: text(20, "O número"),
    complement: text(120, "O complemento"),
    neighborhood: text(120, "O bairro"),
    city: text(120, "A cidade"),
    // Retorno `boolean` explícito: sem isso o type guard de isStateCode estreita o tipo do campo.
    state: z
      .string()
      .refine((value): boolean => value === "" || isStateCode(value), "Selecione uma UF válida."),
    latitude: coordinate("Latitude", 90),
    longitude: coordinate("Longitude", 180),
    addressDisplay: z.enum(ADDRESS_DISPLAYS),

    livingArea: area("A área útil"),
    lotArea: area("A área total"),
    bedrooms: integer("Quartos", 0, 999),
    suites: integer("Suítes", 0, 999),
    bathrooms: integer("Banheiros", 0, 999),
    parkingSpaces: integer("Vagas", 0, 999),
    floor: integer("Andar", -10, 300),
    totalFloors: integer("Total de andares", 0, 300),
    yearBuilt: integer("Ano de construção", 1500, 2200),
    furnished: z.boolean(),
    acceptsPets: z.boolean(),
    acceptsExchange: z.boolean(),
    features: z
      .array(z.string().trim().max(60, "Cada comodidade pode ter no máximo 60 caracteres."))
      .max(60, "Selecione no máximo 60 comodidades."),

    videoUrl: z
      .string()
      .trim()
      .max(2048, "Link longo demais.")
      .refine(
        (value) => value === "" || isYoutubeUrl(value),
        "Use um link do YouTube em https (youtube.com ou youtu.be)."
      ),
    tourUrl: z
      .string()
      .trim()
      .max(2048, "Link longo demais.")
      .refine(
        (value) => value === "" || isHttpsUrl(value),
        "O tour virtual precisa de um link começando com https://."
      ),

    status: z.enum(PROPERTY_STATUSES),
    publishedToPortals: z.boolean(),
    // Sigilo: só dono, gerente, captador, corretor responsável e pessoas escolhidas veem.
    isRestricted: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const bedrooms = parseIntegerInput(values.bedrooms)
    const suites = parseIntegerInput(values.suites)
    if (bedrooms != null && suites != null && !Number.isNaN(bedrooms) && suites > bedrooms) {
      ctx.addIssue({
        code: "custom",
        path: ["suites"],
        message: "Suítes não podem passar do número de quartos.",
      })
    }

    const hasLatitude = values.latitude.trim() !== ""
    const hasLongitude = values.longitude.trim() !== ""
    if (hasLatitude !== hasLongitude) {
      ctx.addIssue({
        code: "custom",
        path: [hasLatitude ? "longitude" : "latitude"],
        message: "Informe latitude e longitude juntas.",
      })
    }
  })

export type PropertyFormValues = z.infer<typeof propertyFormSchema>
export type PropertyFormField = keyof PropertyFormValues

export type PropertyEditableColumns = Pick<
  Tables<"properties">,
  | "title"
  | "description"
  | "purpose"
  | "usage"
  | "type"
  | "condominium_id"
  | "captured_by"
  | "broker_id"
  | "external_code"
  | "registry_number"
  | "is_restricted"
  | "sale_price"
  | "rent_price"
  | "condo_fee"
  | "iptu_yearly"
  | "postal_code"
  | "street"
  | "street_number"
  | "complement"
  | "neighborhood"
  | "city"
  | "state"
  | "latitude"
  | "longitude"
  | "address_display"
  | "living_area"
  | "lot_area"
  | "bedrooms"
  | "suites"
  | "bathrooms"
  | "parking_spaces"
  | "floor"
  | "total_floors"
  | "year_built"
  | "furnished"
  | "accepts_pets"
  | "accepts_exchange"
  | "features"
>

function nullableText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Converte os valores (já validados) nas colunas de properties. */
export function formValuesToColumns(values: PropertyFormValues): PropertyEditableColumns {
  const hasSale = values.purpose === "sale" || values.purpose === "sale_rent"
  const hasRent = values.purpose === "rent" || values.purpose === "sale_rent"

  return {
    title: values.title.trim(),
    description: nullableText(values.description),
    purpose: values.purpose,
    usage: values.usage,
    type: values.type,
    condominium_id: values.condominiumId || null,
    captured_by: values.capturedBy || null,
    broker_id: values.brokerId || null,
    // O banco recusa caractere de controle (tab colado de planilha): vira espaço.
    external_code: nullableText(values.externalCode.replace(/\p{Cc}/gu, " ")),
    registry_number: nullableText(values.registryNumber.replace(/\p{Cc}/gu, " ")),
    is_restricted: values.isRestricted,
    // Preço de uma finalidade que não se aplica fica vazio, para não confundir o feed.
    sale_price: hasSale ? toNullableNumber(parseBrlInput(values.salePrice)) : null,
    rent_price: hasRent ? toNullableNumber(parseBrlInput(values.rentPrice)) : null,
    condo_fee: toNullableNumber(parseBrlInput(values.condoFee)),
    iptu_yearly: toNullableNumber(parseBrlInput(values.iptuYearly)),
    postal_code: nullableText(values.postalCode.replace(/\D/g, "")),
    street: nullableText(values.street),
    street_number: nullableText(values.streetNumber),
    complement: nullableText(values.complement),
    neighborhood: nullableText(values.neighborhood),
    city: nullableText(values.city),
    state: nullableText(values.state),
    latitude: toNullableNumber(parseCoordinateInput(values.latitude)),
    longitude: toNullableNumber(parseCoordinateInput(values.longitude)),
    address_display: values.addressDisplay,
    living_area: toNullableNumber(parseDecimalInput(values.livingArea)),
    lot_area: toNullableNumber(parseDecimalInput(values.lotArea)),
    bedrooms: toNullableNumber(parseIntegerInput(values.bedrooms)),
    suites: toNullableNumber(parseIntegerInput(values.suites)),
    bathrooms: toNullableNumber(parseIntegerInput(values.bathrooms)),
    parking_spaces: toNullableNumber(parseIntegerInput(values.parkingSpaces)),
    floor: toNullableNumber(parseIntegerInput(values.floor, true)),
    total_floors: toNullableNumber(parseIntegerInput(values.totalFloors)),
    year_built: toNullableNumber(parseIntegerInput(values.yearBuilt)),
    furnished: values.furnished,
    accepts_pets: values.acceptsPets,
    accepts_exchange: values.acceptsExchange,
    features: normalizeAmenities(values.features),
  }
}

export type StatusRequirementIssue = {
  field: "salePrice" | "rentPrice" | "livingArea" | "lotArea"
  message: string
}

type StatusRequirementSource = Pick<
  Tables<"properties">,
  "purpose" | "type" | "sale_price" | "rent_price" | "living_area" | "lot_area"
>

/**
 * O que falta para sair do rascunho (CHECKs properties_price_required e
 * properties_area_required, que valem para todo status diferente de draft).
 */
export function getStatusRequirementIssues(
  property: StatusRequirementSource
): StatusRequirementIssue[] {
  const issues: StatusRequirementIssue[] = []

  for (const field of requiredPrices(property.purpose)) {
    const value = field === "salePrice" ? property.sale_price : property.rent_price
    if (value == null || value <= 0) {
      issues.push({
        field,
        message:
          field === "salePrice" ? "Informe o preço de venda." : "Informe o preço de locação.",
      })
    }
  }

  if (requiresLotArea(property.type)) {
    if (property.lot_area == null || property.lot_area <= 0) {
      issues.push({
        field: "lotArea",
        message: "Informe a área total do terreno.",
      })
    }
  } else if (property.living_area == null || property.living_area <= 0) {
    issues.push({ field: "livingArea", message: "Informe a área útil." })
  }

  return issues
}
