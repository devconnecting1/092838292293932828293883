/**
 * Schemas e conversões do editor de landing pages, compartilhados entre o
 * formulário (cliente) e as Server Actions (servidor). Os limites de conteúdo
 * vêm do modelo (`LANDING_TEMPLATES[].fields`), nunca do formulário.
 */
import { z } from "zod"

import type {
  LandingContentFieldKey,
  LandingTemplateDefinition,
  LandingTemplateField,
} from "@/lib/landing/templates"
import {
  LANDING_CONTENT_LIMITS,
  LANDING_HEX_COLOR_PATTERN,
  LANDING_THEME_LIMITS,
  isSafeStoragePath,
  parseLandingContent,
  parseLandingTheme,
  type LandingContent,
  type LandingSeo,
  type LandingTheme,
  type LandingTracking,
} from "@/lib/landing/types"
import {
  GOOGLE_TAG_ID_PATTERN,
  GTM_CONTAINER_ID_MAX_LENGTH,
  GTM_CONTAINER_ID_PATTERN,
  LANDING_NAME_MAX_LENGTH,
  MAX_LANDING_PROPERTIES,
  META_PIXEL_ID_PATTERN,
  SEO_DESCRIPTION_MAX_LENGTH,
  SEO_TITLE_MAX_LENGTH,
} from "@/lib/marketing/constants"
import { describeSlugProblem } from "@/lib/marketing/slug"

const TIME_ZONE = "America/Sao_Paulo"
/** Brasília sem horário de verão desde 2019. */
const SAO_PAULO_OFFSET = "-03:00"

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Quantidade de caracteres visíveis (emoji conta 1), igual ao corte do parser. */
export function countChars(value: string) {
  return Array.from(value).length
}

export function clipText(value: string, max: number) {
  const chars = Array.from(value.trim())
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : value.trim()
}

/** Primeiro erro de cada caminho ("launch.name", "highlights.0.value"). */
export function collectFieldErrors(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".")
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return fieldErrors
}

/** "450.000", "450000,50", "72,5" → número; vazio → undefined; inválido → NaN. */
export function parseBrNumber(value: string): number | undefined {
  const cleaned = value.replace(/R\$|\s/g, "").trim()
  if (!cleaned) return undefined
  let normalized = cleaned
  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".")
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "")
  }
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN
}

function numberToInput(value: number | undefined) {
  return value == null ? "" : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
}

/** ISO → valor de `<input type="datetime-local">` no fuso de São Paulo. */
export function isoToLocalInput(value: string | undefined) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** Valor do datetime-local (horário de São Paulo) → ISO com fuso. */
export function localInputToIso(value: string) {
  if (!LOCAL_DATETIME_PATTERN.test(value)) return undefined
  const iso = `${value}:00${SAO_PAULO_OFFSET}`
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso
}

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "")
}

/** (11) 98765-4321 enquanto digita. */
export function maskPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 13)
  if (digits.length > 11) return digits
  if (digits.length <= 2) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

// ---------------------------------------------------------------------------
// Identidade visual (theme)
// ---------------------------------------------------------------------------

const optionalHex = z
  .string()
  .refine(
    (value) => value === "" || LANDING_HEX_COLOR_PATTERN.test(value),
    "Use uma cor no formato #RRGGBB."
  )

const optionalPath = z.string().max(LANDING_THEME_LIMITS.path).nullable()

export const identitySchema = z.object({
  primaryColor: optionalHex,
  secondaryColor: optionalHex,
  accentColor: optionalHex,
  logoPath: optionalPath,
  backgroundPath: optionalPath,
  bannerPaths: z
    .array(z.string().max(LANDING_THEME_LIMITS.path))
    .max(LANDING_THEME_LIMITS.banners, `Use no máximo ${LANDING_THEME_LIMITS.banners} banners.`),
})

export type IdentityValues = z.infer<typeof identitySchema>

export function themeToIdentityValues(value: unknown): IdentityValues {
  const theme = parseLandingTheme(value)
  return {
    primaryColor: theme.primary_color ?? "",
    secondaryColor: theme.secondary_color ?? "",
    accentColor: theme.accent_color ?? "",
    logoPath: theme.logo_path ?? null,
    backgroundPath: theme.background_image_path ?? null,
    bannerPaths: theme.banner_image_paths ?? [],
  }
}

/** Respeita os espaços de imagem do modelo (fundo e quantidade de banners). */
export function identityValuesToTheme(
  values: IdentityValues,
  template: LandingTemplateDefinition
): LandingTheme {
  return parseLandingTheme({
    primary_color: values.primaryColor || undefined,
    secondary_color: values.secondaryColor || undefined,
    accent_color: values.accentColor || undefined,
    logo_path: values.logoPath,
    background_image_path: template.imageSlots.background ? values.backgroundPath : null,
    banner_image_paths: values.bannerPaths.slice(0, template.imageSlots.banners),
  })
}

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------

export type TypologyValues = {
  name: string
  areaMin: string
  areaMax: string
  bedrooms: string
  priceFrom: string
}

export type TestimonialValues = { name: string; text: string }

/** Par de prova social: valor em destaque ("+120") e o que ele significa. */
export type StatValues = { label: string; value: string }

export const contentBaseSchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  cta_label: z.string(),
  description: z.string(),
  highlights: z.array(z.object({ value: z.string() })),
  whatsapp_number: z.string(),
  whatsapp_message: z.string(),
  countdown_until: z.string(),
  testimonials: z.array(z.object({ name: z.string(), text: z.string() })),
  social_proof: z.array(z.object({ label: z.string(), value: z.string() })),
  units_left: z.string(),
  financing_note: z.string(),
  launch: z.object({
    name: z.string(),
    developer: z.string(),
    delivery_date: z.string(),
    neighborhood: z.string(),
    city: z.string(),
    state: z.string(),
    typologies: z.array(
      z.object({
        name: z.string(),
        areaMin: z.string(),
        areaMax: z.string(),
        bedrooms: z.string(),
        priceFrom: z.string(),
      })
    ),
  }),
})

export type ContentValues = z.infer<typeof contentBaseSchema>

export const EMPTY_TYPOLOGY: TypologyValues = {
  name: "",
  areaMin: "",
  areaMax: "",
  bedrooms: "",
  priceFrom: "",
}
export const EMPTY_TESTIMONIAL: TestimonialValues = { name: "", text: "" }
export const EMPTY_STAT: StatValues = { label: "", value: "" }

type LaunchTextKey = "name" | "developer" | "delivery_date" | "neighborhood" | "city" | "state"
type RootTextKey =
  | "headline"
  | "subheadline"
  | "cta_label"
  | "description"
  | "whatsapp_number"
  | "whatsapp_message"
  | "countdown_until"
  | "financing_note"
  | "units_left"

const ROOT_TEXT_KEYS: readonly RootTextKey[] = [
  "headline",
  "subheadline",
  "cta_label",
  "description",
  "whatsapp_number",
  "whatsapp_message",
  "countdown_until",
  "financing_note",
  "units_left",
]

function fieldPath(key: LandingContentFieldKey) {
  return key.split(".")
}

function readTextValue(values: ContentValues, key: LandingContentFieldKey): string {
  if (key.startsWith("launch.")) {
    const launchKey = key.slice("launch.".length) as LaunchTextKey
    return values.launch[launchKey] ?? ""
  }
  return (ROOT_TEXT_KEYS as readonly string[]).includes(key)
    ? (values[key as RootTextKey] ?? "")
    : ""
}

function requiredMessage(label: string) {
  return `Preencha “${label}”.`
}

function validateField(field: LandingTemplateField, values: ContentValues, ctx: z.RefinementCtx) {
  const path = fieldPath(field.key)
  const label = field.label

  switch (field.kind) {
    case "text":
    case "textarea":
    case "state": {
      const value = readTextValue(values, field.key).trim()
      if (field.required && !value) {
        ctx.addIssue({ code: "custom", path, message: requiredMessage(label) })
      } else if (field.maxLength && countChars(value) > field.maxLength) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `Use no máximo ${field.maxLength} caracteres.`,
        })
      } else if (field.kind === "state" && value && !/^[A-Za-z]{2}$/.test(value)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: "Informe a sigla da UF com 2 letras.",
        })
      }
      return
    }
    case "phone": {
      const digits = onlyDigits(readTextValue(values, field.key))
      const { minDigits, maxDigits } = LANDING_CONTENT_LIMITS.whatsapp_number
      if (field.required && !digits) {
        ctx.addIssue({ code: "custom", path, message: requiredMessage(label) })
      } else if (digits && (digits.length < minDigits || digits.length > maxDigits)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: "Informe o DDD e o número (10 ou 11 dígitos).",
        })
      }
      return
    }
    case "datetime": {
      const value = readTextValue(values, field.key).trim()
      if (field.required && !value) {
        ctx.addIssue({ code: "custom", path, message: requiredMessage(label) })
      } else if (value && !localInputToIso(value)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: "Data e hora inválidas.",
        })
      }
      return
    }
    case "number": {
      const value = readTextValue(values, field.key).trim()
      const min = field.min ?? 0
      const max = field.max ?? LANDING_CONTENT_LIMITS.units_left.max
      if (field.required && !value) {
        ctx.addIssue({ code: "custom", path, message: requiredMessage(label) })
      } else if (value && !/^\d+$/.test(value)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: "Use um número inteiro, sem pontos ou vírgulas.",
        })
      } else if (value && (Number(value) < min || Number(value) > max)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `Use um número entre ${min} e ${max}.`,
        })
      }
      return
    }
    case "list": {
      const items = values.highlights
      const max = field.maxItems ?? LANDING_CONTENT_LIMITS.highlights.items
      const maxLength = field.maxLength ?? LANDING_CONTENT_LIMITS.highlights.length
      if (items.length > max) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "root"],
          message: `Use no máximo ${max} itens.`,
        })
      }
      if (field.required && !items.some((item) => item.value.trim())) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "root"],
          message: `Adicione ao menos um item em “${label}”.`,
        })
      }
      items.forEach((item, index) => {
        if (countChars(item.value.trim()) > maxLength) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "value"],
            message: `Use no máximo ${maxLength} caracteres.`,
          })
        }
      })
      return
    }
    case "stats": {
      const items = values.social_proof
      const max = field.maxItems ?? LANDING_CONTENT_LIMITS.social_proof.items
      const labelMax = field.maxLength ?? LANDING_CONTENT_LIMITS.social_proof.label
      const valueMax = field.valueMaxLength ?? LANDING_CONTENT_LIMITS.social_proof.value
      if (items.length > max) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "root"],
          message: `Use no máximo ${max} números.`,
        })
      }
      if (field.required && items.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "root"],
          message: `Adicione ao menos um item em “${label}”.`,
        })
      }
      items.forEach((item, index) => {
        const statValue = item.value.trim()
        const statLabel = item.label.trim()
        if (!statValue) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "value"],
            message: "Informe o número.",
          })
        } else if (countChars(statValue) > valueMax) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "value"],
            message: `Use no máximo ${valueMax} caracteres.`,
          })
        }
        if (!statLabel) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "label"],
            message: "Diga o que o número significa.",
          })
        } else if (countChars(statLabel) > labelMax) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "label"],
            message: `Use no máximo ${labelMax} caracteres.`,
          })
        }
      })
      return
    }
    case "testimonials": {
      const items = values.testimonials
      const max = field.maxItems ?? LANDING_CONTENT_LIMITS.testimonials.items
      const textMax = field.maxLength ?? LANDING_CONTENT_LIMITS.testimonials.text
      const nameMax = LANDING_CONTENT_LIMITS.testimonials.name
      if (items.length > max) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "root"],
          message: `Use no máximo ${max} depoimentos.`,
        })
      }
      if (field.required && items.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "root"],
          message: `Adicione ao menos um item em “${label}”.`,
        })
      }
      items.forEach((item, index) => {
        const name = item.name.trim()
        const body = item.text.trim()
        if (!name) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "name"],
            message: "Informe o nome do cliente.",
          })
        } else if (countChars(name) > nameMax) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "name"],
            message: `Use no máximo ${nameMax} caracteres.`,
          })
        }
        if (!body) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "text"],
            message: "Escreva o depoimento.",
          })
        } else if (countChars(body) > textMax) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "text"],
            message: `Use no máximo ${textMax} caracteres.`,
          })
        }
      })
      return
    }
    case "typologies": {
      const items = values.launch.typologies
      const max = field.maxItems ?? LANDING_CONTENT_LIMITS.launch.typologies.items
      const nameMax = field.maxLength ?? LANDING_CONTENT_LIMITS.launch.typologies.name
      if (items.length > max) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "root"],
          message: `Use no máximo ${max} tipologias.`,
        })
      }
      if (field.required && items.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: [...path, "root"],
          message: "Adicione ao menos uma tipologia.",
        })
      }
      items.forEach((item, index) => {
        const name = item.name.trim()
        if (!name) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "name"],
            message: "Informe o nome da planta.",
          })
        } else if (countChars(name) > nameMax) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "name"],
            message: `Use no máximo ${nameMax} caracteres.`,
          })
        }
        const numbers = {
          areaMin: parseBrNumber(item.areaMin),
          areaMax: parseBrNumber(item.areaMax),
          bedrooms: parseBrNumber(item.bedrooms),
          priceFrom: parseBrNumber(item.priceFrom),
        }
        for (const [key, parsed] of Object.entries(numbers)) {
          if (parsed != null && Number.isNaN(parsed)) {
            ctx.addIssue({
              code: "custom",
              path: [...path, index, key],
              message: "Número inválido.",
            })
          }
        }
        if (
          numbers.areaMin != null &&
          numbers.areaMax != null &&
          !Number.isNaN(numbers.areaMin) &&
          !Number.isNaN(numbers.areaMax) &&
          numbers.areaMax < numbers.areaMin
        ) {
          ctx.addIssue({
            code: "custom",
            path: [...path, index, "areaMax"],
            message: "A área máxima não pode ser menor que a mínima.",
          })
        }
      })
      return
    }
  }
}

/** Schema do conteúdo com os campos, obrigatórios e limites do modelo. */
export function buildContentSchema(template: LandingTemplateDefinition) {
  return contentBaseSchema.superRefine((values, ctx) => {
    for (const field of template.fields) {
      validateField(field, values, ctx)
    }
  })
}

export function contentToValues(value: unknown): ContentValues {
  const content = parseLandingContent(value)
  const launch = content.launch ?? {}

  return {
    headline: content.headline ?? "",
    subheadline: content.subheadline ?? "",
    cta_label: content.cta_label ?? "",
    description: content.description ?? "",
    highlights: (content.highlights ?? []).map((item) => ({ value: item })),
    whatsapp_number: content.whatsapp_number ? maskPhone(content.whatsapp_number) : "",
    whatsapp_message: content.whatsapp_message ?? "",
    countdown_until: isoToLocalInput(content.countdown_until),
    testimonials: (content.testimonials ?? []).map((item) => ({
      name: item.name,
      text: item.text,
    })),
    social_proof: (content.social_proof ?? []).map((item) => ({
      label: item.stat_label,
      value: item.stat_value,
    })),
    units_left: content.units_left != null ? String(content.units_left) : "",
    financing_note: content.financing_note ?? "",
    launch: {
      name: launch.name ?? "",
      developer: launch.developer ?? "",
      delivery_date: launch.delivery_date ?? "",
      neighborhood: launch.neighborhood ?? "",
      city: launch.city ?? "",
      state: launch.state ?? "",
      typologies: (launch.typologies ?? []).map((item) => ({
        name: item.name,
        areaMin: numberToInput(item.area_min),
        areaMax: numberToInput(item.area_max),
        bedrooms: numberToInput(item.bedrooms),
        priceFrom: numberToInput(item.price_from),
      })),
    },
  }
}

function validNumber(value: string) {
  const parsed = parseBrNumber(value)
  return parsed != null && !Number.isNaN(parsed) ? parsed : undefined
}

/** Valores do formulário → jsonb `content`, só com os campos do modelo. */
export function contentValuesToContent(
  values: ContentValues,
  template: LandingTemplateDefinition
): LandingContent {
  const keys = new Set<LandingContentFieldKey>(template.fields.map((field) => field.key))
  const raw: Record<string, unknown> = {}
  const launch: Record<string, unknown> = {}

  for (const key of [
    "headline",
    "subheadline",
    "cta_label",
    "description",
    "whatsapp_message",
    "financing_note",
  ] as const) {
    if (keys.has(key)) raw[key] = values[key]
  }
  if (keys.has("highlights")) raw.highlights = values.highlights.map((item) => item.value)
  if (keys.has("whatsapp_number")) raw.whatsapp_number = onlyDigits(values.whatsapp_number)
  if (keys.has("countdown_until")) raw.countdown_until = localInputToIso(values.countdown_until)
  if (keys.has("testimonials")) raw.testimonials = values.testimonials
  if (keys.has("social_proof")) {
    raw.social_proof = values.social_proof.map((item) => ({
      stat_label: item.label,
      stat_value: item.value,
    }))
  }
  if (keys.has("units_left")) {
    const units = values.units_left.trim()
    raw.units_left = /^\d+$/.test(units) ? Number(units) : undefined
  }

  for (const key of [
    "name",
    "developer",
    "delivery_date",
    "neighborhood",
    "city",
    "state",
  ] as const) {
    if (keys.has(`launch.${key}`)) launch[key] = values.launch[key]
  }
  if (keys.has("launch.typologies")) {
    launch.typologies = values.launch.typologies.map((item) => ({
      name: item.name,
      area_min: validNumber(item.areaMin),
      area_max: validNumber(item.areaMax),
      bedrooms: validNumber(item.bedrooms),
      price_from: validNumber(item.priceFrom),
    }))
  }
  raw.launch = launch

  return parseLandingContent(raw)
}

// ---------------------------------------------------------------------------
// Imóveis e leads
// ---------------------------------------------------------------------------

export function maxPropertiesFor(template: LandingTemplateDefinition) {
  if (template.usesProperties === "none") return 0
  if (template.usesProperties === "single") return 1
  return Math.min(template.maxProperties, MAX_LANDING_PROPERTIES)
}

export function buildPropertyIdsSchema(template: LandingTemplateDefinition) {
  const max = maxPropertiesFor(template)
  return z
    .array(z.guid("Imóvel inválido."))
    .max(
      max,
      max === 1 ? "Este modelo exibe só 1 imóvel." : `Este modelo exibe no máximo ${max} imóveis.`
    )
    .refine((ids) => new Set(ids).size === ids.length, "O mesmo imóvel foi selecionado duas vezes.")
}

export const leadAssigneeSchema = z.guid("Selecione um membro da equipe.").nullable()

// ---------------------------------------------------------------------------
// Divulgação (nome, slug, SEO e rastreamento)
// ---------------------------------------------------------------------------

export const publicationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Dê um nome interno com pelo menos 3 caracteres.")
    .max(
      LANDING_NAME_MAX_LENGTH,
      `O nome pode ter no máximo ${LANDING_NAME_MAX_LENGTH} caracteres.`
    ),
  slug: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const problem = describeSlugProblem(value)
      if (problem) ctx.addIssue({ code: "custom", message: problem })
    }),
  seoTitle: z
    .string()
    .trim()
    .max(SEO_TITLE_MAX_LENGTH, `Use no máximo ${SEO_TITLE_MAX_LENGTH} caracteres.`),
  seoDescription: z
    .string()
    .trim()
    .max(SEO_DESCRIPTION_MAX_LENGTH, `Use no máximo ${SEO_DESCRIPTION_MAX_LENGTH} caracteres.`),
  ogImagePath: z.string().max(LANDING_THEME_LIMITS.path).nullable(),
  metaPixelId: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || META_PIXEL_ID_PATTERN.test(value),
      "O ID do Meta Pixel tem só números (de 6 a 20 dígitos)."
    ),
  googleTagId: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || GOOGLE_TAG_ID_PATTERN.test(value.toUpperCase()),
      "Use o formato G-XXXXXXX, GT-XXXXXXX ou AW-XXXXXXX."
    ),
  gtmContainerId: z
    .string()
    .trim()
    .max(GTM_CONTAINER_ID_MAX_LENGTH, `Use no máximo ${GTM_CONTAINER_ID_MAX_LENGTH} caracteres.`)
    .refine(
      (value) => value === "" || GTM_CONTAINER_ID_PATTERN.test(value.toUpperCase()),
      "Use o formato GTM-XXXXXXX."
    ),
})

export type PublicationValues = z.infer<typeof publicationSchema>

/** jsonb `seo` tolerante. */
export function readLandingSeo(value: unknown): LandingSeo {
  if (!isPlainObject(value)) return {}
  const seo: LandingSeo = {}
  if (typeof value.title === "string" && value.title.trim()) seo.title = value.title.trim()
  if (typeof value.description === "string" && value.description.trim()) {
    seo.description = value.description.trim()
  }
  if (isSafeStoragePath(value.og_image_path)) seo.og_image_path = value.og_image_path
  return seo
}

/**
 * jsonb `tracking` do editor: Pixel, Google Tag e GTM. (O token da API de
 * Conversões da Meta ainda não é gravado.)
 */
export type LandingTrackingValues = LandingTracking & {
  gtm_container_id?: string
}

/** jsonb `tracking` tolerante. */
export function readLandingTracking(value: unknown): LandingTrackingValues {
  if (!isPlainObject(value)) return {}
  const tracking: LandingTrackingValues = {}
  const pixel =
    typeof value.meta_pixel_id === "number" ? String(value.meta_pixel_id) : value.meta_pixel_id
  if (typeof pixel === "string" && META_PIXEL_ID_PATTERN.test(pixel.trim()))
    tracking.meta_pixel_id = pixel.trim()
  if (
    typeof value.google_tag_id === "string" &&
    GOOGLE_TAG_ID_PATTERN.test(value.google_tag_id.trim().toUpperCase())
  ) {
    tracking.google_tag_id = value.google_tag_id.trim().toUpperCase()
  }
  if (
    typeof value.gtm_container_id === "string" &&
    GTM_CONTAINER_ID_PATTERN.test(value.gtm_container_id.trim().toUpperCase())
  ) {
    tracking.gtm_container_id = value.gtm_container_id.trim().toUpperCase()
  }
  return tracking
}

export function toPublicationValues(row: {
  name: string
  slug: string
  seo: unknown
  tracking: unknown
}): PublicationValues {
  const seo = readLandingSeo(row.seo)
  const tracking = readLandingTracking(row.tracking)
  return {
    name: row.name,
    slug: row.slug,
    seoTitle: seo.title ?? "",
    seoDescription: seo.description ?? "",
    ogImagePath: seo.og_image_path ?? null,
    metaPixelId: tracking.meta_pixel_id ?? "",
    googleTagId: tracking.google_tag_id ?? "",
    gtmContainerId: tracking.gtm_container_id ?? "",
  }
}

export function publicationValuesToColumns(values: PublicationValues) {
  const seo: LandingSeo = {}
  if (values.seoTitle.trim()) seo.title = clipText(values.seoTitle, SEO_TITLE_MAX_LENGTH)
  if (values.seoDescription.trim())
    seo.description = clipText(values.seoDescription, SEO_DESCRIPTION_MAX_LENGTH)
  if (values.ogImagePath) seo.og_image_path = values.ogImagePath

  const tracking: LandingTrackingValues = {}
  if (values.metaPixelId.trim()) tracking.meta_pixel_id = values.metaPixelId.trim()
  if (values.googleTagId.trim()) tracking.google_tag_id = values.googleTagId.trim().toUpperCase()
  if (values.gtmContainerId.trim())
    tracking.gtm_container_id = values.gtmContainerId.trim().toUpperCase()

  return {
    name: values.name.trim(),
    slug: values.slug.trim(),
    seo,
    tracking,
  }
}

// ---------------------------------------------------------------------------
// Checagem para publicar
// ---------------------------------------------------------------------------

function hasContentValue(content: LandingContent, key: LandingContentFieldKey) {
  switch (key) {
    case "highlights":
      return (content.highlights?.length ?? 0) > 0
    case "testimonials":
      return (content.testimonials?.length ?? 0) > 0
    case "social_proof":
      return (content.social_proof?.length ?? 0) > 0
    case "units_left":
      return content.units_left != null
    case "launch.typologies":
      return (content.launch?.typologies?.length ?? 0) > 0
    case "launch.name":
    case "launch.developer":
    case "launch.delivery_date":
    case "launch.neighborhood":
    case "launch.city":
    case "launch.state":
      return Boolean(content.launch?.[key.slice("launch.".length) as LaunchTextKey])
    default:
      return Boolean(content[key])
  }
}

/**
 * Modelos que só publicam com ao menos 1 imóvel ativo (espelha o trigger
 * `landing_pages_before_write`: o imóvel em destaque e a vitrine). Nos demais
 * modelos com imóveis, a seção de imóveis é opcional.
 */
export function templateRequiresProperty(template: LandingTemplateDefinition) {
  return template.usesProperties === "single" || template.key === "portfolio_grid"
}

/**
 * Pendências que impedem publicar (lista vazia = pode publicar): campos
 * obrigatórios do modelo (inclui o título principal) e imóvel ativo quando o
 * modelo exige. O banco repete a checagem ao publicar.
 */
export function getPublishIssues({
  template,
  content,
  activePropertyCount,
}: {
  template: LandingTemplateDefinition
  content: LandingContent
  seo?: LandingSeo
  activePropertyCount: number
}) {
  const issues: string[] = []

  for (const field of template.fields) {
    if (field.required && !hasContentValue(content, field.key)) {
      issues.push(`Preencha “${field.label}” em Conteúdo.`)
    }
  }

  if (templateRequiresProperty(template) && activePropertyCount < 1) {
    issues.push(
      template.usesProperties === "single"
        ? "Selecione o imóvel ativo que a página vai exibir."
        : "Selecione ao menos 1 imóvel ativo para a página."
    )
  }

  return issues
}
